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
const { join } = require('path')
const settings = require('./settings')
const log = require('./logger')

const COLLAPSED_H = 40   // just the title strip

let win = null
let watch = null
let vp = null            // last report from the watcher
let lastHost = null      // where the panel was last docked, kept while it has focus
let placing = false      // true while we move the panel ourselves
let dragging = false     // true while the operator drags or resizes it
let opts = null          // { getMain, preload, rendererUrl, rendererFile, python, pythonDir }

function init(options) {
  opts = options

  ipcMain.on('mini-state', (_e, state) => win?.webContents.send('mini-state', state))
  ipcMain.on('mini-action', (_e, action) => {
    const main = opts.getMain()
    if (action?.type === 'open-main') {
      if (!main) return
      if (main.isMinimized()) main.restore()
      // Windows may refuse to bring a window forward; a moment always-on-top wins.
      main.setAlwaysOnTop(true)
      main.show()
      main.focus()
      main.setAlwaysOnTop(false)
    } else if (action?.type === 'collapse') {
      toggleCollapsed()
    } else {
      main?.webContents.send('mini-action', action)
    }
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
  win.setAlwaysOnTop(true, 'floating')

  if (opts.rendererUrl) win.loadURL(`${opts.rendererUrl}#mini`)
  else win.loadFile(opts.rendererFile, { hash: 'mini' })

  // Only the operator's own drags count. Electron also reports "moved" when
  // it first shows the window, and DPI rounding can change the size by a
  // pixel, neither of which should be saved.
  win.on('will-move', () => { dragging = true })
  win.on('will-resize', () => { dragging = true })
  win.on('moved', saveOffset)
  win.on('resized', saveOffset)
  // Moving between the panel and the full window does not change which
  // process is in front, so the watcher does not report it.
  win.on('blur', () => setTimeout(place, 300))
  win.on('closed', () => { win = null })
}

function startWatch() {
  const proc = spawn(opts.python, [join(opts.pythonDir, 'vp_window_watch.py')], {
    cwd: opts.pythonDir, windowsHide: true,
  })
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
  if (fg.name?.startsWith('obs') && /^OBS/.test(fg.title || '') && !fg.minimized && fg.rect) {
    return { key: 'obs', rect: toDip(fg.rect) }
  }
  if (win?.isFocused()) return lastHost   // the operator is using the panel itself
  return null
}

function place() {
  if (!win || win.isDestroyed()) return
  const host = currentHost()
  if (!host) {
    if (win.isVisible()) win.hide()
    return
  }
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
  if (!win.isVisible()) win.showInactive()
}

/** The operator dragged or resized the panel: remember where, relative to its host. */
function saveOffset() {
  if (!dragging || placing || !win || !lastHost) return
  dragging = false
  const key = OFFSET_KEY[lastHost.key]
  const r = lastHost.rect
  const b = win.getBounds()
  const s = settings.load()
  settings.save({
    [key]: {
      x: b.x - r.x,
      y: b.y - r.y,
      w: b.width,
      h: s.miniCollapsed ? s[key].h : b.height,
    },
  })
}

/** Fold the panel to its title strip, or open it again. */
function toggleCollapsed() {
  settings.save({ miniCollapsed: !settings.load().miniCollapsed })
  place()
}

module.exports = { init, stop, toggleCollapsed }
