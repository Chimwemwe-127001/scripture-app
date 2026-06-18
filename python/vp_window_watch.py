"""
vp_window_watch.py: report where VideoPsalm's window is, so the app can keep
its mini panel docked to it.

Prints one JSON line whenever something changes:
    {"open": true, "minimized": false, "rect": [left, top, right, bottom],
     "vpPid": 1234, "fgPid": 5678}
rect is in physical pixels (this process is DPI aware). fgPid is the process
that owns the foreground window, so the app can hide the panel when the
operator moves to an unrelated program.

Usage: python vp_window_watch.py
"""
import ctypes
import json
import sys
import time
import win32gui
import win32process

from videopsalm_bridge import find_vp_hwnd

POLL_S = 0.2     # how often the window is checked
RESCAN_S = 2.0   # how often to look for VideoPsalm when it is not open


def main():
    try:
        ctypes.windll.shcore.SetProcessDpiAwareness(2)   # per-monitor: rects in real pixels
    except Exception:
        pass

    hwnd, last, last_scan = None, None, 0.0
    while True:
        now = time.monotonic()
        if (not hwnd or not win32gui.IsWindow(hwnd)) and now - last_scan > RESCAN_S:
            hwnd, last_scan = find_vp_hwnd(), now

        fg = win32gui.GetForegroundWindow()
        fg_pid = win32process.GetWindowThreadProcessId(fg)[1] if fg else 0
        if hwnd and win32gui.IsWindow(hwnd):
            state = {
                'open': True,
                'minimized': bool(win32gui.IsIconic(hwnd)),
                'rect': list(win32gui.GetWindowRect(hwnd)),
                'vpPid': win32process.GetWindowThreadProcessId(hwnd)[1],
                'fgPid': fg_pid,
            }
        else:
            hwnd = None
            state = {'open': False, 'fgPid': fg_pid}

        if state != last:
            print(json.dumps(state), flush=True)
            last = state
        time.sleep(POLL_S)


if __name__ == '__main__':
    try:
        main()
    except (KeyboardInterrupt, BrokenPipeError):
        sys.exit(0)
