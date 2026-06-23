/**
 * companion.js: Scripture Panel Companion, the program for the second laptop.
 *
 * Laptop 1 runs the full Scripture Panel (Whisper, detection, LM Studio). This
 * runs next to VideoPsalm on laptop 2 and does three things:
 *   - carries out VideoPsalm commands from laptop 1 (POST /command), through
 *     the same bridge laptop 1 uses;
 *   - shows the mini panel docked to this laptop's VideoPsalm or OBS, with the
 *     state laptop 1 publishes (POST /mini/state);
 *   - passes this panel's buttons and keys back to laptop 1 (GET /mini/actions,
 *     which laptop 1 keeps open), so laptop 1 stays the single source of truth
 *     and both panels always agree.
 *
 * Laptop 1 makes every connection, using the address and key in its Settings,
 * so only that one laptop needs setting up. Every request must carry the key.
 */

const { app } = require('electron')
const { spawn } = require('child_process')
const { join } = require('path')
const crypto = require('crypto')
const fs = require('fs')
const http = require('http')
const os = require('os')

// Its own settings and log, separate from a Scripture Panel on the same PC.
app.setName('Scripture Panel Companion')
app.setPath('userData', join(app.getPath('appData'), 'scripture-panel-companion'))

const miniPanel = require('./miniPanel')
const hotkeys = require('./hotkeys')
const settings = require('./settings')
const log = require('./logger')

const PORT = 8765
const BRIDGE_TIMEOUT_MS = 5000
const BRIDGE_FIRST_TIMEOUT_MS = 20000   // a new bridge first reads VideoPsalm's controls and book names
const LONG_POLL_MS = 25000
const LINK_LOST_MS = 12000              // laptop 1 repeats its state every 4 s

// ---------------------------------------------------------------------------
// The packaged helper (or the Python scripts when developing)
// ---------------------------------------------------------------------------

function helper(mode) {
  if (app.isPackaged) {
    const dir = join(process.resourcesPath, 'vp-helper')
    return { cmd: join(dir, 'vp-helper.exe'), args: [`--${mode}`], cwd: dir }
  }
  const dir = join(__dirname, '../../python')
  return { cmd: 'python', args: [join(dir, 'vp_helper.py'), `--${mode}`], cwd: dir }
}

// ---------------------------------------------------------------------------
// VideoPsalm bridge: one JSON command, one JSON line back, in order
// ---------------------------------------------------------------------------

let bridge = null
let bridgeFresh = false
let queue = Promise.resolve()

function startBridge() {
  const { cmd, args, cwd } = helper('bridge')
  const proc = spawn(cmd, args, { cwd, windowsHide: true })
  proc.waiting = []
  let buffer = ''
  proc.stdout.on('data', (chunk) => {
    buffer += chunk.toString()
    let i
    while ((i = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, i).trim()
      buffer = buffer.slice(i + 1)
      if (line) proc.waiting.shift()?.(line)
    }
  })
  proc.on('error', (err) => log.error('companion', 'Bridge failed to start', { error: err.message }))
  proc.on('exit', () => { if (bridge === proc) bridge = null })
  bridge = proc
  bridgeFresh = true
  log.info('companion', 'VideoPsalm bridge started')
}

function askBridge(cmd) {
  return new Promise((resolve) => {
    if (!bridge) startBridge()
    const proc = bridge
    const limit = bridgeFresh ? BRIDGE_FIRST_TIMEOUT_MS : BRIDGE_TIMEOUT_MS
    bridgeFresh = false
    const timer = setTimeout(() => {
      log.error('companion', 'VideoPsalm did not respond, restarting the bridge', { action: cmd.action })
      proc.kill()
      if (bridge === proc) bridge = null
      resolve({ ok: false, running: false, error: 'VideoPsalm did not respond' })
    }, limit)
    proc.waiting.push((line) => {
      clearTimeout(timer)
      try { resolve(JSON.parse(line)) }
      catch { resolve({ ok: false, error: 'Bad answer from the bridge' }) }
    })
    proc.stdin.write(JSON.stringify(cmd) + '\n')
  })
}

/** One command at a time, in the order they arrived. */
function runCommand(cmd) {
  const run = queue.then(() => askBridge(cmd))
  queue = run.catch(() => {})
  return run
}

// ---------------------------------------------------------------------------
// State from laptop 1, actions back to it
// ---------------------------------------------------------------------------

let lastState = null
let lastSeen = 0
let linked = false
let actions = []
let waiter = null   // laptop 1's open GET /mini/actions

function loadKey() {
  const path = join(app.getPath('userData'), 'receiver-key.json')
  try {
    return JSON.parse(fs.readFileSync(path, 'utf8')).key
  } catch {
    const key = crypto.randomBytes(8).toString('hex')
    fs.mkdirSync(app.getPath('userData'), { recursive: true })
    fs.writeFileSync(path, JSON.stringify({ key }))
    return key
  }
}

let key = ''

function addresses() {
  const out = []
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    if (/vEthernet|WSL|Hyper-V|VirtualBox|VMware|Loopback|TunnelBear|Bluetooth/i.test(name)) continue
    for (const a of list || []) {
      // A real network is /24 or wider; tiny subnets belong to virtual adapters.
      const wide = Number(String(a.cidr).split('/')[1]) <= 24
      if (a.family === 'IPv4' && !a.internal && wide) out.push(`${a.address}:${PORT}`)
    }
  }
  return out
}

/** What the panel shows: laptop 1's state, plus how to pair while it is away. */
function showPanel() {
  const remote = { connected: linked, addresses: addresses(), key }
  miniPanel.showState(linked && lastState ? { ...lastState, remote } : { suggestions: [], remote })
}

function queueAction(action) {
  actions.push(action)
  if (waiter) flushActions()
}

function flushActions() {
  const { res, timer } = waiter
  clearTimeout(timer)
  waiter = null
  reply(res, 200, { actions })
  actions = []
}

// Laptop 1 repeats its state, so a silence means the link is gone.
setInterval(() => {
  const now = Date.now() - lastSeen < LINK_LOST_MS
  if (now !== linked) {
    linked = now
    log.info('companion', linked ? 'Linked to the Scripture Panel' : 'Scripture Panel link lost')
    showPanel()
  }
}, 2000)

// ---------------------------------------------------------------------------
// Network
// ---------------------------------------------------------------------------

function reply(res, status, body) {
  const data = JSON.stringify(body)
  res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) })
  res.end(data)
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = ''
    req.on('data', (chunk) => {
      data += chunk
      if (data.length > 1_000_000) { reject(new Error('Too large')); req.destroy() }
    })
    req.on('end', () => {
      try { resolve(JSON.parse(data || '{}')) } catch (err) { reject(err) }
    })
    req.on('error', reject)
  })
}

function sameKey(given) {
  const a = Buffer.from(String(given || ''))
  const b = Buffer.from(key)
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}

function startServer() {
  const server = http.createServer(async (req, res) => {
    if (!sameKey(req.headers['x-receiver-key'])) return reply(res, 403, { ok: false, error: 'Wrong receiver key' })
    try {
      if (req.method === 'POST' && req.url === '/command') {
        return reply(res, 200, await runCommand(await readBody(req)))
      }
      if (req.method === 'POST' && req.url === '/mini/state') {
        lastState = await readBody(req)
        lastSeen = Date.now()
        linked = true
        showPanel()
        return reply(res, 200, { ok: true })
      }
      if (req.method === 'GET' && req.url === '/mini/actions') {
        lastSeen = Date.now()
        if (waiter) flushActions()   // a newer connection replaces an old one
        if (actions.length) { reply(res, 200, { actions }); actions = []; return }
        const timer = setTimeout(() => { if (waiter?.res === res) { waiter = null; reply(res, 200, { actions: [] }) } }, LONG_POLL_MS)
        waiter = { res, timer }
        req.on('close', () => { if (waiter?.res === res) { clearTimeout(timer); waiter = null } })
        return
      }
      return reply(res, 404, { ok: false, error: 'Not found' })
    } catch (err) {
      return reply(res, 400, { ok: false, error: err.message })
    }
  })
  server.on('error', (err) => log.error('companion', 'Could not listen', { port: PORT, error: err.message }))
  server.listen(PORT, '0.0.0.0', () => log.info('companion', 'Listening', { addresses: addresses() }))
}

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.whenReady().then(() => {
    key = loadKey()
    settings.load()
    startServer()
    startBridge()

    miniPanel.init({
      preload: join(__dirname, '../preload/index.js'),
      rendererUrl: !app.isPackaged ? process.env['ELECTRON_RENDERER_URL'] : null,
      rendererFile: join(__dirname, '../renderer/index.html'),
      watchCommand: helper('watch'),
      hash: 'mini-remote',
      onAction: (action) => {
        if (action?.type === 'publish') showPanel()
        queueAction(action)
      },
    })

    hotkeys.register({
      toRenderer: queueAction,
      pressScreenButton: async (button) => {
        queueAction({ type: 'press', button })
        return { forwarded: true }
      },
      toggleMini: () => miniPanel.toggleCollapsed(),
    })
  })

  app.on('will-quit', () => hotkeys.unregister())
  app.on('before-quit', () => { miniPanel.stop(); bridge?.kill() })
  // The panel hides when VideoPsalm is not in front; that must not quit the app.
  app.on('window-all-closed', () => {})
}
