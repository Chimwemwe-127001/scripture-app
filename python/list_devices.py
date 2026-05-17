#!/usr/bin/env python3
"""
List audio input devices as JSON.
Used by Electron main process to populate the device selector.
"""
import json
import sys


def main():
    try:
        import sounddevice as sd
    except ImportError:
        print(json.dumps({"error": "sounddevice not installed"}))
        sys.exit(0)

    devices = sd.query_devices()
    result = []
    for idx, d in enumerate(devices):
        if d["max_input_channels"] > 0:
            result.append({
                "index":    idx,
                "name":     d["name"],
                "channels": int(d["max_input_channels"]),
                "default":  idx == sd.default.device[0],
            })

    print(json.dumps(result))


if __name__ == "__main__":
    main()
