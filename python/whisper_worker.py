#!/usr/bin/env python3
"""
Whisper Worker — Real-time speech-to-text for Scripture Suggestion Panel.

Captures microphone audio in overlapping chunks and runs local Whisper
inference. Emits JSON lines to stdout consumed by the Electron main process.

Message types (stdout):
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


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def emit(obj: dict):
    """Write a JSON line to stdout so Node.js can parse it."""
    print(json.dumps(obj), flush=True)


def load_whisper(model_name: str):
    try:
        import whisper  # openai-whisper
    except ImportError:
        emit({"type": "error", "message": "openai-whisper is not installed. Run: pip install openai-whisper"})
        sys.exit(1)

    emit({"type": "status", "message": f"Loading Whisper model '{model_name}' …"})
    try:
        model = whisper.load_model(model_name)
    except Exception as exc:
        emit({"type": "error", "message": f"Failed to load model: {exc}"})
        sys.exit(1)

    emit({"type": "status", "message": "Model loaded.", "ready": True})
    return model


def load_sounddevice():
    try:
        import sounddevice as sd
        return sd
    except ImportError:
        emit({"type": "error", "message": "sounddevice is not installed. Run: pip install sounddevice"})
        sys.exit(1)


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(description="Whisper real-time transcription worker")
    parser.add_argument("--model",         default="small",
                        choices=["tiny", "base", "small", "medium", "large-v3"])
    parser.add_argument("--device-index",  type=int,   default=None,
                        help="sounddevice input device index (omit for system default)")
    parser.add_argument("--sample-rate",   type=int,   default=16000)
    parser.add_argument("--chunk-secs",    type=float, default=6.0,
                        help="Audio window fed to Whisper (seconds)")
    parser.add_argument("--overlap-secs",  type=float, default=1.5,
                        help="Overlap kept after each chunk (seconds)")
    parser.add_argument("--vad-threshold", type=float, default=0.015,
                        help="RMS energy gate — chunks quieter than this are skipped (0 = disable)")
    args = parser.parse_args()

    RATE          = args.sample_rate
    CHUNK_SAMPLES = int(RATE * args.chunk_secs)
    KEEP_SAMPLES  = int(RATE * args.overlap_secs)
    VAD_RMS       = args.vad_threshold

    model = load_whisper(args.model)
    sd    = load_sounddevice()

    audio_q: "queue.Queue[np.ndarray]" = queue.Queue()
    buffer  = np.array([], dtype=np.float32)
    stop_event = threading.Event()

    # ---- audio callback (called from sounddevice's thread) ----------------
    def audio_callback(indata, frames, time_info, status):
        if status:
            emit({"type": "warning", "message": str(status)})
        audio_q.put(indata[:, 0].copy())   # mono

    # ---- transcription thread ---------------------------------------------
    def transcribe_loop():
        nonlocal buffer
        while not stop_event.is_set():
            try:
                chunk = audio_q.get(timeout=0.5)
            except queue.Empty:
                continue

            buffer = np.concatenate([buffer, chunk])

            if len(buffer) < CHUNK_SAMPLES:
                continue

            audio_window = buffer[:CHUNK_SAMPLES].copy()
            buffer       = buffer[CHUNK_SAMPLES - KEEP_SAMPLES:]   # rolling overlap

            # --- Energy gate: skip silent/near-silent windows to prevent
            #     Whisper from hallucinating on background noise / silence.
            if VAD_RMS > 0:
                rms = float(np.sqrt(np.mean(audio_window ** 2)))
                if rms < VAD_RMS:
                    continue

            try:
                result = model.transcribe(
                    audio_window,
                    fp16=False,
                    language="en",
                    task="transcribe",
                    temperature=0,                   # deterministic; no sampling
                    condition_on_previous_text=False, # prevent hallucination cascades
                    no_speech_threshold=0.6,          # Whisper's built-in silence gate
                    logprob_threshold=-1.0,           # drop low-confidence segments
                    compression_ratio_threshold=2.4,  # drop repetitive/looping output
                )

                # Filter at segment level using Whisper's own confidence scores.
                # result["text"] includes ALL segments; we only want ones where
                # Whisper is confident it heard real speech.
                segments = result.get("segments", [])
                good_parts = [
                    seg["text"].strip()
                    for seg in segments
                    if seg.get("no_speech_prob", 1.0) < 0.5        # likely speech
                    and seg.get("avg_logprob", -999)  > -1.0        # confident words
                ]
                text = " ".join(good_parts).strip()

                if text and len(text) > 3:
                    emit({"type": "transcript", "text": text, "is_final": True})

            except Exception as exc:
                emit({"type": "warning", "message": f"Transcription error: {exc}"})

    t = threading.Thread(target=transcribe_loop, daemon=True)
    t.start()

    # ---- audio stream -----------------------------------------------------
    try:
        with sd.InputStream(
            samplerate=RATE,
            channels=1,
            dtype="float32",
            device=args.device_index,
            callback=audio_callback,
        ):
            emit({"type": "status", "message": "Listening …", "listening": True})
            while True:
                time.sleep(0.25)

    except KeyboardInterrupt:
        pass
    except Exception as exc:
        emit({"type": "error", "message": f"Audio stream error: {exc}"})
    finally:
        stop_event.set()
        emit({"type": "status", "message": "Stopped.", "listening": False})


if __name__ == "__main__":
    main()
