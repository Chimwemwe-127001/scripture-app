#!/usr/bin/env python3
"""
Whisper worker: real-time speech-to-text for the Electron main process.

Captures microphone audio in overlapping windows, runs local OpenAI Whisper
inference (Radford et al., 2022) and writes one JSON message per line to
stdout.

Message types emitted to stdout:
{"type":"status",     "message":"...", "ready":bool, "listening":bool}
{"type":"transcript", "text":"...",    "is_final":true}
{"type":"warning",    "message":"..."}
{"type":"error",      "message":"..."}
"""

import sys
import json
import time
import argparse
import threading
import queue

import numpy as np


# Whisper hallucinates on silence and noise, typically inventing phrases such
# as "Thank you for watching". Segments are kept only when Whisper itself is
# confident that they contain speech.
NO_SPEECH_MAX = 0.5      # drop a segment if P(no speech) is at or above this
AVG_LOGPROB_MIN = -0.8   # drop a segment if its mean token log-probability is below this
MIN_TEXT_CHARS = 4       # ignore fragments such as "Oh." or "Um"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def emit(obj: dict):
    """Write a JSON line to stdout so Node.js can parse it."""
    print(json.dumps(obj, ensure_ascii=False), flush=True)


def load_whisper():
    try:
        import whisper  # openai-whisper
        return whisper
    except ImportError:
        emit({
            "type": "error",
            "message": "openai-whisper is not installed. Run: pip install openai-whisper"
        })
        sys.exit(1)


def load_sounddevice():
    try:
        import sounddevice as sd
        return sd
    except ImportError:
        emit({
            "type": "error",
            "message": "sounddevice is not installed. Run: pip install sounddevice"
        })
        sys.exit(1)


def rms(audio: np.ndarray) -> float:
    """Root-mean-square loudness for simple voice activity detection."""
    if audio.size == 0:
        return 0.0
    return float(np.sqrt(np.mean(np.square(audio.astype(np.float32)))))


def normalize_audio(audio: np.ndarray, peak_target: float = 0.95) -> np.ndarray:
    """
    Normalize audio safely.

    Whisper expects float32 mono audio roughly in the range [-1, 1].
    Normalizing helps when microphone volume changes or speech gets quieter.
    """
    audio = audio.astype(np.float32).flatten()

    peak = float(np.max(np.abs(audio))) if audio.size else 0.0
    if peak > 0:
        audio = (audio / peak) * peak_target

    return np.clip(audio, -1.0, 1.0)


def clean_text(text: str) -> str:
    """Light cleanup for common whitespace/newline artifacts."""
    return " ".join((text or "").strip().split())


def confident_text(result: dict) -> str:
    """Join only the segments Whisper is confident contain real speech."""
    parts = [
        seg.get("text", "")
        for seg in result.get("segments", [])
        if seg.get("no_speech_prob", 1.0) < NO_SPEECH_MAX
        and seg.get("avg_logprob", -999.0) > AVG_LOGPROB_MIN
    ]
    return clean_text(" ".join(parts))


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(
        description="Whisper real-time transcription worker"
    )

    parser.add_argument(
        "--model",
        default="small",
        choices=["tiny", "base", "small", "medium", "large-v3"],
        help="Whisper model. small is the best CPU trade-off; larger models need a GPU."
    )

    parser.add_argument(
        "--device-index",
        type=int,
        default=None,
        help="sounddevice input device index. Omit for system default."
    )

    parser.add_argument(
        "--sample-rate",
        type=int,
        default=16000,
        help="Whisper works well at 16 kHz mono audio."
    )

    parser.add_argument(
        "--chunk-secs",
        type=float,
        default=6.0,
        help="Audio window fed to Whisper. Longer windows improve context and accuracy."
    )

    parser.add_argument(
        "--overlap-secs",
        type=float,
        default=1.5,
        help="Overlap kept after each chunk to avoid clipped words at boundaries."
    )

    parser.add_argument(
        "--vad-threshold",
        type=float,
        default=0.005,
        help="RMS energy gate. Use 0 to disable. Lower values avoid skipping quiet speech."
    )

    parser.add_argument(
        "--language",
        default="en",
        help="Force language, e.g. en. Use auto to let Whisper detect language."
    )

    parser.add_argument(
        "--initial-prompt",
        default=(
            "Bible passages, scripture reading, sermon, church service, "
            "Genesis, Exodus, Leviticus, Numbers, Deuteronomy, Joshua, Judges, Ruth, "
            "Samuel, Kings, Chronicles, Ezra, Nehemiah, Esther, Job, Psalms, Proverbs, "
            "Ecclesiastes, Song of Solomon, Isaiah, Jeremiah, Lamentations, Ezekiel, Daniel, "
            "Hosea, Joel, Amos, Obadiah, Jonah, Micah, Nahum, Habakkuk, Zephaniah, "
            "Haggai, Zechariah, Malachi, Matthew, Mark, Luke, John, Acts, Romans, "
            "Corinthians, Galatians, Ephesians, Philippians, Colossians, Thessalonians, "
            "Timothy, Titus, Philemon, Hebrews, James, Peter, John, Jude, Revelation."
        ),
        help="Context prompt to bias Whisper toward expected vocabulary."
    )

    parser.add_argument(
        "--beam-size",
        type=int,
        default=5,
        help="Higher beam size can improve accuracy but uses more compute."
    )

    parser.add_argument(
        "--temperature",
        type=float,
        default=0.0,
        help="0 gives deterministic, usually more stable transcription."
    )

    parser.add_argument(
        "--fp16",
        action="store_true",
        help="Use FP16 inference. Enable only if your GPU supports it well."
    )

    parser.add_argument(
        "--max-queue-secs",
        type=float,
        default=20.0,
        help=(
            "Maximum seconds of audio held pending transcription. Once full, "
            "the oldest audio is dropped so latency stays bounded instead of "
            "growing without limit when inference runs slower than real time."
        )
    )

    parser.add_argument(
        "--blocksize",
        type=int,
        default=1024,
        help="Frames per audio callback. Used to size the pending-audio queue."
    )

    args = parser.parse_args()

    if args.overlap_secs >= args.chunk_secs:
        emit({
            "type": "error",
            "message": "--overlap-secs must be smaller than --chunk-secs"
        })
        sys.exit(1)

    whisper = load_whisper()
    sd = load_sounddevice()

    emit({
        "type": "status",
        "message": f"Loading Whisper model: {args.model}",
        "ready": False,
        "listening": False
    })

    try:
        model = whisper.load_model(args.model)
    except Exception as exc:
        emit({
            "type": "error",
            "message": f"Failed to load Whisper model '{args.model}': {exc}"
        })
        sys.exit(1)

    sample_rate = int(args.sample_rate)
    chunk_samples = int(args.chunk_secs * sample_rate)
    overlap_samples = int(args.overlap_secs * sample_rate)
    step_samples = chunk_samples - overlap_samples

    # ------------------------------------------------------------------
    # Bounded queue with drop-oldest backpressure.
    #
    # The audio callback fills the queue in real time. If inference is slower
    # than real time (common for medium or large-v3 on CPU), an unbounded
    # queue would grow for the whole service and the transcript would fall
    # further and further behind. Dropping the oldest audio keeps latency
    # bounded: losing a few seconds is better than being minutes late.
    # ------------------------------------------------------------------
    max_queue_blocks = max(8, int(args.max_queue_secs * sample_rate / max(1, args.blocksize or 1024)))
    audio_q = queue.Queue(maxsize=max_queue_blocks)
    stop_event = threading.Event()

    drop_stats = {"dropped": 0, "last_warned": 0.0}

    def audio_callback(indata, frames, time_info, status):
        if status:
            emit({
                "type": "warning",
                "message": str(status)
            })

        block = np.asarray(indata, dtype=np.float32)

        # Convert stereo/multi-channel input to mono.
        if block.ndim > 1:
            block = np.mean(block, axis=1)

        try:
            audio_q.put_nowait(block.copy())
        except queue.Full:
            # Transcription is behind. Evict the oldest block so the buffer
            # follows the present rather than a growing backlog.
            try:
                audio_q.get_nowait()
                audio_q.put_nowait(block.copy())
            except (queue.Empty, queue.Full):
                pass

            drop_stats["dropped"] += 1

            # Surface it, but at most once every 10 s so the UI is not flooded.
            now = time.monotonic()
            if now - drop_stats["last_warned"] > 10.0:
                drop_stats["last_warned"] = now
                emit({
                    "type": "warning",
                    "message": (
                        f"Transcription is falling behind. Dropped "
                        f"{drop_stats['dropped']} audio blocks. "
                        f"Switch to a smaller Whisper model for lower latency."
                    )
                })

    def transcriber_loop():
        buffer = np.empty(0, dtype=np.float32)
        previous_text = ""

        while not stop_event.is_set():
            try:
                block = audio_q.get(timeout=0.25)
                buffer = np.concatenate([buffer, block])
            except queue.Empty:
                continue

            while buffer.size >= chunk_samples:
                chunk = buffer[:chunk_samples]

                # Keep overlap for the next window.
                buffer = buffer[step_samples:]

                loudness = rms(chunk)
                if args.vad_threshold > 0 and loudness < args.vad_threshold:
                    continue

                audio = normalize_audio(chunk)

                transcribe_kwargs = {
                    "task": "transcribe",
                    "temperature": args.temperature,
                    "beam_size": args.beam_size,
                    # Each window is transcribed on its own. Conditioning on
                    # earlier output lets one hallucination repeat in a loop.
                    "condition_on_previous_text": False,
                    "no_speech_threshold": NO_SPEECH_MAX,
                    "logprob_threshold": AVG_LOGPROB_MIN,
                    "compression_ratio_threshold": 2.4,   # rejects repetitive output
                    "initial_prompt": args.initial_prompt,
                    "fp16": bool(args.fp16),
                    "verbose": False,
                }

                language = (args.language or "").strip()
                if language and language.lower() != "auto":
                    transcribe_kwargs["language"] = language

                try:
                    result = model.transcribe(audio, **transcribe_kwargs)
                    text = confident_text(result)
                except Exception as exc:
                    emit({
                        "type": "error",
                        "message": f"Transcription failed: {exc}"
                    })
                    continue

                # Windows overlap, so skip an exact repeat of the last phrase.
                if len(text) >= MIN_TEXT_CHARS and text != previous_text:
                    emit({
                        "type": "transcript",
                        "text": text,
                        "is_final": True
                    })
                    previous_text = text

    worker = threading.Thread(target=transcriber_loop, daemon=True)
    worker.start()

    # ------------------------------------------------------------------
    # Graceful shutdown channel.
    #
    # On Windows, killing the process is an abrupt TerminateProcess that can
    # leave the audio device locked. Electron writes "stop" to stdin first and
    # only kills the process if it does not exit in time.
    # ------------------------------------------------------------------
    def stdin_watcher():
        try:
            for line in sys.stdin:
                if line.strip().lower() in ("stop", "quit", "exit"):
                    break
        except Exception:
            pass
        stop_event.set()

    threading.Thread(target=stdin_watcher, daemon=True).start()

    emit({
        "type": "status",
        "message": "Ready. Listening.",
        "ready": True,
        "listening": True
    })

    try:
        with sd.InputStream(
            samplerate=sample_rate,
            device=args.device_index,
            channels=1,
            dtype="float32",
            callback=audio_callback,
            blocksize=args.blocksize,
        ):
            # Exit the loop as soon as a stop is requested so the InputStream
            # context manager closes the device properly on the way out.
            while not stop_event.is_set():
                time.sleep(0.1)

    except KeyboardInterrupt:
        pass

    except Exception as exc:
        emit({
            "type": "error",
            "message": f"Audio input failed: {exc}"
        })

    finally:
        stop_event.set()
        # Give the transcriber a moment to notice and unwind before exiting.
        worker.join(timeout=2.0)
        if drop_stats["dropped"]:
            emit({
                "type": "warning",
                "message": (
                    f"Session dropped {drop_stats['dropped']} audio blocks due to "
                    f"transcription lag. Consider a smaller model next service."
                )
            })
        emit({
            "type": "status",
            "message": "Stopped listening.",
            "ready": False,
            "listening": False
        })


if __name__ == "__main__":
    main()