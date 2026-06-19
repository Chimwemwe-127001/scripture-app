/**
 * hotkeys.js: keys that work from any program, so the operator can stay in
 * OBS instead of switching to VideoPsalm or the panel for every verse.
 *
 *   Ctrl+Alt+1 to 9   send that suggestion to VideoPsalm
 *   Ctrl+Alt+0        hide or show the verse text on screen
 *   Ctrl+Alt+B        screen off or on (VideoPsalm's blank screen)
 *   Ctrl+Alt+T        switch to the translation the preacher asked for
 *   Ctrl+Alt+P        fold or unfold the mini panel
 *
 * Ctrl+Alt was chosen because OBS has no default hotkeys on it and the plain
 * number keys stay free for typing. A key another program already holds is
 * skipped and logged; the rest still work.
 */

const { globalShortcut } = require('electron')
const log = require('./logger')

/**
 * @param {object} h
 * @param {(action: object) => void} h.toRenderer  pass an action to the full window
 * @param {(button: 'text'|'blank') => Promise<object>} h.pressScreenButton
 * @param {() => void} h.toggleMini
 */
function register({ toRenderer, pressScreenButton, toggleMini }) {
  const keys = {
    'Ctrl+Alt+0': () => screenButton('text'),
    'Ctrl+Alt+B': () => screenButton('blank'),
    'Ctrl+Alt+T': () => toRenderer({ type: 'switch-bible' }),
    'Ctrl+Alt+P': () => toggleMini(),
  }
  for (let n = 1; n <= 9; n++) keys[`Ctrl+Alt+${n}`] = () => toRenderer({ type: 'send', number: n })

  async function screenButton(button) {
    const result = await pressScreenButton(button)
    const what = button === 'text' ? 'Verse text' : 'Screen'
    const state = button === 'text' ? (result?.on ? 'shown' : 'hidden') : (result?.on ? 'off' : 'on')
    toRenderer({
      type: 'notice',
      text: result?.ok === false ? `VideoPsalm: ${result.error}` : `${what} ${state}`,
    })
  }

  const taken = []
  for (const [accelerator, run] of Object.entries(keys)) {
    if (!globalShortcut.register(accelerator, run)) taken.push(accelerator)
  }
  if (taken.length) log.warn('hotkeys', 'Keys already used by another program', { taken })
  else log.info('hotkeys', 'Hotkeys ready', { count: Object.keys(keys).length })
  return taken
}

function unregister() {
  globalShortcut.unregisterAll()
}

module.exports = { register, unregister }
