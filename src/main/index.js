const { app, BrowserWindow, ipcMain, clipboard } = require('electron')
const { join } = require('path')
const { spawn, execFile } = require('child_process')
const chunker        = require('./chunker')
const llmClient      = require('./llmClient')
const bibleDb        = require('./bibleDb')
const bibleExtractor = require('./bibleExtractor')

let mainWindow = null
let whisperProcess = null
// Deduplicate suggestions per listening session
let sentRefs = new Set()

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

function killWhisper() {
  if (whisperProcess) {
    whisperProcess.kill()
    whisperProcess = null
  }
  chunker.stop()
}

// ---------------------------------------------------------------------------
// Persistent VideoPsalm bridge daemon
// ---------------------------------------------------------------------------

let _vpProc     = null   // the long-lived python process
let _vpQueue    = []     // pending {cmd, resolve, reject}
let _vpBusy     = false
let _vpLineBuf  = ''

function _getVpProc() {
  if (_vpProc && !_vpProc.killed) return _vpProc

  _vpProc    = spawn(pythonCmd(), [join(pythonDir(), 'videopsalm_bridge.py'), '--daemon'])
  _vpLineBuf = ''

  _vpProc.stdout.on('data', (data) => {
    _vpLineBuf += data.toString()
    const lines = _vpLineBuf.split('\n')
    _vpLineBuf  = lines.pop()  // keep any incomplete trailing line
    for (const line of lines) {
      if (!line.trim()) continue
      if (_vpQueue.length > 0) {
        const { resolve } = _vpQueue.shift()
        try   { resolve(JSON.parse(line.trim())) }
        catch { resolve({ ok: false, error: 'Bad JSON from bridge' }) }
        _vpBusy = false
        _drainVpQueue()
      }
    }
  })

  _vpProc.on('exit', () => {
    _vpProc = null
    _vpBusy = false
    for (const { reject } of _vpQueue) reject(new Error('VP bridge exited'))
    _vpQueue = []
  })

  _vpProc.stderr.on('data', () => {})  // silence stderr
  return _vpProc
}

function _drainVpQueue() {
  if (_vpBusy || _vpQueue.length === 0) return
  _vpBusy = true
  const proc = _getVpProc()
  proc.stdin.write(_vpQueue[0].cmd + '\n')
}

function callVpBridge(params) {
  return new Promise((resolve, reject) => {
    _vpQueue.push({ cmd: JSON.stringify(params), resolve, reject })
    _drainVpQueue()
  })
}

// ---------------------------------------------------------------------------
// Instant regex — runs on EVERY transcript segment (no 5s wait)
// ---------------------------------------------------------------------------

async function processInstantRefs(text) {
  const refs = bibleExtractor.extract(text)
  for (const ref of refs) {
    if (!ref.reference || sentRefs.has(ref.reference)) continue
    const card = await bibleDb.lookupVerse(ref)
    if (!card) continue
    sentRefs.add(ref.reference)
    const now = Date.now()
    mainWindow?.webContents.send('scripture-suggestion', {
      ...card, chunkId: null, startAt: now - 300, fireAt: now + 300,
    })
  }
}

// ---------------------------------------------------------------------------
// Chunker → LLM → Bible DB pipeline
// ---------------------------------------------------------------------------

chunker.on('chunk', async ({ text, chunkId, startAt, fireAt }) => {
  mainWindow?.webContents.send('scripture-analyzing', { chunkId, startAt, fireAt })

  // 1. Regex extraction — always runs, catches explicit references instantly
  const regexRefs = bibleExtractor.extract(text)

  // 2. LLM extraction — catches paraphrases/allusions when LM Studio is available
  const llmRefs   = await llmClient.queryScriptures(text)
  const llmErr    = llmClient.getLastError()
  if (llmErr) {
    mainWindow?.webContents.send('llm-error', { message: llmErr })
  }

  // Merge: LLM results first (higher confidence for paraphrases), then regex fills gaps
  const allRefs = [...llmRefs]
  const seen    = new Set(llmRefs.map(r => r.reference))
  for (const r of regexRefs) {
    if (!seen.has(r.reference)) {
      seen.add(r.reference)
      allRefs.push(r)
    }
  }

  for (const ref of allRefs) {
    if (!ref.reference) continue
    if (sentRefs.has(ref.reference)) continue
    const card = await bibleDb.lookupVerse(ref)
    if (!card) continue
    sentRefs.add(ref.reference)
    mainWindow?.webContents.send('scripture-suggestion', { ...card, chunkId, startAt, fireAt })
  }

  mainWindow?.webContents.send('scripture-analyzing-done', { chunkId })
})

// ---------------------------------------------------------------------------
// IPC handlers
// ---------------------------------------------------------------------------

ipcMain.handle('get-audio-devices', async () => {
  return runPythonJson('list_devices.py')
})

ipcMain.handle('start-listening', async (_e, { model = 'small', deviceIndex = null } = {}) => {
  killWhisper()
  sentRefs = new Set()
  chunker.start()

  const args = [join(pythonDir(), 'whisper_worker.py'), '--model', model]
  if (deviceIndex !== null && deviceIndex !== undefined) {
    args.push('--device-index', String(deviceIndex))
  }

  whisperProcess = spawn(pythonCmd(), args)

  whisperProcess.stdout.on('data', (data) => {
    const lines = data.toString().split('\n').filter(Boolean)
    for (const line of lines) {
      try {
        const msg = JSON.parse(line)
        switch (msg.type) {
          case 'transcript':
            mainWindow?.webContents.send('transcript-update', msg)
            chunker.addText(msg.text)
            processInstantRefs(msg.text)   // instant regex — no 5s wait
            break
          case 'status':
            mainWindow?.webContents.send('listening-status', msg)
            break
          case 'error':
          case 'warning':
            mainWindow?.webContents.send('listening-error', msg)
            break
        }
      } catch {
        // ignore malformed lines
      }
    }
  })

  whisperProcess.stderr.on('data', (data) => {
    const text = data.toString()
    if (text.toLowerCase().includes('error')) {
      mainWindow?.webContents.send('listening-error', { type: 'error', message: text.trim() })
    }
  })

  whisperProcess.on('error', (err) => {
    mainWindow?.webContents.send('listening-error', {
      type: 'error',
      message: `Failed to start Python: ${err.message}. Is Python installed?`
    })
    whisperProcess = null
    chunker.stop()
  })

  whisperProcess.on('exit', () => {
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
  return { stopped: true }
})

ipcMain.handle('check-videopsalm', async () => {
  try   { return await callVpBridge({ action: 'check' }) }
  catch { return { running: false } }
})

ipcMain.handle('send-to-videopsalm', async (_e, reference) => {
  try   { return await callVpBridge({ action: 'send', reference }) }
  catch (err) { return { ok: false, error: err.message } }
})

ipcMain.handle('copy-to-clipboard', (_e, text) => {
  clipboard.writeText(text)
  return { ok: true }
})

ipcMain.handle('check-llm-status', async () => {
  return llmClient.checkStatus()
})

ipcMain.handle('set-llm-endpoint', async (_e, url) => {
  llmClient.setEndpoint(url)
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
      contextIsolation: true
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
    // Non-blocking Python availability check
    execFile(pythonCmd(), ['--version'], { timeout: 4000 }, (err) => {
      if (err) {
        mainWindow?.webContents.send('listening-error', {
          type: 'warning',
          message: 'Python not found. Whisper transcription requires Python 3.9+. Run python\\setup.bat to install.'
        })
      }
    })
  })
  mainWindow.on('closed', () => { killWhisper(); mainWindow = null })

  if (!app.isPackaged && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  killWhisper()
  if (process.platform !== 'darwin') app.quit()
})
