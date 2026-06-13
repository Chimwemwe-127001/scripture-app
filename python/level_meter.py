#!/usr/bin/env python3
"""
level_meter.py: shows whether a microphone is getting sound.

Opens the device for a few seconds and prints its level ten times a second,
one JSON object per line: {"level": 0..1, "db": -60..0}. The last line is
{"done": true, "peak_db": ...}. Used by the Test input button in Settings.
"""
import argparse
import json
import math
import time

import numpy as np

from audio_input import default_device, stream_settings

RATE = 16000
BLOCK = RATE // 10       # 100 ms


def emit(obj):
    print(json.dumps(obj), flush=True)


def to_db(x):
    return max(-60.0, 20 * math.log10(x + 1e-9))


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--device-index", type=int, default=None)
    p.add_argument("--seconds", type=float, default=5.0)
    args = p.parse_args()

    import sounddevice as sd
    device = args.device_index if args.device_index is not None else default_device(sd)
    peak = -60.0
    try:
        with sd.InputStream(samplerate=RATE, channels=1, dtype="float32", blocksize=BLOCK,
                            device=device, extra_settings=stream_settings(sd, device)) as stream:
            end = time.monotonic() + args.seconds
            while time.monotonic() < end:
                block, _ = stream.read(BLOCK)
                db = to_db(float(np.abs(block).max()))
                peak = max(peak, db)
                emit({"level": round((db + 60) / 60, 3), "db": round(db, 1)})
    except Exception as exc:
        emit({"error": str(exc)})
        return
    emit({"done": True, "peak_db": round(peak, 1)})


if __name__ == "__main__":
    main()
