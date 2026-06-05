/**
 * capture-screenshots.js: saves the README and design screenshots.
 *
 * Runs under Electron (`npm run screenshots` builds first). The built renderer
 * is loaded with scripts/screenshot-preload.js, which plays back a recorded
 * session instead of listening to a microphone. Each step below drives the UI
 * the way an operator would (click Listen, press 1, open settings) and then
 * captures the window.
 *
 * Usage: npm run screenshots [-- options]
 *   --out <dir>        where to save       (default docs/design/hifi)
 *   --size 1100x700    window size         (default 1400x860)
 *   --only 1,2,3       capture only these numbered shots
 */

const { app, BrowserWindow } = require('electron')
const { join, resolve } = require('path')
const fs = require('fs')

const arg = (name) => {
  const i = process.argv.indexOf(name)
  return i > -1 ? process.argv[i + 1] : null
}

const OUT_DIR = resolve(arg('--out') || join(__dirname, '..', 'docs', 'design', 'hifi'))
const [WIDTH, HEIGHT] = (arg('--size') || '1400x860').split('x').map(Number)
const ONLY = arg('--only')?.split(',')

const wait = (ms) => new Promise(r => setTimeout(r, ms))

// Runs in the page. Setting a React-controlled input needs the native setter.
const typeInto = (selector, text) => `(() => {
  const el = document.querySelector(${JSON.stringify(selector)})
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
  set.call(el, ${JSON.stringify(text)})
  el.dispatchEvent(new Event('input', { bubbles: true }))
  el.form.requestSubmit()
})()`
const click = (selector) => `document.querySelector(${JSON.stringify(selector)}).click()`
// React derives mouseenter from a bubbling mouseover.
const hover = (selector, index) => `document.querySelectorAll(${JSON.stringify(selector)})[${index}]
  .dispatchEvent(new MouseEvent('mouseover', { bubbles: true, relatedTarget: document.body }))`
const press = (key, extra = '') =>
  `document.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(key)}, bubbles: true ${extra} }))`

// Each step: optional script to run, how long to wait, then an optional capture.
const STEPS = [
  { wait: 1500, shot: '1-idle.png' },
  { run: click('button[title^="Start listening"]'), wait: 4600, shot: '2-first-detection.png' },
  { wait: 26000, shot: '3-suggestions.png' },
  { run: press('3'), wait: 600 },
  { run: press('1'), wait: 900, shot: '4-on-screen.png' },
  { run: hover('article', 2), wait: 500, shot: '5-hover-link.png' },
  { run: typeInto('input[name="lookup"]', 'Hezekiah 3:16'), wait: 700, shot: '6-lookup-miss.png' },
  { run: press('Escape'), wait: 200 },
  { run: click('button[aria-label="Settings"]'), wait: 700, shot: '7-settings.png' },
]

app.whenReady().then(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true })

  // Offscreen rendering paints every frame even though no window is shown.
  // A normal window stops painting when it is hidden or covered, and the
  // capture would then return a stale frame.
  const win = new BrowserWindow({
    width: WIDTH,
    height: HEIGHT,
    show: false,
    webPreferences: {
      offscreen: true,
      backgroundThrottling: false,
      contextIsolation: true,
      sandbox: false,
      preload: join(__dirname, 'screenshot-preload.js'),
    },
  })
  win.webContents.setFrameRate(30)
  await win.loadFile(join(__dirname, '..', 'out', 'renderer', 'index.html'))
  // Entry animations would leave a just-arrived card half transparent.
  await win.webContents.insertCSS('*, *::before, *::after { animation: none !important; }')

  for (const step of STEPS) {
    if (step.run) await win.webContents.executeJavaScript(step.run)
    await wait(step.wait)
    if (step.shot && (!ONLY || ONLY.includes(step.shot.split('-')[0]))) {
      const image = await win.webContents.capturePage()
      fs.writeFileSync(join(OUT_DIR, step.shot), image.toPNG())
      console.log(`saved ${join(OUT_DIR, step.shot)}`)
    }
  }

  app.quit()
})
