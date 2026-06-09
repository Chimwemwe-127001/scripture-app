#!/usr/bin/env python3
"""
Whisper worker: real-time speech-to-text for the Electron main process.

Audio comes from the microphone (or from a file, for evaluation). Silero voice
activity detection cuts it into utterances at natural pauses, and each
utterance is transcribed once by faster-whisper, on the GPU when there is one.
Nothing that is not speech ever reaches the model, which is where Whisper
invents text.

Messages, one JSON object per line on stdout:
{"type":"status",     "message":"...", "ready":bool, "listening":bool, "model":..., "device":...}
{"type":"partial",    "text":"..."}                     words of the utterance still being spoken
{"type":"transcript", "text":"...", "is_final":true, "start":s, "end":s, "decode_ms":n, "latency_ms":n}
{"type":"warning",    "message":"..."}
{"type":"error",      "message":"..."}

Write "stop" to stdin to end the session cleanly.
"""

import argparse
import glob
import importlib.util
import json
import os
import queue
import sys
import threading
import time

import numpy as np

SAMPLE_RATE = 16000
FRAME = 512                 # Silero VAD works on 32 ms frames at 16 kHz
CONTEXT = 64                # samples of the previous frame the model also sees

# Voice detection, with hysteresis so a short dip between words does not end
# an utterance.
SPEECH_ON = 0.5
SPEECH_OFF = 0.35
PRE_ROLL_SECS = 0.3         # audio kept from just before speech starts

# Initial prompt: one plain sentence of context. It nudges Whisper towards
# church vocabulary and the "John 3:16" way of writing references, without a
# long word list that the model can echo back on silence.
PROMPT = "A church sermon with Bible readings, such as John 3:16 and Romans 8:28."

# Whole-utterance phrases Whisper is known to invent from noise. Only an exact
# match of the entire utterance is dropped, so a real "thank you" survives.
KNOWN_HALLUCINATIONS = {
    "thank you for watching", "thanks for watching", "please subscribe",
    "subscribe to my channel", "like and subscribe", "you",
}

# Default model per device. Large models are only usable on a GPU.
DEFAULT_MODEL = {"cuda": "distil-large-v3.5", "cpu": "small.en"}


def emit(obj):
    print(json.dumps(obj, ensure_ascii=False), flush=True)


# ---------------------------------------------------------------------------
# GPU setup
# ---------------------------------------------------------------------------

def add_nvidia_dll_dirs():
    """The NVIDIA pip wheels keep their DLLs in site-packages/nvidia/*/bin,
    which Windows does not search by default."""
    if os.name != "nt":
        return
    spec = importlib.util.find_spec("nvidia")
    for root in (spec.submodule_search_locations if spec else []):
        for d in glob.glob(os.path.join(root, "*", "bin")):
            os.add_dll_directory(d)
            os.environ["PATH"] = d + os.pathsep + os.environ.get("PATH", "")


def load_model(name, device):
    """Load a faster-whisper model, falling back from GPU to CPU if needed.
    Returns (model, model_name, device, compute_type)."""
    add_nvidia_dll_dirs()
    os.environ.setdefault("HF_HUB_DISABLE_SYMLINKS_WARNING", "1")   # harmless on Windows
    # Newer GPUs compile some kernels on first use. A bigger driver cache keeps
    # them between sessions, so only the very first run pays for it.
    os.environ.setdefault("CUDA_CACHE_MAXSIZE", str(2 * 1024 ** 3))

    import ctranslate2
    from faster_whisper import WhisperModel

    if device == "auto":
        device = "cuda" if ctranslate2.get_cuda_device_count() > 0 else "cpu"

    attempts = [(device, "int8_float16" if device == "cuda" else "int8")]
    if device == "cuda":
        attempts.append(("cpu", "int8"))

    for dev, compute in attempts:
        model_name = DEFAULT_MODEL[dev] if name == "auto" else name
        try:
            model = WhisperModel(model_name, device=dev, compute_type=compute)
            return model, model_name, dev, compute
        except Exception as exc:
            if dev == "cpu":
                raise
            emit({"type": "warning",
                  "message": f"GPU unavailable ({exc}). Falling back to the CPU."})


def warm_up(model):
    """Decode one second of quiet noise so any one-time GPU kernel compilation
    happens now, during "Loading model", and not on the first verse."""
    noise = (np.random.default_rng(0).standard_normal(SAMPLE_RATE) * 1e-3).astype(np.float32)
    segments, _ = model.transcribe(noise, language="en", beam_size=1, vad_filter=False,
                                   without_timestamps=True)
    list(segments)


# ---------------------------------------------------------------------------
# Voice detection and segmentation
# ---------------------------------------------------------------------------

class StreamingVad:
    """Silero VAD run one 32 ms frame at a time, keeping its state between
    frames. Uses the ONNX model that ships with faster-whisper."""

    def __init__(self):
        import onnxruntime
        from faster_whisper.utils import get_assets_path

        opts = onnxruntime.SessionOptions()
        opts.inter_op_num_threads = 1
        opts.intra_op_num_threads = 1
        opts.log_severity_level = 4
        self.session = onnxruntime.InferenceSession(
            os.path.join(get_assets_path(), "silero_vad_v6.onnx"),
            providers=["CPUExecutionProvider"], sess_options=opts)
        self.h = np.zeros((1, 1, 128), dtype=np.float32)
        self.c = np.zeros((1, 1, 128), dtype=np.float32)
        self.context = np.zeros(CONTEXT, dtype=np.float32)

    def __call__(self, frame):
        x = np.concatenate([self.context, frame])[None, :]
        out, self.h, self.c = self.session.run(None, {"input": x, "h": self.h, "c": self.c})
        self.context = frame[-CONTEXT:]
        return float(np.asarray(out).reshape(-1)[-1])


class Segmenter:
    """Turns a stream of frames into utterances.

    An utterance ends after `min_silence` seconds without speech. A long
    sentence is cut at the first brief dip after `soft_max` seconds, and always
    by `hard_max`, so text keeps flowing while someone reads a long passage.
    """

    def __init__(self, min_silence, soft_max, hard_max):
        self.vad = StreamingVad()
        self.min_silence = int(min_silence * SAMPLE_RATE / FRAME)
        self.soft_max = int(soft_max * SAMPLE_RATE / FRAME)
        self.hard_max = int(hard_max * SAMPLE_RATE / FRAME)
        self.pre_roll = []
        self.frames = []
        self.speaking = False
        self.silent = 0
        self.position = 0          # frames seen so far
        self.start = 0             # first frame of the current utterance
        self.last_speech_time = 0.0

    def push(self, frame, arrived):
        """Feed one frame. Returns a finished utterance or None.
        An utterance is (audio, start_secs, end_secs, end_of_speech_wall_time)."""
        prob = self.vad(frame)
        self.position += 1

        if not self.speaking:
            self.pre_roll = (self.pre_roll + [frame])[-int(PRE_ROLL_SECS * SAMPLE_RATE / FRAME):]
            if prob >= SPEECH_ON:
                self.speaking = True
                self.frames = list(self.pre_roll)
                self.start = self.position - len(self.frames)
                self.silent = 0
                self.last_speech_time = arrived
            return None

        self.frames.append(frame)
        if prob >= SPEECH_OFF:
            self.silent = 0
            self.last_speech_time = arrived
        else:
            self.silent += 1

        length = len(self.frames)
        if (self.silent >= self.min_silence
                or (length >= self.soft_max and prob < SPEECH_ON)
                or length >= self.hard_max):
            return self._finish()
        return None

    def current(self):
        """Audio of the utterance in progress, for partial results."""
        return np.concatenate(self.frames) if self.speaking and self.frames else None

    def _finish(self):
        # Keep a little of the trailing silence; drop the rest.
        keep = len(self.frames) - max(0, self.silent - 6)
        audio = np.concatenate(self.frames[:keep])
        start = self.start * FRAME / SAMPLE_RATE
        end = (self.start + keep) * FRAME / SAMPLE_RATE
        utterance = (audio, start, end, self.last_speech_time)
        self.speaking = False
        self.frames = []
        self.pre_roll = []
        self.silent = 0
        return utterance


# ---------------------------------------------------------------------------
# Transcription
# ---------------------------------------------------------------------------

def transcribe(model, audio, beam_size):
    """Transcribe one utterance. Returns the confident text only."""
    segments, _ = model.transcribe(
        audio,
        language="en",
        beam_size=beam_size,
        vad_filter=False,                  # already segmented by our own VAD
        condition_on_previous_text=False,  # one bad line cannot seed the next
        initial_prompt=PROMPT,
        without_timestamps=True,
        no_speech_threshold=0.6,
        log_prob_threshold=-1.0,
        compression_ratio_threshold=2.4,
    )
    parts = [s.text.strip() for s in segments
             if not (s.no_speech_prob > 0.6 and s.avg_logprob < -0.8)]
    text = " ".join(" ".join(parts).split())
    if text.lower().strip(" .!?,") in KNOWN_HALLUCINATIONS:
        return ""
    return text


# ---------------------------------------------------------------------------
# Audio sources
# ---------------------------------------------------------------------------

def microphone_frames(device_index, stop, max_queue_secs):
    """Yield (frame, arrival_time) from the microphone. A bounded queue drops
    the oldest audio if processing ever falls behind, so latency stays bounded."""
    try:
        import sounddevice as sd
    except ImportError:
        emit({"type": "error", "message": "sounddevice is not installed. Run: pip install -r python/requirements.txt"})
        sys.exit(1)

    q = queue.Queue(maxsize=max(8, int(max_queue_secs * SAMPLE_RATE / FRAME)))
    dropped = {"count": 0, "warned": 0.0}

    def callback(indata, frames, time_info, status):
        block = np.asarray(indata, dtype=np.float32).reshape(-1)
        try:
            q.put_nowait((block.copy(), time.monotonic()))
        except queue.Full:
            try:
                q.get_nowait()
                q.put_nowait((block.copy(), time.monotonic()))
            except (queue.Empty, queue.Full):
                pass
            dropped["count"] += 1
            now = time.monotonic()
            if now - dropped["warned"] > 10:
                dropped["warned"] = now
                emit({"type": "warning",
                      "message": f"Transcription is falling behind. Dropped {dropped['count']} audio blocks."})

    with sd.InputStream(samplerate=SAMPLE_RATE, channels=1, dtype="float32",
                        blocksize=FRAME, device=device_index, callback=callback):
        while not stop.is_set():
            try:
                yield q.get(timeout=0.25)
            except queue.Empty:
                continue


def file_frames(path, start_secs, end_secs):
    """Yield (frame, time) from an audio file, as fast as it can be decoded.
    Used by scripts/eval_asr.py to measure the same pipeline the app uses."""
    import av

    resampler = av.AudioResampler(format="flt", layout="mono", rate=SAMPLE_RATE)
    pending = np.zeros(0, dtype=np.float32)
    first = int(start_secs * SAMPLE_RATE)
    last = int(end_secs * SAMPLE_RATE) if end_secs else None
    seen = 0
    with av.open(path) as container:
        for packet_frame in container.decode(audio=0):
            for out in resampler.resample(packet_frame):
                pending = np.concatenate([pending, out.to_ndarray().reshape(-1)])
            while len(pending) >= FRAME:
                frame, pending = pending[:FRAME], pending[FRAME:]
                seen += FRAME
                if seen <= first:
                    continue
                if last is not None and seen > last:
                    return
                yield frame, time.monotonic()


# ---------------------------------------------------------------------------
# Main loop
# ---------------------------------------------------------------------------

def main():
    p = argparse.ArgumentParser(description="Real-time transcription worker")
    p.add_argument("--model", default="auto",
                   help="auto, distil-large-v3.5, large-v3-turbo, small.en, ...")
    p.add_argument("--device", default="auto", choices=["auto", "cuda", "cpu"])
    p.add_argument("--device-index", type=int, default=None, help="sounddevice input index")
    p.add_argument("--beam-size", type=int, default=5)
    p.add_argument("--min-silence", type=float, default=0.5, help="pause that ends an utterance (s)")
    p.add_argument("--soft-max", type=float, default=8.0, help="cut a long utterance at the next dip (s)")
    p.add_argument("--hard-max", type=float, default=12.0, help="always cut an utterance here (s)")
    p.add_argument("--partial-every", type=float, default=1.0, help="seconds between partials, 0 to disable")
    p.add_argument("--max-queue-secs", type=float, default=20.0)
    p.add_argument("--input-file", help="read audio from a file instead of the microphone (evaluation)")
    p.add_argument("--start", type=float, default=0.0, help="with --input-file: start offset (s)")
    p.add_argument("--end", type=float, default=None, help="with --input-file: end offset (s)")
    args = p.parse_args()

    emit({"type": "status", "message": "Loading speech model. The first run downloads it (about 1.5 GB).",
          "ready": False, "listening": False})
    try:
        model, model_name, device, compute = load_model(args.model, args.device)
        warm_up(model)
    except Exception as exc:
        emit({"type": "error", "message": f"Could not load the speech model: {exc}"})
        sys.exit(1)

    segmenter = Segmenter(args.min_silence, args.soft_max, args.hard_max)
    # Partials re-decode the whole utterance so far. Cheap on a GPU, too slow on a CPU.
    partial_every = args.partial_every if device == "cuda" and not args.input_file else 0

    stop = threading.Event()

    def watch_stdin():
        try:
            for line in sys.stdin:
                if line.strip().lower() in ("stop", "quit", "exit"):
                    break
        except Exception:
            pass
        stop.set()

    if not args.input_file:
        threading.Thread(target=watch_stdin, daemon=True).start()

    source = (file_frames(args.input_file, args.start, args.end) if args.input_file
              else microphone_frames(args.device_index, stop, args.max_queue_secs))

    emit({"type": "status", "message": f"Listening. {model_name} on {'GPU' if device == 'cuda' else 'CPU'}.",
          "ready": True, "listening": True, "model": model_name, "device": device, "compute_type": compute})

    last_partial = 0.0

    def finish(utterance):
        audio, start, end, speech_ended = utterance
        t0 = time.monotonic()
        text = transcribe(model, audio, args.beam_size)
        decode_ms = round((time.monotonic() - t0) * 1000)
        if text:
            emit({"type": "transcript", "text": text, "is_final": True,
                  "start": round(args.start + start, 2), "end": round(args.start + end, 2),
                  "decode_ms": decode_ms,
                  "latency_ms": round((time.monotonic() - speech_ended) * 1000)})
        elif partial_every:
            emit({"type": "partial", "text": ""})   # clear a partial that came to nothing

    try:
        for frame, arrived in source:
            if stop.is_set():
                break
            utterance = segmenter.push(frame, arrived)
            if utterance:
                finish(utterance)
                continue
            if partial_every and segmenter.speaking and arrived - last_partial >= partial_every:
                audio = segmenter.current()
                if audio is not None and len(audio) >= SAMPLE_RATE:
                    last_partial = arrived
                    emit({"type": "partial", "text": transcribe(model, audio, beam_size=1)})
        if segmenter.speaking:           # flush the last utterance at the end of a file or session
            finish(segmenter._finish())
    except Exception as exc:
        emit({"type": "error", "message": f"Audio input failed: {exc}"})
    finally:
        stop.set()
        emit({"type": "status", "message": "Stopped listening.", "ready": False, "listening": False})


if __name__ == "__main__":
    main()
