const { app, BrowserWindow, ipcMain } = require('electron')
const { join } = require('path')
const { spawn } = require('child_process')

let mainWindow = null
let whisperProcess = null

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
}

// ---------------------------------------------------------------------------
// IPC handlers
// ---------------------------------------------------------------------------

ipcMain.handle('get-audio-devices', async () => {
  return runPythonJson('list_devices.py')
})

ipcMain.handle('start-listening', async (_e, { model = 'small', deviceIndex = null } = {}) => {
  killWhisper()

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
  })

  whisperProcess.on('exit', () => {
    whisperProcess = null
    mainWindow?.webContents.send('listening-status', { listening: false, message: 'Stopped.' })
  })

  return { started: true }
})

ipcMain.handle('stop-listening', async () => {
  killWhisper()
  return { stopped: true }
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

  mainWindow.on('ready-to-show', () => mainWindow.show())
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
