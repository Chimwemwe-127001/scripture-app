const { app, BrowserWindow, ipcMain, clipboard } = require('electron')
const { join } = require('path')
const { spawn, execFile } = require('child_process')
const chunker        = require('./chunker')
const llmClient      = require('./llmClient')
const bibleDb        = require('./bibleDb')
const bibleExtractor = require('./bibleExtractor')
const { ReadingContext } = require('./readingContext')
const { VerseSearch, isStrong, forJudge } = require('./verseSearch')
const { detectTranslations, matchBible } = require('./translationRequest')
const settings       = require('./settings')
const miniPanel      = require('./miniPanel')
const hotkeys        = require('./hotkeys')
const log            = require('./logger')

let mainWindow = null
let whisperProcess = null

/**
 * Suggestion de-duplication over a time window.
 *
 * The same verse is not suggested twice within ten minutes, so overlapping
 * chunks do not produce duplicate cards. After the window expires the verse
 * can appear again, because preachers often return to a key text later on.
 */
const DEDUPE_WINDOW_MS = 10 * 60 * 1000
// A verse named out loud again ("John 3:16") is wanted again: the preacher has
// come back to it. Only a repeat inside the same breath is dropped.
const NAMED_REPEAT_MS = 30 * 1000
let sentRefs = new Map()   // reference -> timestamp last suggested

function shouldSuggest(reference, windowMs = DEDUPE_WINDOW_MS) {
  const now = Date.now()
  const last = sentRefs.get(reference)
  if (last !== undefined && now - last < windowMs) return false
  sentRefs.set(reference, now)
  return true
}

function pruneSentRefs() {
  const cutoff = Date.now() - DEDUPE_WINDOW_MS
  for (const [ref, ts] of sentRefs) {
    if (ts < cutoff) sentRefs.delete(ref)
  }
}

// Rolling transcript context. Gives the LLM the last few sentences of the
// sermon so it can resolve phrases like "as Paul says here".
const CONTEXT_MAX_WORDS = 160
let _transcriptWords = []

// The passage the preacher is in, so "verse 16" on its own can be placed.
const readingContext = new ReadingContext()

// Keyword index of every KJV verse, for verses quoted without being named.
// Built in the background once the window is up (about a second).
let verseSearch = null
let _previousLine = ''   // quotes often run across two transcript lines

// Lines search could not settle on its own wait here for the LLM judge. One
// question at a time, and only the newest waiting line is kept: a card for
// what is being said now matters more than one for ten seconds ago.
let _judgeBusy = false
let _judgeNext = null

// ---------------------------------------------------------------------------
// Python helpers
// ---------------------------------------------------------------------------

function pythonCmd() {
  return process.platform === 'win32' ? 'python' : 'python3'
}

function pythonDir() {
  return app.isPackaged
    ? join(process.resourcesPath, 'python')
    : join(__dirname, '../../python')
}

function runPythonJson(scriptName, args = []) {
  return new Promise((resolve) => {
    const p = spawn(pythonCmd(), [join(pythonDir(), scriptName), ...args])
    let out = ''
    let err = ''
    p.stdout.on('data', (d) => { out += d.toString() })
    p.stderr.on('data', (d) => { err += d.toString() })
    p.on('error', () => resolve({ error: 'Python not found. Is Python installed?' }))
    p.on('close', () => {
      try { resolve(JSON.parse(out.trim())) }
      catch { resolve({ error: err || 'Failed to parse output' }) }
    })
  })
}

/**
 * Split a stream of stdout chunks into complete lines.
 *
 * A chunk can end in the middle of a line, so the incomplete tail is kept
 * and joined to the next chunk. Without this, JSON messages split across two
 * chunks would fail to parse and be lost.
 */
function lineReader(onLine) {
  let buffer = ''
  return (data) => {
    buffer += data.toString()
    const lines = buffer.split('\n')
    buffer = lines.pop()
    for (const line of lines) {
      if (line.trim()) onLine(line.trim())
    }
  }
}

/**
 * Stop Whisper gracefully.
 *
 * On Windows, kill() calls TerminateProcess, which can leave the audio device
 * locked. The worker listens on stdin for "stop", so ask first and only force
 * termination if it has not exited after the grace period.
 */
function killWhisper({ graceMs = 1500 } = {}) {
  const proc = whisperProcess
  whisperProcess = null
  chunker.stop()

  if (!proc) return

  let settled = false
  const force = setTimeout(() => {
    if (settled) return
    settled = true
    log.warn('whisper', 'Graceful stop timed out, forcing termination')
    try { proc.kill() } catch { /* already gone */ }
  }, graceMs)

  proc.once('exit', () => {
    settled = true
    clearTimeout(force)
  })

  try {
    proc.stdin.write('stop\n')
    proc.stdin.end()
  } catch {
    settled = true
    clearTimeout(force)
    try { proc.kill() } catch { /* already gone */ }
  }
}

// ---------------------------------------------------------------------------
// Persistent VideoPsalm bridge daemon
// ---------------------------------------------------------------------------

let _vpProc  = null   // the long-lived python process
let _vpQueue = []     // pending {cmd, resolve, reject, timer}
let _vpBusy  = false

/**
 * How long to wait for the bridge to answer one command.
 *
 * VideoPsalm can block (a modal dialog, SetForegroundWindow waiting). If a
 * command never returns, the bridge is restarted so later sends still work.
 */
const VP_TIMEOUT_MS = 5000

function _getVpProc() {
  if (_vpProc && !_vpProc.killed) return _vpProc

  _vpProc = spawn(pythonCmd(), [join(pythonDir(), 'videopsalm_bridge.py'), '--daemon'])
  log.info('vpBridge', 'Spawned VideoPsalm bridge daemon')

  _vpProc.on('error', (err) => {
    log.error('vpBridge', 'Failed to spawn bridge', { error: err.message })
    _failAllVp(new Error(`VideoPsalm bridge unavailable: ${err.message}`))
  })

  // The bridge answers each command with exactly one JSON line, in order.
  _vpProc.stdout.on('data', lineReader((line) => {
    const entry = _vpQueue.shift()
    if (!entry) {
      // Unexpected output. Ignore it so it cannot shift the pairing of
      // commands and responses.
      log.warn('vpBridge', 'Unsolicited line from bridge', { line: line.slice(0, 120) })
      return
    }
    clearTimeout(entry.timer)
    try   { entry.resolve(JSON.parse(line)) }
    catch { entry.resolve({ ok: false, error: 'Bad JSON from bridge' }) }
    _vpBusy = false
    _drainVpQueue()
  }))

  _vpProc.on('exit', (code) => {
    log.warn('vpBridge', 'Bridge exited', { code })
    _vpProc = null
    _failAllVp(new Error('VideoPsalm bridge exited'))
  })

  _vpProc.stderr.on('data', () => {})  // silence stderr
  return _vpProc
}

/** Reject everything pending and reset state so the next call starts clean. */
function _failAllVp(err) {
  _vpBusy = false
  const pending = _vpQueue
  _vpQueue = []
  for (const entry of pending) {
    clearTimeout(entry.timer)
    entry.reject(err)
  }
}

/** Tear down a stuck daemon so the next command gets a fresh process. */
function _resetVpProc() {
  const proc = _vpProc
  _vpProc = null
  if (proc) {
    try { proc.stdout.removeAllListeners() } catch { /* ignore */ }
    try { proc.kill() } catch { /* ignore */ }
  }
}

function _drainVpQueue() {
  if (_vpBusy || _vpQueue.length === 0) return
  _vpBusy = true
  try {
    const proc = _getVpProc()
    proc.stdin.write(_vpQueue[0].cmd + '\n')
  } catch (err) {
    log.error('vpBridge', 'Write to bridge failed', { error: err.message })
    _resetVpProc()
    _failAllVp(err)
  }
}

function callVpBridge(params, timeoutMs = VP_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const entry = { cmd: JSON.stringify(params), resolve, reject, timer: null }

    entry.timer = setTimeout(() => {
      const idx = _vpQueue.indexOf(entry)
      if (idx !== -1) _vpQueue.splice(idx, 1)

      log.error('vpBridge', 'Command timed out, restarting bridge', { action: params.action })

      // Once a command times out, the order of responses can no longer be
      // trusted, so drop the process and let the next call spawn a new one.
      _resetVpProc()
      _failAllVp(new Error('VideoPsalm did not respond. Bridge restarted.'))
      reject(new Error('VideoPsalm did not respond. Bridge restarted.'))
    }, timeoutMs)

    _vpQueue.push(entry)
    _drainVpQueue()
  })
}

// ---------------------------------------------------------------------------
// Fast path: regex on every transcript segment, no waiting for the chunker
// ---------------------------------------------------------------------------

async function processInstantRefs(text) {
  // Full citations plus verses that follow the passage in context, in spoken order.
  for (const ref of readingContext.process(text)) await suggestNow(ref, 'Instant regex hit')

  // Verses quoted or closely paraphrased without being named: search the KJV
  // text for this line and the one before it.
  if (verseSearch) {
    const line = `${_previousLine} ${text}`.trim()
    const candidates = verseSearch.search(line)
    if (isStrong(candidates)) {
      const best = candidates[0]
      await suggestNow({
        ...asRef(best),
        confidence: best.pairWeight >= 25 ? 'high' : 'medium',
        trigger:    'quote',
      }, 'Quote found by search')
    } else {
      // Close but unsure: let the LLM choose among the verses that share a
      // phrase with the line, or choose none.
      const options = forJudge(candidates)
      if (options.length) judgeLater(line, options)
    }
  }
  _previousLine = text
}

function judgeLater(line, options) {
  _judgeNext = { line, options, heardAt: Date.now() }
  if (!_judgeBusy) runJudge()
}

async function runJudge() {
  _judgeBusy = true
  try {
    while (_judgeNext) {
      const { line, options, heardAt } = _judgeNext
      _judgeNext = null
      const pick = await llmClient.pickVerse(line, options)
      if (pick) {
        await suggestNow({ ...asRef(pick), confidence: 'medium', trigger: 'paraphrase' },
          'Paraphrase confirmed by LLM', { judgeMs: Date.now() - heardAt })
      }
    }
  } finally {
    _judgeBusy = false
  }
}

// "Read it from the NIV": tell the operator, who decides whether to switch
// VideoPsalm. The same translation is not suggested again within a minute.
const _translationAsked = new Map()   // code -> time last suggested

function noticeTranslationRequest(text) {
  for (const { code, heard } of detectTranslations(text)) {
    const last = _translationAsked.get(code)
    if (last && Date.now() - last < 60_000) continue
    _translationAsked.set(code, Date.now())
    log.info('pipeline', 'Translation asked for', { code, heard })
    mainWindow?.webContents.send('translation-request', { code, heard, at: Date.now() })
  }
}

/** A verseSearch candidate as a reference for bibleDb.lookupVerse. */
function asRef(c) {
  return { reference: c.reference, book: c.book, chapter: c.chapter, verse_start: c.verse }
}

/** Look a reference up and send it as a card, unless it was suggested recently. */
async function suggestNow(ref, why, details = {}) {
  const named = ref.trigger === 'explicit' || ref.trigger === 'context'
  if (!ref.reference || !shouldSuggest(ref.reference, named ? NAMED_REPEAT_MS : DEDUPE_WINDOW_MS)) return
  const card = await bibleDb.lookupVerse(ref)
  if (!card) {
    // Not found. Release the dedupe slot so a later, cleaner mention of the
    // same reference still gets a chance.
    sentRefs.delete(ref.reference)
    return
  }
  const now = Date.now()
  log.info('pipeline', why, { reference: card.reference, ...details })
  mainWindow?.webContents.send('scripture-suggestion', {
    ...card, chunkId: null, startAt: now - 300, fireAt: now + 300,
  })
}

// ---------------------------------------------------------------------------
// Slow path: chunker -> LLM + regex -> Bible DB
// ---------------------------------------------------------------------------

chunker.on('chunk', async ({ text, chunkId, startAt, fireAt }) => {
  mainWindow?.webContents.send('scripture-analyzing', { chunkId, startAt, fireAt })

  // Snapshot the context before the async call so it matches this chunk.
  const contextText = _transcriptWords.join(' ')

  // 1. Regex: always runs and catches explicit references.
  const regexRefs = bibleExtractor.extract(text)

  // 2. LLM: catches allusions that share no words with the verse, when LM
  // Studio is available. It names verses from memory, so each one is checked
  // against its KJV text below before it becomes a card.
  const llmRefs = await llmClient.queryScriptures(text, contextText)
  const llmErr  = llmClient.getLastError()
  if (llmErr) {
    mainWindow?.webContents.send('llm-error', { message: llmErr })
  }

  // Merge: LLM results first, then regex results the LLM did not return.
  const allRefs = [...llmRefs]
  const seen    = new Set(llmRefs.map(r => r.reference))
  for (const r of regexRefs) {
    if (!seen.has(r.reference)) {
      seen.add(r.reference)
      allRefs.push(r)
    }
  }

  const fromLlm = new Set(llmRefs)
  for (const ref of allRefs) {
    if (!ref.reference) continue
    if (!shouldSuggest(ref.reference)) continue
    const card = await bibleDb.lookupVerse(ref)
    if (!card || (fromLlm.has(ref) && !await llmClient.confirmVerse(text, card))) {
      sentRefs.delete(ref.reference)
      continue
    }
    log.info('pipeline', 'Chunk hit', {
      reference: card.reference, chunkId, confidence: card.confidence,
    })
    mainWindow?.webContents.send('scripture-suggestion', { ...card, chunkId, startAt, fireAt })
  }

  pruneSentRefs()
  mainWindow?.webContents.send('scripture-analyzing-done', { chunkId })
})

// ---------------------------------------------------------------------------
// Whisper message handling
// ---------------------------------------------------------------------------

function handleWhisperMessage(msg) {
  switch (msg.type) {
    case 'partial':
      // Words of the sentence still being spoken. Shown, never detected on,
      // so a half-heard "John 3" cannot become a card.
      mainWindow?.webContents.send('transcript-partial', msg)
      break
    case 'transcript': {
      log.info('whisper', 'Line', { latencyMs: msg.latency_ms, decodeMs: msg.decode_ms })
      mainWindow?.webContents.send('transcript-update', msg)
      chunker.addText(msg.text)
      processInstantRefs(msg.text)
      noticeTranslationRequest(msg.text)

      const incoming = msg.text.trim().split(/\s+/).filter(Boolean)
      _transcriptWords.push(...incoming)
      if (_transcriptWords.length > CONTEXT_MAX_WORDS) {
        _transcriptWords = _transcriptWords.slice(-CONTEXT_MAX_WORDS)
      }
      break
    }
    case 'status':
      mainWindow?.webContents.send('listening-status', msg)
      break
    case 'error':
    case 'warning':
      mainWindow?.webContents.send('listening-error', msg)
      break
  }
}

// ---------------------------------------------------------------------------
// IPC handlers
// ---------------------------------------------------------------------------

ipcMain.handle('get-audio-devices', async () => {
  return runPythonJson('list_devices.py')
})

/**
 * The input's number as Windows numbers it now. Plugging in a USB interface
 * (a GoStream, a Focusrite) renumbers every device, so a number remembered
 * from earlier can point at a different device, or at an output. The saved
 * name is the key; the number is looked up again each time.
 */
async function currentDeviceIndex(deviceIndex) {
  const name = settings.load().deviceName
  const list = await runPythonJson('list_devices.py')
  if (!Array.isArray(list)) return deviceIndex
  const byName = name && list.find(d => d.name === name)
  const index = byName ? byName.index
    : list.some(d => d.index === deviceIndex) ? deviceIndex : null   // gone: the system default
  if (index !== deviceIndex) log.info('audio', 'Input renumbered', { name, was: deviceIndex, now: index })
  return index
}

/**
 * Test input: run the level meter on one device for a few seconds, streaming
 * its level to the settings panel, so the operator can see a microphone is
 * really getting sound before the service starts.
 */
ipcMain.handle('test-input', async (_e, requested = null) => {
  const deviceIndex = await currentDeviceIndex(requested)
  const args = [join(pythonDir(), 'level_meter.py'), '--seconds', '5']
  if (deviceIndex !== null && deviceIndex !== undefined) args.push('--device-index', String(deviceIndex))

  return new Promise((resolve) => {
    const proc = spawn(pythonCmd(), args)
    let result = { ok: false, error: 'The level meter did not report back' }
    proc.stdout.on('data', lineReader((line) => {
      let msg
      try { msg = JSON.parse(line) } catch { return }
      if (msg.level !== undefined) mainWindow?.webContents.send('input-level', msg)
      if (msg.done) result = { ok: true, peakDb: msg.peak_db }
      if (msg.error) result = { ok: false, error: msg.error }
    }))
    proc.on('error', (err) => resolve({ ok: false, error: `Python not found: ${err.message}` }))
    proc.on('close', () => {
      log.info('audio', 'Input test', { deviceIndex, ...result })
      resolve(result)
    })
  })
})

ipcMain.handle('start-listening', async (_e, { model = 'auto', deviceIndex: requested = null } = {}) => {
  killWhisper()
  const deviceIndex = await currentDeviceIndex(requested)
  sentRefs = new Map()
  _transcriptWords = []
  readingContext.reset()
  _translationAsked.clear()
  _previousLine = ''
  _judgeNext = null
  chunker.start()

  // Remember the choice so the next service starts configured.
  settings.save({ whisperModel: model, deviceIndex })
  log.info('whisper', 'Starting listening session', { model, deviceIndex })

  const args = [join(pythonDir(), 'whisper_worker.py'), '--model', model]
  if (deviceIndex !== null && deviceIndex !== undefined) {
    args.push('--device-index', String(deviceIndex))
  }

  const proc = spawn(pythonCmd(), args)
  whisperProcess = proc

  // Every handler checks that this process is still the current one. A
  // previous process may exit after a restart, and its events must not touch
  // the new session.
  const isCurrent = () => whisperProcess === proc

  proc.stdout.on('data', lineReader((line) => {
    if (!isCurrent()) return
    let msg
    try { msg = JSON.parse(line) } catch { return }   // ignore non-JSON output
    handleWhisperMessage(msg)
  }))

  proc.stderr.on('data', (data) => {
    if (!isCurrent()) return
    const text = data.toString()
    if (text.toLowerCase().includes('error')) {
      mainWindow?.webContents.send('listening-error', { type: 'error', message: text.trim() })
    }
  })

  proc.on('error', (err) => {
    if (!isCurrent()) return
    log.error('whisper', 'Failed to start Python', { error: err.message })
    mainWindow?.webContents.send('listening-error', {
      type: 'error',
      message: `Failed to start Python: ${err.message}. Is Python installed?`
    })
    whisperProcess = null
    chunker.stop()
  })

  proc.on('exit', (code) => {
    if (!isCurrent()) return
    log.info('whisper', 'Worker exited', { code })
    chunker.flush()
    chunker.stop()
    whisperProcess = null
    mainWindow?.webContents.send('listening-status', { listening: false, message: 'Stopped.' })
  })

  return { started: true }
})

ipcMain.handle('stop-listening', async () => {
  chunker.flush()
  killWhisper()
  mainWindow?.webContents.send('listening-status', { listening: false, message: 'Stopped.' })
  return { stopped: true }
})

ipcMain.handle('check-videopsalm', async () => {
  try   { return await callVpBridge({ action: 'check' }) }
  catch { return { running: false } }
})

ipcMain.handle('send-to-videopsalm', async (_e, reference) => {
  try {
    const t0 = Date.now()
    const result = await callVpBridge({ action: 'send', reference })
    if (!result?.ok) log.warn('vpBridge', 'Send failed', { reference, error: result?.error })
    else log.info('vpBridge', 'On screen', { reference, ms: Date.now() - t0, translation: result.shown?.translation })
    return result
  } catch (err) {
    log.error('vpBridge', 'Send threw', { reference, error: err.message })
    return { ok: false, error: err.message }
  }
})

// Switch VideoPsalm's Bible to a translation code such as 'NIV'. VideoPsalm
// names some Bibles its own way ('NIV84'), so the code is matched against its
// favourite Bible buttons first.
ipcMain.handle('set-videopsalm-bible', async (_e, code) => {
  try {
    const listed = await callVpBridge({ action: 'bibles' })
    if (!listed?.ok) return { ok: false, error: listed?.error || 'VideoPsalm did not answer' }
    const name = matchBible(code, listed.result.bibles)
    if (!name) {
      return { ok: false, error: `${code} is not among VideoPsalm's Bibles (${listed.result.bibles.join(', ')})` }
    }
    const result = await callVpBridge({ action: 'set-bible', name })
    if (result?.ok) log.info('vpBridge', 'Bible switched', { code, name })
    return result?.ok ? { ok: true, translation: result.result.current } : { ok: false, error: result?.error }
  } catch (err) {
    return { ok: false, error: err.message }
  }
})

/**
 * Manual reference lookup, the operator's override when detection misses.
 * Uses the same extractor and database path as the automatic pipeline.
 */
ipcMain.handle('lookup-reference', async (_e, query) => {
  const text = String(query || '').trim()
  if (!text) return { ok: false, error: 'Enter a reference, e.g. John 3:16' }

  const refs = bibleExtractor.extract(text)
  if (refs.length === 0) {
    return { ok: false, error: `Could not read "${text}" as a reference` }
  }

  const cards = []
  for (const ref of refs) {
    const card = await bibleDb.lookupVerse(ref)
    if (card) cards.push(card)
  }

  if (cards.length === 0) {
    return { ok: false, error: `${refs[0].reference} not found in the KJV database` }
  }

  log.info('manual', 'Manual lookup', { query: text, found: cards.length })

  // A typed reference also sets the passage, so a following "verse 5" fits it.
  const last = cards[cards.length - 1]
  readingContext.remember(last.book, last.chapter)

  // A manual entry is a deliberate operator decision: always high confidence,
  // and it skips the dedupe window so a repeat lookup always works.
  return {
    ok: true,
    cards: cards.map(c => ({ ...c, confidence: 'high', trigger: 'explicit', manual: true })),
  }
})

ipcMain.handle('get-settings', async () => settings.load())

ipcMain.handle('save-settings', async (_e, patch) => settings.save(patch || {}))

ipcMain.handle('get-log-path', async () => log.getLogPath())

ipcMain.handle('copy-to-clipboard', (_e, text) => {
  clipboard.writeText(text)
  return { ok: true }
})

ipcMain.handle('check-llm-status', async () => {
  return llmClient.checkStatus()
})

ipcMain.handle('set-llm-endpoint', async (_e, url) => {
  llmClient.setEndpoint(url)
  settings.save({ llmEndpoint: url })
  return llmClient.checkStatus()
})

ipcMain.handle('check-bible-db', async () => {
  return { ready: bibleDb.isDbReady() }
})

// ---------------------------------------------------------------------------
// Window
// ---------------------------------------------------------------------------

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    show: false,
    autoHideMenuBar: true,
    title: 'Scripture Suggestion Panel',
    backgroundColor: '#0f172a',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      // The mini panel works through this window, so it must keep running
      // while minimised behind VideoPsalm.
      backgroundThrottling: false,
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
    // Non-blocking check that Python is available.
    execFile(pythonCmd(), ['--version'], { timeout: 4000 }, (err) => {
      if (err) {
        mainWindow?.webContents.send('listening-error', {
          type: 'warning',
          message: 'Python not found. Whisper transcription requires Python 3.9+. Run python\\setup.bat to install.'
        })
      }
    })
  })
  mainWindow.on('closed', () => { killWhisper(); miniPanel.stop(); mainWindow = null })

  if (!app.isPackaged && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  miniPanel.init({
    getMain: () => mainWindow,
    preload: join(__dirname, '../preload/index.js'),
    rendererUrl: !app.isPackaged ? process.env['ELECTRON_RENDERER_URL'] : null,
    rendererFile: join(__dirname, '../renderer/index.html'),
    python: pythonCmd(),
    pythonDir: pythonDir(),
  })
}

app.whenReady().then(() => {
  const saved = settings.load()
  // Restore the saved LM Studio endpoint before the renderer asks for status,
  // so a custom endpoint shows as connected on first paint.
  if (saved.llmEndpoint) llmClient.setEndpoint(saved.llmEndpoint)

  log.info('app', 'Application ready', {
    version: app.getVersion(), platform: process.platform, logPath: log.getLogPath(),
  })

  createWindow()

  hotkeys.register({
    toRenderer: (action) => mainWindow?.webContents.send('mini-action', action),
    pressScreenButton: async (button) => {
      try {
        const r = await callVpBridge({ action: 'press', button })
        return r?.ok ? { ok: true, on: r.result.on } : { ok: false, error: r?.error }
      } catch (err) {
        return { ok: false, error: err.message }
      }
    },
    toggleMini: () => miniPanel.toggleCollapsed(),
  })

  // Build the verse index after the window is up, so start-up stays quick.
  setTimeout(async () => {
    const t0 = Date.now()
    const verses = await bibleDb.allVerses()
    if (verses.length) {
      verseSearch = new VerseSearch(verses)
      log.info('search', 'Verse index ready', { verses: verses.length, ms: Date.now() - t0 })
    }
  }, 500)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('will-quit', () => hotkeys.unregister())

app.on('window-all-closed', () => {
  killWhisper()
  if (process.platform !== 'darwin') app.quit()
})

// Release both child processes on quit, otherwise the audio device can stay
// locked after the window closes.
app.on('before-quit', () => {
  log.info('app', 'Shutting down')
  killWhisper({ graceMs: 500 })
  _resetVpProc()
  miniPanel.stop()
})
