"""
videopsalm_bridge.py -- Send a Bible reference to VideoPsalm's search box.

Usage:
    python videopsalm_bridge.py "John 3:16"
    python videopsalm_bridge.py --check   # only check if VP is running
"""
import sys
import json
import time


def find_videopsalm_window():
    from pywinauto import Application
    from pywinauto.findwindows import find_windows
    handles = find_windows(title_re=r".*VideoPsalm.*")
    if not handles:
        raise RuntimeError("VideoPsalm is not running")
    app = Application(backend="uia").connect(handle=handles[0])
    return app, app.top_window()


def is_running():
    try:
        from pywinauto.findwindows import find_windows
        handles = find_windows(title_re=r".*VideoPsalm.*")
        return len(handles) > 0
    except Exception:
        return False


def find_reference_input(window):
    try:
        for ctrl in window.descendants(control_type="Edit"):
            try:
                if ctrl.is_visible():
                    return ctrl
            except Exception:
                continue
    except Exception:
        pass
    return None


def send_via_uia(window, reference):
    ctrl = find_reference_input(window)
    if ctrl is None:
        raise RuntimeError("Could not find reference input control in VideoPsalm")
    ctrl.set_focus()
    time.sleep(0.05)
    ctrl.set_edit_text("")
    ctrl.type_keys(reference + "{ENTER}", with_spaces=True)


def send_via_clipboard(window, reference):
    import subprocess
    subprocess.run(
        ["powershell", "-Command", f"Set-Clipboard -Value '{reference}'"],
        capture_output=True
    )
    window.set_focus()
    time.sleep(0.15)
    from pywinauto.keyboard import send_keys
    send_keys("^a^v{ENTER}")


def send_reference(reference):
    try:
        _app, window = find_videopsalm_window()
        window.set_focus()
        time.sleep(0.1)
        try:
            send_via_uia(window, reference)
        except Exception:
            send_via_clipboard(window, reference)
        return True, None
    except ImportError:
        return False, "pywinauto is not installed (run: pip install pywinauto)"
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
