"""
videopsalm_bridge.py: put a Bible reference on screen in VideoPsalm, and read
back the verse VideoPsalm shows.

VideoPsalm has no remote-control API, so we use its own reference search box,
the one under the Bibles tab ("Reference to select, e.g.: Romans 3:23-25, 30").

How a send works:
  1. Keystrokes are posted straight to that box (WM_CHAR, then Enter). Posted
     messages need no keyboard focus, so VideoPsalm does not have to come to
     the front and the operator stays in our app. Bringing it to the front is
     what Windows blocked before ("SetForegroundWindow: Access is denied"):
     a background process may not take the foreground from the app in use.
  2. VideoPsalm finds the verse and projects it. We then read its verse list
     through UI Automation and return what is on screen, in whichever
     translation VideoPsalm is using (KJV, NKJV, ...). VideoPsalm's Bible files
     are encrypted; we only read what its window already shows.

Usage:
    python videopsalm_bridge.py --daemon     # used by the app, JSON lines on stdin/stdout
    python videopsalm_bridge.py --check      # is VideoPsalm running?
    python videopsalm_bridge.py "John 3:16"  # one-off send
"""
import sys
import json
import re
import time
import win32gui
import win32con
import win32api
import win32process
import psutil

# VideoPsalm's control names (WinForms Name property, exposed as UIA AutomationId).
REFERENCE_BOX = 'buttonEditSearchBibleReference'
BIBLE_LIST = 'searchLookUpEditBibleList'
VERSE_GRID = 'gridControlSequence'
BIBLES_TAB = 'Bibles'   # the tab button; the reference box only exists while it is open
PROJECTIONS = 'layoutControlProjections'   # the panel holding the Bible buttons (KJV, NKJV...)

# Buttons in that panel that are not Bibles.
NOT_BIBLES = {'Songbooks', 'Bibles', 'Add', 'Open', 'Column Left', 'Column Right',
              'Page Left', 'Page Right', 'Line Up', 'Line Down', 'Page Up', 'Page Down'}

READ_TIMEOUT_S = 1.0   # how long to wait for VideoPsalm to show the verse

_uia = None            # UI Automation client, loaded on first use (about 0.8 s)
_cache = {}            # main window handle -> {name: wrapper}


def find_vp_hwnd():
    """VideoPsalm's main window: process videopsalm.exe, title contains 'VideoPsalm'."""
    found = []

    def cb(hwnd, _):
        if not win32gui.IsWindowVisible(hwnd):
            return True
        try:
            _, pid = win32process.GetWindowThreadProcessId(hwnd)
            if psutil.Process(pid).name().lower() == 'videopsalm.exe' and \
                    'videopsalm' in win32gui.GetWindowText(hwnd).lower():
                found.append(hwnd)
        except Exception:
            pass
        return True

    win32gui.EnumWindows(cb, None)
    return found[0] if found else None


def is_running():
    return find_vp_hwnd() is not None


def _find(root, prop, value, button=False):
    """First descendant whose property equals value (native UIA search)."""
    from pywinauto.uia_element_info import UIAElementInfo
    from pywinauto.controls.uiawrapper import UIAWrapper
    cond = _uia.iuia.CreatePropertyCondition(prop, value)
    if button:
        cond = _uia.iuia.CreateAndCondition(cond, _uia.iuia.CreatePropertyCondition(
            _uia.UIA_dll.UIA_ControlTypePropertyId, _uia.UIA_dll.UIA_ButtonControlTypeId))
    element = root.FindFirst(_uia.tree_scope['descendants'], cond)
    if not element:
        raise LookupError(value)
    return UIAWrapper(UIAElementInfo(element))


def open_bibles_tab(ctrl):
    """Switch VideoPsalm to its Bibles tab (UIA Invoke, no focus needed)."""
    ctrl['tab'].invoke()
    time.sleep(0.3)


def controls(vp_hwnd):
    """The controls we use, looked up once per VideoPsalm window.

    A native UI Automation FindFirst takes about 1 s; walking the tree from
    Python (pywinauto's child_window) took about 5 s, longer than the app's
    5 s timeout for a send.
    """
    global _uia
    cached = _cache.get(vp_hwnd)
    if cached and all(win32gui.IsWindow(c.handle) for c in cached.values() if c.handle):
        return cached
    from pywinauto.uia_defines import IUIA
    _uia = _uia or IUIA()
    root = _uia.iuia.ElementFromHandle(vp_hwnd)
    aid = _uia.UIA_dll.UIA_AutomationIdPropertyId
    found = {'tab': _find(root, _uia.UIA_dll.UIA_NamePropertyId, BIBLES_TAB, button=True)}
    try:
        found['box'] = _find(root, aid, REFERENCE_BOX)
    except LookupError:
        open_bibles_tab(found)          # the box is missing while Songbooks is open
        found['box'] = _find(root, aid, REFERENCE_BOX)
    found['bible'] = _find(root, aid, BIBLE_LIST)
    found['panel'] = _find(root, aid, PROJECTIONS)
    found['grid'] = _find(root, aid, VERSE_GRID)
    _cache.clear()
    _cache[vp_hwnd] = found
    return found


def post_reference(edit_hwnd, reference):
    """Replace the box's text with the reference and press Enter, without focus."""
    win32gui.SendMessage(edit_hwnd, win32con.EM_SETSEL, 0, -1)
    win32gui.SendMessage(edit_hwnd, win32con.WM_CLEAR, 0, 0)
    for ch in reference:
        win32api.PostMessage(edit_hwnd, win32con.WM_CHAR, ord(ch), 0)
    win32api.PostMessage(edit_hwnd, win32con.WM_KEYDOWN, win32con.VK_RETURN, 0x001C0001)
    win32api.PostMessage(edit_hwnd, win32con.WM_KEYUP, win32con.VK_RETURN, 0xC01C0001)


def read_shown(ctrl):
    """The verses in VideoPsalm's list: [{'verse': 16, 'text': '...'}]."""
    verses = []
    for panel in ctrl['grid'].children():
        if panel.element_info.name != 'Data Panel':
            continue
        for row in panel.children():
            if not row.element_info.name.startswith('Row '):
                continue
            value = row.legacy_properties().get('Value') or ''
            number, _, text = value.partition(';')
            if number.strip().isdigit():
                verses.append({'verse': int(number), 'text': text.strip().rstrip(';').strip()})
    return verses


def translation_of(ctrl):
    """'King James Version (KJV)' -> ('King James Version (KJV)', 'KJV')."""
    name = ctrl['bible'].legacy_properties().get('Value') or ''
    m = re.search(r'\(([^()]+)\)\s*$', name)
    return name, (m.group(1) if m else name)


def bible_buttons(ctrl):
    """VideoPsalm's favourite Bibles, as buttons: {'KJV': wrapper, 'NIV84': wrapper}."""
    from pywinauto.uia_element_info import UIAElementInfo
    from pywinauto.controls.uiawrapper import UIAWrapper
    cond = _uia.iuia.CreatePropertyCondition(
        _uia.UIA_dll.UIA_ControlTypePropertyId, _uia.UIA_dll.UIA_ButtonControlTypeId)
    found = ctrl['panel'].element_info.element.FindAll(_uia.tree_scope['descendants'], cond)
    buttons = {}
    for i in range(found.Length):
        w = UIAWrapper(UIAElementInfo(found.GetElement(i)))
        name = w.element_info.name
        # Bible buttons carry short abbreviations: KJV, NIV84, MSG-Alt.
        short = name and re.fullmatch(r'[A-Za-z0-9-]{2,10}', name)
        if short and name not in NOT_BIBLES and w.element_info.rectangle.width() > 0:
            buttons[name] = w
    return buttons


def list_bibles():
    """(ok, error, {'bibles': [...], 'current': 'KJV'})"""
    vp_hwnd = find_vp_hwnd()
    if not vp_hwnd:
        return False, 'VideoPsalm is not open', None
    ctrl = controls(vp_hwnd)
    if not win32gui.IsWindowVisible(ctrl['box'].handle):
        open_bibles_tab(ctrl)
    _, short = translation_of(ctrl)
    return True, None, {'bibles': list(bible_buttons(ctrl)), 'current': short}


def set_bible(name):
    """Press one of VideoPsalm's Bible buttons; (ok, error, {'current': ...})."""
    vp_hwnd = find_vp_hwnd()
    if not vp_hwnd:
        return False, 'VideoPsalm is not open', None
    ctrl = controls(vp_hwnd)
    if not win32gui.IsWindowVisible(ctrl['box'].handle):
        open_bibles_tab(ctrl)
    button = bible_buttons(ctrl).get(name)
    if not button:
        return False, f"{name} is not one of VideoPsalm's Bibles", None
    button.invoke()
    deadline = time.monotonic() + READ_TIMEOUT_S
    while time.monotonic() < deadline:
        time.sleep(0.05)
        full, short = translation_of(ctrl)
        if short.upper().replace('-', '') == name.upper().replace('-', '') or name.lower() in full.lower():
            break
    full, short = translation_of(ctrl)
    return True, None, {'current': short, 'currentName': full}


def first_verse(reference):
    m = re.search(r':\s*(\d+)', reference)
    return int(m.group(1)) if m else None


def send_reference(reference):
    """Send the reference; return (ok, error, shown)."""
    vp_hwnd = find_vp_hwnd()
    if not vp_hwnd:
        return False, 'VideoPsalm is not open', None
    try:
        ctrl = controls(vp_hwnd)
    except Exception:
        return False, "Could not find VideoPsalm's Bible reference box. Is VideoPsalm 1.29 or later open?", None

    if not win32gui.IsWindowVisible(ctrl['box'].handle):
        open_bibles_tab(ctrl)
    edits = ctrl['box'].children()
    edit_hwnd = edits[0].handle if edits else ctrl['box'].handle
    before = read_shown(ctrl)
    post_reference(edit_hwnd, reference)

    # Wait until the list changes to the verse we asked for.
    want = first_verse(reference)
    deadline = time.monotonic() + READ_TIMEOUT_S
    shown = []
    while time.monotonic() < deadline:
        time.sleep(0.05)
        shown = read_shown(ctrl)
        if shown and shown != before and (want is None or shown[0]['verse'] == want):
            break
    name, short = translation_of(ctrl)
    if not shown:
        return False, 'VideoPsalm did not show a verse. Check the reference in VideoPsalm.', None
    return True, None, {'verses': shown, 'translation': short, 'translationName': name}


def result_json(ok, error, shown, key='shown'):
    result = {'ok': ok}
    if error:
        result['error'] = error
    if shown:
        result[key] = shown
    return json.dumps(result)


if __name__ == "__main__":
    if len(sys.argv) >= 2 and sys.argv[1] == "--check":
        print(json.dumps({"running": is_running()}), flush=True)
        sys.exit(0)

    if len(sys.argv) >= 2 and sys.argv[1] == "--daemon":
        # Look VideoPsalm's controls up now, so the first send is not slow.
        try:
            if find_vp_hwnd():
                controls(find_vp_hwnd())
        except Exception:
            pass
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
            elif action in ("send", "bibles", "set-bible"):
                try:
                    if action == "send":
                        out = result_json(*send_reference(cmd.get("reference", "")))
                    elif action == "bibles":
                        out = result_json(*list_bibles(), key='result')
                    else:
                        out = result_json(*set_bible(cmd.get("name", "")), key='result')
                except Exception as e:
                    out = result_json(False, str(e), None)
                print(out, flush=True)
            else:
                print(json.dumps({"ok": False, "error": f"Unknown action: {action}"}), flush=True)
        sys.exit(0)

    if len(sys.argv) < 2:
        print(json.dumps({"ok": False, "error": "Usage: videopsalm_bridge.py <reference>"}))
        sys.exit(1)

    ok, error, shown = send_reference(sys.argv[1])
    print(result_json(ok, error, shown), flush=True)
    sys.exit(0 if ok else 1)
