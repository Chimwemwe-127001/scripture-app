/**
 * companion.js: Scripture Panel Companion, the program for the second laptop.
 *
 * Laptop 1 runs the full Scripture Panel (Whisper, detection, LM Studio). This
 * runs next to VideoPsalm on laptop 2 and:
 *   - shows the mini panel docked to this laptop's VideoPsalm or OBS, with the
 *     cards laptop 1 publishes (POST /mini/state);
 *   - sends a card, switches the Bible and presses Text or Blank on this
 *     laptop's VideoPsalm only, when someone here presses it. Laptop 1 drives
 *     its own VideoPsalm the same way, so neither screen follows the other;
 *   - passes the listen button back to laptop 1 (GET /mini/actions, which
 *     laptop 1 keeps open), as listening happens there;
 *   - still carries out VideoPsalm commands from laptop 1 (POST /command), for
 *     a setup where only this laptop has VideoPsalm.
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
const { matchBible } = require('./translationRequest')

const PORT = 8765
const BRIDGE_TIMEOUT_MS = 5000
const BRIDGE_FIRST_TIMEOUT_MS = 20000   // a new bridge first reads VideoPsalm's controls and book names
const LONG_POLL_MS = 25000
const LINK_SHAKY_MS = 10000             // laptop 1 repeats its state every 4 s
const LINK_LOST_MS = 30000              // only then show the pairing details again
const ASK_TTL_MS = 2 * 60 * 1000        // a Bible request fades after 2 minutes, as on laptop 1

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

// This laptop's own screen: what it shows, its messages, and the Bible request
// it has not answered yet. Laptop 1 keeps its own, so they never mix.
const own = { live: null, notice: '', error: '', ask: null, answered: '' }
let noticeTimer = null

function say(text, isError = false) {
  own.notice = isError ? '' : text
  own.error = isError ? text : ''
  clearTimeout(noticeTimer)
  noticeTimer = setTimeout(() => { own.notice = ''; own.error = ''; showPanel() }, isError ? 8000 : 4000)
  showPanel()
}

/** A new Bible request from laptop 1 stays here until someone here answers it. */
function takeAsk(ask) {
  const id = ask ? `${ask.code}|${ask.at}` : ''
  if (ask && id !== own.answered && id !== own.ask?.id) own.ask = { ...ask, id }
}

/** What the panel shows: laptop 1's cards with this laptop's own screen, plus how to pair while it is away. */
function showPanel() {
  const remote = { connected: linked, reconnecting: shaky, addresses: addresses(), key }
  if (own.ask && Date.now() - own.ask.at > ASK_TTL_MS) own.ask = null
  const mine = { live: own.live, notice: own.notice, error: own.error, translationAsk: own.ask }
  miniPanel.showState(linked && lastState ? { ...lastState, ...mine, remote } : { suggestions: [], ...mine, remote })
}

async function sendCard(number) {
  const card = lastState?.suggestions?.[number - 1]
  if (!card) return
  say(`Sending ${card.reference} to VideoPsalm`)
  const t0 = Date.now()
  const r = await runCommand({ action: 'send', reference: card.reference })
  if (!r?.ok) {
    log.warn('companion', 'Send failed', { reference: card.reference, error: r?.error })
    return say(`VideoPsalm: ${r?.error || 'did not answer'}`, true)
  }
  const first = r.shown?.verses?.[0]?.verse
  own.live = {
    reference: card.reference,
    translation: r.shown?.translation,
    mismatch: card.verseStart && first && first !== card.verseStart ? `VideoPsalm shows verse ${first}, not ${card.verseStart}` : null,
  }
  log.info('companion', 'On screen', { reference: card.reference, ms: Date.now() - t0, translation: r.shown?.translation })
  say(`${card.reference} is on screen`)
}

async function switchBible() {
  const ask = own.ask
  if (!ask) return
  const listed = await runCommand({ action: 'bibles' })
  if (!listed?.ok) return say(`VideoPsalm: ${listed?.error || 'did not answer'}`, true)
  const name = matchBible(ask.code, listed.result.bibles)
  if (!name) return say(`VideoPsalm: ${ask.code} is not among its Bibles (${listed.result.bibles.join(', ')})`, true)
  const r = await runCommand({ action: 'set-bible', name })
  if (!r?.ok) return say(`VideoPsalm: ${r?.error || 'could not switch Bible'}`, true)
  own.answered = ask.id
  own.ask = null
  log.info('companion', 'Bible switched', { code: ask.code, name })
  const live = own.live
  if (live) {
    const again = await runCommand({ action: 'send', reference: live.reference })
    if (again?.ok) own.live = { ...live, translation: again.shown?.translation, mismatch: null }
  }
  say(`VideoPsalm now uses ${r.result?.current || name}${live ? `, ${live.reference} shown again` : ''}`)
}

async function pressButton(button) {
  const r = await runCommand({ action: 'press', button })
  return r?.ok ? { ok: true, on: r.result?.on } : { ok: false, error: r?.error || 'did not answer' }
}

/** A press in this laptop's panel or keys. Only listening goes to laptop 1. */
function act(action) {
  switch (action?.type) {
    case 'send': return sendCard(action.number)
    case 'switch-bible': return switchBible()
    case 'dismiss-translation':
      if (own.ask) { own.answered = own.ask.id; own.ask = null; showPanel() }
      return
    case 'notice': return say(action.text, /^VideoPsalm:/.test(action.text))
    case 'publish': showPanel(); return queueAction(action)
    default: return queueAction(action)   // toggle-listen
  }
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

// Laptop 1 repeats its state every 4 s. A short silence (a busy network)
// shows "Reconnecting" over the last state; only a long one goes back to the
// pairing details.
let shaky = false
setInterval(() => {
  const quiet = Date.now() - lastSeen
  const nowLinked = quiet < LINK_LOST_MS
  const nowShaky = nowLinked && quiet > LINK_SHAKY_MS
  if (nowLinked !== linked || nowShaky !== shaky) {
    if (nowLinked !== linked) log.info('companion', nowLinked ? 'Linked to the Scripture Panel' : 'Scripture Panel link lost')
    else if (nowShaky) log.warn('companion', 'No word from the Scripture Panel for 10 s')
    linked = nowLinked
    shaky = nowShaky
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
        takeAsk(lastState.translationAsk)
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
      onAction: act,
    })

    hotkeys.register({
      toRenderer: act,
      pressScreenButton: pressButton,
      toggleMini: () => miniPanel.toggleCollapsed(),
    })
  })

  app.on('will-quit', () => hotkeys.unregister())
  app.on('before-quit', () => { miniPanel.stop(); bridge?.kill() })
  // The panel hides when VideoPsalm is not in front; that must not quit the app.
  app.on('window-all-closed', () => {})
}
