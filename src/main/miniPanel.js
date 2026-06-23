/**
 * miniPanel.js: a small window docked to VideoPsalm or OBS, so the operator
 * can work from either without opening the full window.
 *
 * VideoPsalm has no plugin API, so the panel cannot live inside it. Instead it
 * is a frameless, always-on-top window that follows the program in front:
 *   - python/vp_window_watch.py reports where VideoPsalm is and which program
 *     is in front;
 *   - over VideoPsalm or OBS's main window, the panel keeps a saved offset from
 *     that window's top-left corner (one offset each); dragging it saves a new
 *     one;
 *   - over any other program it hides, and it also hides when VideoPsalm is
 *     closed.
 *
 * The full window stays the single source of truth. Its renderer publishes a
 * small snapshot (suggestions, what is on screen, translation request), the
 * panel displays it, and the panel's buttons and keys are passed back to the
 * full window, which sends to VideoPsalm exactly as it does for its own keys.
 */

const { BrowserWindow, ipcMain, screen } = require('electron')
const { spawn } = require('child_process')
const settings = require('./settings')
const log = require('./logger')

const COLLAPSED_H = 40   // just the title strip
// On Windows, Electron only makes a window truly topmost for levels above
// 'floating'; with 'floating' (or none) the panel slipped behind VideoPsalm
// whenever VideoPsalm was clicked.
const ON_TOP = 'pop-up-menu'

let win = null
let watch = null
let vp = null            // last report from the watcher
let lastHost = null      // where the panel was last docked, kept while it has focus
let shownOn = null       // the host the panel was last shown over, null while hidden
let placing = false      // true while we move the panel ourselves
let dragging = 0         // when the operator started dragging or resizing it, 0 when not
const DRAG_GIVE_UP_MS = 15000   // a drag whose end Windows never reported
let opts = null          // { preload, rendererUrl, rendererFile, watchCommand, onAction, openMain, hash }

function init(options) {
  opts = options

  ipcMain.on('mini-action', (_e, action) => {
    if (action?.type === 'open-main') opts.openMain?.()
    else if (action?.type === 'collapse') toggleCollapsed()
    else opts.onAction(action)
  })
  ipcMain.handle('set-mini-panel', (_e, on) => {
    settings.save({ miniPanel: !!on })
    if (on) start()
    else stop()
    return !!on
  })

  if (settings.load().miniPanel) start()
}

function start() {
  if (!win) createWindow()
  if (!watch) startWatch()
}

function stop() {
  const w = watch
  watch = null
  w?.kill()
  win?.destroy()
  win = null
}

function createWindow() {
  const o = settings.load().miniOffset
  win = new BrowserWindow({
    width: o.w,
    height: o.h,
    minWidth: 240,
    minHeight: COLLAPSED_H,
    show: false,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    title: 'Scripture Panel (mini)',
    backgroundColor: '#141518',
    webPreferences: { preload: opts.preload, sandbox: false, contextIsolation: true },
  })
  win.setAlwaysOnTop(true, ON_TOP)

  const hash = opts.hash || 'mini'
  if (opts.rendererUrl) win.loadURL(`${opts.rendererUrl}#${hash}`)
  else win.loadFile(opts.rendererFile, { hash })

  // Only the operator's own drags count. Electron also reports "moved" when
  // it first shows the window, and DPI rounding can change the size by a
  // pixel, neither of which should be saved.
  // While the operator drags, the watcher keeps reporting the host window and
  // place() would pull the panel back to its old spot under the mouse, so
  // place() leaves it alone until the drag ends.
  win.on('will-move', () => { if (!placing) dragging = Date.now() })
  win.on('will-resize', () => { if (!placing) dragging = Date.now() })
  win.on('moved', saveOffset)
  win.on('resized', saveOffset)
  // Moving between the panel and the full window does not change which
  // process is in front, so the watcher does not report it.
  win.on('blur', () => setTimeout(place, 300))
  win.on('closed', () => { win = null })
}

function startWatch() {
  const { cmd, args, cwd } = opts.watchCommand
  const proc = spawn(cmd, args, { cwd, windowsHide: true })
  watch = proc
  let buffer = ''
  proc.stdout.on('data', (chunk) => {
    buffer += chunk.toString()
    let i
    while ((i = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, i).trim()
      buffer = buffer.slice(i + 1)
      let state = null
      try { state = JSON.parse(line) } catch { continue }   // not a whole line yet
      vp = state
      try { place() } catch (err) { log.warn('mini', 'Could not place the panel', { error: err.message }) }
    }
  })
  proc.on('exit', (code) => {
    if (watch !== proc) return            // stopped on purpose
    watch = null
    log.warn('mini', 'Window watcher exited, restarting', { code })
    setTimeout(() => { if (win && !watch) startWatch() }, 3000)
  })
}

// Where each host keeps its offset in settings.
const OFFSET_KEY = { vp: 'miniOffset', obs: 'miniOffsetObs' }

/** A physical-pixel rect [l, t, r, b] in DIPs, the unit Electron positions windows in. */
function toDip([l, t, r, b]) {
  return screen.screenToDipRect(null, { x: l, y: t, width: r - l, height: b - t })
}

/** The window the panel should sit on now: { key: 'vp' | 'obs', rect }, or null to hide. */
function currentHost() {
  if (!vp?.open) return null
  const fg = vp.fg || {}
  if (vp.fgPid === vp.vpPid && !vp.minimized) return { key: 'vp', rect: toDip(vp.rect) }
  // OBS's main window title starts with "OBS"; its dialogs (Settings...) do not.
  if (fg.name?.startsWith('obs') && /^OBS\b/.test(fg.title || '') && !fg.minimized && fg.rect) {
    return { key: 'obs', rect: toDip(fg.rect) }
  }
  if (win?.isFocused()) return lastHost   // the operator is using the panel itself
  return null
}

function place() {
  if (!win || win.isDestroyed()) return
  const host = currentHost()
  if (!host) {
    shownOn = null
    if (win.isVisible()) win.hide()
    return
  }
  if (dragging && Date.now() - dragging < DRAG_GIVE_UP_MS) {
    if (!win.isVisible()) win.showInactive()
    return
  }
  dragging = 0
  if (host.key !== lastHost?.key) log.info('mini', 'Panel docked', { on: host.key === 'obs' ? 'OBS' : 'VideoPsalm' })
  lastHost = host

  const r = host.rect
  const s = settings.load()
  const o = s[OFFSET_KEY[host.key]]
  const h = s.miniCollapsed ? COLLAPSED_H : o.h
  // Keep the panel inside its host window, wherever that is.
  const x = Math.min(Math.max(r.x + o.x, r.x), r.x + r.width - o.w)
  const y = Math.min(Math.max(r.y + o.y, r.y), r.y + r.height - h)
  const want = { x: Math.round(x), y: Math.round(y), width: o.w, height: h }

  const now = win.getBounds()
  if (now.x !== want.x || now.y !== want.y || now.width !== want.width || now.height !== want.height) {
    placing = true
    win.setBounds(want)
    setTimeout(() => { placing = false }, 250)
  }
  if (!win.isVisible() || host.key !== shownOn) {
    win.showInactive()
    win.setAlwaysOnTop(true, ON_TOP)
    win.moveTop()
    shownOn = host.key
  }
}

/** The operator dragged or resized the panel: remember where, relative to its host. */
function saveOffset() {
  if (!dragging || placing || !win || !lastHost) return
  dragging = 0
  const key = OFFSET_KEY[lastHost.key]
  // The host may have moved since it was last reported.
  const host = currentHost()
  const r = (host?.key === lastHost.key ? host : lastHost).rect
  const b = win.getBounds()
  const s = settings.load()
  // Saved as it will be shown: kept inside the host window, so the panel
  // does not jump when it is next placed.
  const h = s.miniCollapsed ? COLLAPSED_H : b.height
  const x = Math.min(Math.max(b.x, r.x), r.x + r.width - b.width)
  const y = Math.min(Math.max(b.y, r.y), r.y + r.height - h)
  settings.save({
    [key]: {
      x: Math.round(x - r.x),
      y: Math.round(y - r.y),
      w: b.width,
      h: s.miniCollapsed ? s[key].h : b.height,
    },
  })
  place()
}

/** Fold the panel to its title strip, or open it again. */
function toggleCollapsed() {
  settings.save({ miniCollapsed: !settings.load().miniCollapsed })
  place()
}

/** Show a state in the panel. */
function showState(state) {
  win?.webContents.send('mini-state', state)
}

module.exports = { init, stop, toggleCollapsed, showState }
