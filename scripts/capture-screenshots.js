/**
 * capture-screenshots.js: saves README screenshots of the app in demo mode.
 *
 * Runs under Electron (npm run screenshots builds first). The renderer is
 * loaded without the preload bridge, so the app starts its built-in demo:
 * a simulated sermon transcript with scripture suggestions arriving over time.
 * No microphone, Python or LM Studio is needed.
 */

const { app, BrowserWindow } = require('electron')
const { join } = require('path')
const fs = require('fs')

const OUT_DIR = join(__dirname, '..', 'docs', 'screenshots')

// Seconds after load at which each screenshot is taken.
// `clickCards` logs those suggestion cards to the history panel first, the
// same as an operator clicking them.
const SHOTS = [
  { file: 'panel-start.png',       atSeconds: 10 },
  { file: 'panel-suggestions.png', atSeconds: 46, clickCards: [3, 1] },
]

const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms))

app.whenReady().then(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true })

  // Offscreen rendering paints every frame even though no window is shown.
  // A normal window stops painting when it is hidden or covered, and the
  // capture would then return a stale frame.
  const win = new BrowserWindow({
    width: 1400,
    height: 860,
    show: false,
    webPreferences: { offscreen: true, backgroundThrottling: false },
  })
  win.webContents.setFrameRate(30)
  await win.loadFile(join(__dirname, '..', 'out', 'renderer', 'index.html'))
  // Entry animations would leave a just-arrived card half transparent.
  await win.webContents.insertCSS('*, *::before, *::after { animation: none !important; }')

  let elapsed = 0
  for (const shot of SHOTS) {
    await wait((shot.atSeconds - elapsed) * 1000)
    elapsed = shot.atSeconds
    for (const index of shot.clickCards || []) {
      await win.webContents.executeJavaScript(
        `document.querySelectorAll('.card-enter')[${index}]?.click()`
      )
      await wait(300)
    }
    const image = await win.webContents.capturePage()
    fs.writeFileSync(join(OUT_DIR, shot.file), image.toPNG())
    console.log(`saved docs/screenshots/${shot.file}`)
  }

  app.quit()
})
