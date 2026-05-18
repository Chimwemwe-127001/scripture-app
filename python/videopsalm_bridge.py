"""
videopsalm_bridge.py  --  Send a Bible reference to VideoPsalm's reference input.

Uses Win32 API directly (WinForms controls are not accessible via UIA).
The target control: class=WindowsForms10.EDIT, placeholder text contains "Reference to select".

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
import psutil


def find_vp_hwnd():
    """Return the main VideoPsalm window handle (by process name + title)."""
    found = []

    def cb(hwnd, _):
        if not win32gui.IsWindowVisible(hwnd):
            return True
        try:
            _, pid = win32process.GetWindowThreadProcessId(hwnd)
            pname = psutil.Process(pid).name().lower()
            if pname == 'videopsalm.exe':
                title = win32gui.GetWindowText(hwnd)
                if 'videopsalm' in title.lower():
                    found.append(hwnd)
        except Exception:
            pass
        return True

    win32gui.EnumWindows(cb, None)
    return found[0] if found else None


def find_reference_edit(parent_hwnd):
    """Find the reference input edit box inside VP (the WinForms TextBox)."""
    found = []

    def cb(hwnd, _):
        try:
            cn = win32gui.GetClassName(hwnd)
            if 'EDIT' in cn.upper() and win32gui.IsWindowVisible(hwnd):
                txt = win32gui.GetWindowText(hwnd)
                found.append((hwnd, txt))
        except Exception:
            pass
        return True

    try:
        win32gui.EnumChildWindows(parent_hwnd, cb, None)
    except Exception:
        pass

    # Prefer the one with "reference" in its hint text
    for hwnd, txt in found:
        if 'reference' in txt.lower():
            return hwnd
    # Fall back to any visible EDIT control
    return found[0][0] if found else None


def is_running():
    return find_vp_hwnd() is not None


def send_reference(reference):
    """Type a reference into VP's search box and press Enter."""
    try:
        vp_hwnd = find_vp_hwnd()
        if not vp_hwnd:
            return False, "VideoPsalm is not running"

        edit_hwnd = find_reference_edit(vp_hwnd)
        if not edit_hwnd:
            return False, "Could not find reference input in VideoPsalm"

        # Bring VP to foreground so key events are processed
        win32gui.ShowWindow(vp_hwnd, 9)   # SW_RESTORE
        win32gui.SetForegroundWindow(vp_hwnd)
        time.sleep(0.2)

        # Set the text directly (cross-process safe for Win32/WinForms)
        win32gui.SendMessage(edit_hwnd, win32con.WM_SETTEXT, 0, reference)
        time.sleep(0.1)

        # Send Enter key events to the edit control
        win32gui.PostMessage(edit_hwnd, win32con.WM_KEYDOWN, win32con.VK_RETURN, 0x001C0001)
        time.sleep(0.05)
        win32gui.PostMessage(edit_hwnd, win32con.WM_CHAR, 0x0D, 0x001C0001)
        time.sleep(0.05)
        win32gui.PostMessage(edit_hwnd, win32con.WM_KEYUP, win32con.VK_RETURN, 0xC01C0001)

        return True, None
    except Exception as e:
        return False, str(e)


if __name__ == "__main__":
    if len(sys.argv) >= 2 and sys.argv[1] == "--check":
        print(json.dumps({"running": is_running()}), flush=True)
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
