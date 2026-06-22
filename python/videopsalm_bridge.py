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


def click(button):
    """Press a VideoPsalm button without bringing VideoPsalm to the front.

    UI Automation's Invoke presses the button but also activates VideoPsalm,
    which pulls the operator out of OBS. A click posted to the window under
    the button is handled the same way and leaves the foreground alone, like
    the keystrokes in post_reference.
    """
    r = button.element_info.rectangle
    sx, sy = (r.left + r.right) // 2, (r.top + r.bottom) // 2
    hwnd = find_vp_hwnd()
    while True:   # the innermost window under the button
        child = win32gui.ChildWindowFromPointEx(hwnd, win32gui.ScreenToClient(hwnd, (sx, sy)), 0x0001 | 0x0004)
        if not child or child == hwnd:
            break
        hwnd = child
    pos = win32api.MAKELONG(*win32gui.ScreenToClient(hwnd, (sx, sy)))
    win32api.PostMessage(hwnd, win32con.WM_MOUSEMOVE, 0, pos)
    win32api.PostMessage(hwnd, win32con.WM_LBUTTONDOWN, win32con.MK_LBUTTON, pos)
    win32api.PostMessage(hwnd, win32con.WM_LBUTTONUP, 0, pos)


def open_bibles_tab(ctrl):
    """Switch VideoPsalm to its Bibles tab, without bringing it to the front.

    The posted click is handled a moment later, so wait until the reference
    box is really showing: keystrokes sent before that are lost.
    """
    click(ctrl['tab'])
    if 'box' not in ctrl:   # first look-up: the box is found after the tab opens
        time.sleep(0.6)
        return
    deadline = time.monotonic() + 1.5
    while time.monotonic() < deadline and not win32gui.IsWindowVisible(ctrl['box'].handle):
        time.sleep(0.05)
    time.sleep(0.15)   # let the box finish appearing before it is typed into


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
    click(button)
    deadline = time.monotonic() + READ_TIMEOUT_S
    while time.monotonic() < deadline:
        time.sleep(0.05)
        full, short = translation_of(ctrl)
        if short.upper().replace('-', '') == name.upper().replace('-', '') or name.lower() in full.lower():
            break
    full, short = translation_of(ctrl)
    book_names(ctrl, short)   # read now, so the next verse is not slowed by it
    return True, None, {'current': short, 'currentName': full}


# VideoPsalm's toggle buttons beside the verse list. Its tooltips are in
# French in some builds, so both languages are matched.
SCREEN_BUTTONS = {
    'text':  re.compile(r'afficher le texte|show.*text', re.I),        # verse text on or off
    'blank': re.compile(r'teindre|turn off|black|blank|screen off', re.I),  # whole screen off
}
STATE_PRESSED = 0x8   # MSAA STATE_SYSTEM_PRESSED


def screen_button(vp_hwnd, kind):
    """VideoPsalm's 'show text' or 'screen off' button."""
    from pywinauto.uia_element_info import UIAElementInfo
    from pywinauto.controls.uiawrapper import UIAWrapper
    ctrl = controls(vp_hwnd)
    if kind not in ctrl:
        root = _uia.iuia.ElementFromHandle(vp_hwnd)
        cond = _uia.iuia.CreatePropertyCondition(
            _uia.UIA_dll.UIA_ControlTypePropertyId, _uia.UIA_dll.UIA_ButtonControlTypeId)
        found = root.FindAll(_uia.tree_scope['descendants'], cond)
        for i in range(found.Length):
            w = UIAWrapper(UIAElementInfo(found.GetElement(i)))
            if SCREEN_BUTTONS[kind].search(w.element_info.name or ''):
                ctrl[kind] = w
                break
        else:
            raise LookupError(kind)
    return ctrl[kind]


def is_pressed(button):
    return bool((button.legacy_properties().get('State') or 0) & STATE_PRESSED)


def press_screen_button(kind):
    """Toggle 'text' or 'blank'; (ok, error, {'kind': ..., 'on': bool})."""
    if kind not in SCREEN_BUTTONS:
        return False, f'Unknown button: {kind}', None
    vp_hwnd = find_vp_hwnd()
    if not vp_hwnd:
        return False, 'VideoPsalm is not open', None
    try:
        button = screen_button(vp_hwnd, kind)
    except LookupError:
        return False, "Could not find that button in VideoPsalm", None
    before = is_pressed(button)
    click(button)
    deadline = time.monotonic() + READ_TIMEOUT_S
    on = before
    while time.monotonic() < deadline:
        time.sleep(0.05)
        on = is_pressed(button)
        if on != before:
            break
    return True, None, {'kind': kind, 'on': on}


def first_verse(reference):
    m = re.search(r':\s*(\d+)', reference)
    return int(m.group(1)) if m else None


# Each Bible in VideoPsalm spells some book names its own way: NKJV lists
# "I Samuel", AMP "1 Samuel"; some say "Song of Songs". VideoPsalm only finds
# a book typed the way that Bible spells it, and guesses otherwise ("1 Samuel"
# in NKJV opens the Song of Songs). So the names are read from VideoPsalm's
# book list for the selected Bible and the reference is typed to match.
BOOK_LIST = 'listBoxControlBibleBooks'
ROMAN = {'1': 'I', '2': 'II', '3': 'III'}
ORDINAL = {'1': 'First', '2': 'Second', '3': 'Third'}
SAME_BOOK = [
    {'song of solomon', 'song of songs', 'canticles', 'song of sol'},
    {'psalms', 'psalm'},
    {'revelation', 'revelations', 'revelation of john'},
]
_book_names = {}   # Bible (e.g. 'NKJV') -> (book names as it lists them, whole list?)


def book_names(ctrl, bible):
    """(names, complete): the books VideoPsalm lists for this Bible.

    Only the books in view are exposed, so `complete` is False when the list
    scrolls. Right after a Bible switch the list may still be empty; it is read
    again until it fills, and an empty read is never remembered.
    """
    if bible in _book_names:
        return _book_names[bible]
    if 'books' not in ctrl:
        root = _uia.iuia.ElementFromHandle(find_vp_hwnd())
        ctrl['books'] = _find(root, _uia.UIA_dll.UIA_AutomationIdPropertyId, BOOK_LIST)
    def in_view():
        children = ctrl['books'].children()
        names = [c.element_info.name for c in children if c.element_info.control_type == 'ListItem']
        bar = next((c for c in children if c.element_info.control_type == 'ScrollBar'), None)
        return names, bar

    deadline = time.monotonic() + 1.5
    names, bar = in_view()
    while not names and time.monotonic() < deadline:
        time.sleep(0.1)
        names, bar = in_view()
    if not names:
        return [], False

    # The list shows a page of books at a time. Page to the start, then to the
    # end, with its own Page Left / Page Right buttons (clicked the focus-safe
    # way), collecting every book. Done once per Bible.
    complete = bar is None
    if bar is not None:
        seen = list(names)
        parts = {p.element_info.name: p for p in bar.children()}
        for button, steps in (('Page Left', 6), ('Page Right', 10), ('Page Left', 10)):
            part = parts.get(button)
            for _ in range(steps):
                if part is None or part.element_info.rectangle.width() <= 0:
                    break   # that end of the list is reached
                click(part)
                time.sleep(0.25)
                seen += [n for n in in_view()[0] if n not in seen]
        complete = len(seen) >= 66 or (parts.get('Page Right') is not None and
                                       parts['Page Right'].element_info.rectangle.width() <= 0)
        names = seen
    _book_names[bible] = (names, complete)
    return names, complete


def as_videopsalm_spells(reference, names, complete=False):
    """'1 Samuel 17:45' -> 'I Samuel 17:45' when this Bible lists 'I Samuel'.

    The list shows only the books that fit on screen, so a book out of view
    takes the style of those in view (Roman numerals or digits). Returns None
    when the whole list is in view and the book is not in it: some Bibles
    (TPT) do not include every book.
    """
    m = re.match(r'^\s*(?:([1-3])\s+)?([A-Za-z][A-Za-z ]*?)\s+(\d.*)$', reference)
    if not m or not names:
        return reference
    number, book, rest = m.groups()
    listed = {n.lower(): n for n in names}
    if number:
        forms = [f'{number} {book}', f'{ROMAN[number]} {book}', f'{ORDINAL[number]} {book}']
        for form in forms:
            if form.lower() in listed:
                return f'{listed[form.lower()]} {rest}'
        if complete:
            return None
        roman = any(re.match(r'^I{1,3} ', n) for n in names)
        return f'{ROMAN[number] if roman else number} {book} {rest}'
    group = next((g for g in SAME_BOOK if book.lower() in g), {book.lower()})
    for name in group:
        if name in listed:
            return f'{listed[name]} {rest}'
    return None if complete else reference


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
    want = first_verse(reference)

    # Type it, then wait until the list changes to the verse we asked for. If
    # VideoPsalm missed the keystrokes (it was still busy), type it once more.
    bible = translation_of(ctrl)[1]
    typed = as_videopsalm_spells(reference, *book_names(ctrl, bible))
    if typed is None:
        book = re.sub(r'\s+\d[\d:\-, ]*$', '', reference)
        return False, f'{bible} does not include {book}. Switch VideoPsalm to another Bible.', None
    for _ in range(2):
        post_reference(edit_hwnd, typed)
        shown, landed = wait_for_verse(ctrl, want, before)
        if landed:
            break
    name, short = translation_of(ctrl)
    if not shown:
        return False, 'VideoPsalm did not show a verse. Check the reference in VideoPsalm.', None
    return True, None, {'verses': shown, 'translation': short, 'translationName': name}


def wait_for_verse(ctrl, want, before):
    """Poll VideoPsalm's list; (shown, True) once it shows the verse asked for."""
    start = time.monotonic()
    shown = []
    while time.monotonic() - start < READ_TIMEOUT_S:
        time.sleep(0.05)
        shown = read_shown(ctrl)
        right = shown and (want is None or shown[0]['verse'] == want)
        # A changed list is the new verse. An unchanged one that already shows
        # the verse asked for is a resend of what is on screen: accept it after
        # a moment rather than waiting for a change that will not come.
        if right and (shown != before or time.monotonic() - start > 0.3):
            return shown, True
    return shown, False


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
        # Look VideoPsalm's controls and the current Bible's book names up now,
        # so the first send of the service is not the slow one.
        try:
            if find_vp_hwnd():
                warm = controls(find_vp_hwnd())
                book_names(warm, translation_of(warm)[1])
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
            elif action in ("send", "bibles", "set-bible", "press"):
                try:
                    if action == "send":
                        out = result_json(*send_reference(cmd.get("reference", "")))
                    elif action == "bibles":
                        out = result_json(*list_bibles(), key='result')
                    elif action == "press":
                        out = result_json(*press_screen_button(cmd.get("button", "")), key='result')
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
