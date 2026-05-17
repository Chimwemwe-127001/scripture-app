#!/usr/bin/env python3
"""
List audio input devices as JSON.
Used by Electron main process to populate the device selector.
"""
import json
import re
import sys


# Windows lists the same physical device once per host API (MME/DirectSound/WASAPI/WDM-KS).
# We deduplicate by normalised name and strip obviously junk entries.
def _is_junk(name: str) -> bool:
    n = name.lower().strip()
    if "@" in name:                             # @System32\drivers\... internal paths
        return True
    if re.fullmatch(r"input\s*\(\s*\)", n):     # "Input ()" — no real name
        return True
    if n in ("microsoft sound mapper - input",  # Windows virtual mappers
             "primary sound capture driver"):
        return True
    return False


def _norm(name: str) -> str:
    return re.sub(r"\s+", " ", name).strip().lower()


def main():
    try:
        import sounddevice as sd
    except ImportError:
        print(json.dumps({"error": "sounddevice not installed"}))
        sys.exit(0)

    devices = sd.query_devices()
    seen: set[str] = set()
    result = []

    for idx, d in enumerate(devices):
        if d["max_input_channels"] <= 0:
            continue
        name = d["name"]
        if _is_junk(name):
            continue
        key = _norm(name)
        if key in seen:
            continue
        seen.add(key)
        result.append({
            "index":    idx,
            "name":     name,
            "channels": int(d["max_input_channels"]),
            "default":  idx == sd.default.device[0],
        })

    print(json.dumps(result))


if __name__ == "__main__":
    main()
