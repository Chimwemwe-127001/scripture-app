#!/usr/bin/env python3
"""
List the recording devices as JSON, for the input selector in Settings.
See audio_input.py for which devices are offered and why.
"""
import json
import sys

from audio_input import recording_devices


def main():
    try:
        import sounddevice as sd
    except ImportError:
        print(json.dumps({"error": "sounddevice not installed"}))
        sys.exit(0)
    print(json.dumps(recording_devices(sd)))


if __name__ == "__main__":
    main()
