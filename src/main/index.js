const { app, BrowserWindow, ipcMain, clipboard } = require('electron')
const { join } = require('path')
const { spawn, execFile } = require('child_process')
const chunker   = require('./chunker')
const llmClient = require('./llmClient')
const bibleDb   = require('./bibleDb')

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
// Chunker → LLM → Bible DB pipeline
// ---------------------------------------------------------------------------

chunker.on('chunk', async (text) => {
  const refs = await llmClient.queryScriptures(text)
  for (const ref of refs) {
    if (!ref.reference) continue
    if (sentRefs.has(ref.reference)) continue
    const card = await bibleDb.lookupVerse(ref)
    if (!card) continue
    sentRefs.add(ref.reference)
    mainWindow?.webContents.send('scripture-suggestion', card)
  }
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
  return runPythonJson('videopsalm_bridge.py', ['--check'])
})

ipcMain.handle('send-to-videopsalm', async (_e, reference) => {
  return runPythonJson('videopsalm_bridge.py', [reference])
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
