"""
videopsalm_bridge.py  --  Send a Bible reference to VideoPsalm's reference search box.

VP is a WinForms app. WM_SETTEXT is ignored by its custom TextBox.
Reliable approach: click the reference input to focus it, then simulate keyboard input.

Usage:
    python videopsalm_bridge.py "John 3:16"
    python videopsalm_bridge.py --check
"""
import sys
import json
import time
import win32gui
import win32con
import win32process
import win32api
import psutil
from pywinauto.keyboard import send_keys


def find_vp_hwnd():
    """Return VP's main window handle (process=videopsalm.exe, title contains 'VideoPsalm')."""
    found = []

    def cb(hwnd, _):
        if not win32gui.IsWindowVisible(hwnd):
            return True
        try:
            _, pid = win32process.GetWindowThreadProcessId(hwnd)
            if psutil.Process(pid).name().lower() == 'videopsalm.exe':
                title = win32gui.GetWindowText(hwnd)
                if 'videopsalm' in title.lower():
                    found.append(hwnd)
        except Exception:
            pass
        return True

    win32gui.EnumWindows(cb, None)
    return found[0] if found else None


def find_reference_edit(parent_hwnd):
    """Find VP's reference TextBox — the EDIT control whose hint text contains 'reference'."""
    found = []

    def cb(hwnd, _):
        try:
            if 'EDIT' in win32gui.GetClassName(hwnd).upper() and win32gui.IsWindowVisible(hwnd):
                found.append((hwnd, win32gui.GetWindowText(hwnd)))
        except Exception:
            pass
        return True

    try:
        win32gui.EnumChildWindows(parent_hwnd, cb, None)
    except Exception:
        pass

    for hwnd, txt in found:
        if 'reference' in txt.lower():
            return hwnd
    return found[0][0] if found else None


def is_running():
    return find_vp_hwnd() is not None


def send_reference(reference):
    """Click VP's reference input, type the reference, and press Enter."""
    try:
        vp_hwnd = find_vp_hwnd()
        if not vp_hwnd:
            return False, "VideoPsalm is not running"

        edit_hwnd = find_reference_edit(vp_hwnd)
        if not edit_hwnd:
            return False, "Could not find reference input in VideoPsalm"

        # Get screen coordinates of the edit control
        rect = win32gui.GetWindowRect(edit_hwnd)
        cx = (rect[0] + rect[2]) // 2
        cy = (rect[1] + rect[3]) // 2

        # Bring VP to foreground
        win32gui.ShowWindow(vp_hwnd, 9)   # SW_RESTORE
        win32gui.SetForegroundWindow(vp_hwnd)
        time.sleep(0.2)

        # Click the edit box to focus it and dismiss hint text
        win32api.SetCursorPos((cx, cy))
        win32api.mouse_event(win32con.MOUSEEVENTF_LEFTDOWN, cx, cy, 0, 0)
        time.sleep(0.05)
        win32api.mouse_event(win32con.MOUSEEVENTF_LEFTUP, cx, cy, 0, 0)
        time.sleep(0.15)

        # Select-all + type reference + Enter
        send_keys('^a', pause=0.05)
        send_keys(reference, with_spaces=True, pause=0.02)
        send_keys('{ENTER}')

        return True, None
    except Exception as e:
        return False, str(e)


if __name__ == "__main__":
    if len(sys.argv) >= 2 and sys.argv[1] == "--check":
        print(json.dumps({"running": is_running()}), flush=True)
        sys.exit(0)

    if len(sys.argv) >= 2 and sys.argv[1] == "--daemon":
        # Persistent daemon: read JSON commands from stdin, write results to stdout.
        # Commands: {"action":"check"} or {"action":"send","reference":"John 3:16"}
        for line in sys.stdin:
            line = line.strip()
            if not line:
                continue
            try:
                cmd = json.loads(line)
            except json.JSONDecodeError:
                print(json.dumps({"ok": False, "error": "Bad JSON"}), flush=True)
                continue
            action = cmd.get("action")
            if action == "check":
                print(json.dumps({"running": is_running()}), flush=True)
            elif action == "send":
                ref = cmd.get("reference", "")
                ok, error = send_reference(ref)
                result = {"ok": ok}
                if error:
                    result["error"] = error
                print(json.dumps(result), flush=True)
            else:
                print(json.dumps({"ok": False, "error": f"Unknown action: {action}"}), flush=True)
        sys.exit(0)

    if len(sys.argv) < 2:
        print(json.dumps({"ok": False, "error": "Usage: videopsalm_bridge.py <reference>"}))
        sys.exit(1)

    reference = sys.argv[1]
    ok, error = send_reference(reference)
    result = {"ok": ok}
    if error:
        result["error"] = error
    print(json.dumps(result), flush=True)
    sys.exit(0 if ok else 1)
