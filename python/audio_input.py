"""
audio_input.py: which microphones to offer, and how to open them.

Windows reports every recording device several times, once per audio system
(MME, DirectSound, WASAPI, WDM-KS). MME cuts names at 31 characters, and
WDM-KS adds raw driver connections such as "PC Speaker" and "Stereo Mix" that
are not microphones. WASAPI lists exactly the recording devices shown in the
Windows Sound settings, with their full names, so only those are offered.

WASAPI devices run at their own rate (usually 48 kHz). Whisper needs 16 kHz,
so streams are opened with Windows' built-in sample-rate conversion.
"""

WASAPI = "Windows WASAPI"

# Inputs that record the computer's own output rather than a microphone.
SPEAKER_CAPTURE = ("stereo mix", "what u hear", "wave out mix", "loopback")


def _host_api(sd):
    """WASAPI on Windows, otherwise the system's default audio API."""
    apis = sd.query_hostapis()
    for i, api in enumerate(apis):
        if api["name"] == WASAPI:
            return i, api
    i = sd.default.hostapi
    return i, apis[i]


def recording_devices(sd):
    """The recording devices to offer, system default first:
    [{"index", "name", "channels", "default"}]."""
    _, api = _host_api(sd)
    default = api["default_input_device"]
    found = []
    for idx in api["devices"]:
        d = sd.query_devices(idx)
        name = d["name"].strip()
        if d["max_input_channels"] <= 0 or d["max_output_channels"] > 0:
            continue    # outputs, and speakers exposed as loopback inputs
        if any(word in name.lower() for word in SPEAKER_CAPTURE):
            continue
        found.append({"index": idx, "name": name,
                      "channels": int(d["max_input_channels"]), "default": idx == default})
    found.sort(key=lambda d: not d["default"])
    return found


def default_device(sd):
    """Index of the Windows default recording device, or None."""
    _, api = _host_api(sd)
    idx = api["default_input_device"]
    return idx if idx is not None and idx >= 0 else None


def stream_settings(sd, device_index):
    """Extra settings needed to open this device at 16 kHz, or None."""
    if device_index is None:
        return None
    api = sd.query_hostapis(sd.query_devices(device_index)["hostapi"])
    if api["name"] == WASAPI:
        return sd.WasapiSettings(auto_convert=True)
    return None
