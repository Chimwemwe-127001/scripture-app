/**
 * screenshot-preload.js: stands in for src/preload/index.js during
 * `npm run screenshots` only.
 *
 * It exposes the same `window.electronAPI` surface, but instead of talking to
 * Whisper, LM Studio and VideoPsalm it plays back scripts/fixtures/sample-session.json
 * through the same callbacks the real main process uses. The renderer code is
 * unchanged, so the screenshots show the real UI in real states.
 */

const { contextBridge } = require('electron')
const path = require('path')
const session = require(path.join(__dirname, 'fixtures', 'sample-session.json'))

const listeners = {}
const on = (channel) => (cb) => { (listeners[channel] ||= []).push(cb) }
const emit = (channel, data) => (listeners[channel] || []).forEach(cb => cb(data))

let settings = { ...session.settings }
let timers = []

function replay() {
  const lineTimes = []   // real arrival time of each transcript line

  emit('listening-status', { listening: true, message: `Listening on ${session.devices[1].name}` })

  for (const event of session.events) {
    timers.push(setTimeout(() => {
      const now = Date.now()
      if (event.type === 'transcript') {
        lineTimes.push(now)
        emit('transcript-update', { type: 'transcript', text: event.text, is_final: true })
        return
      }
      // Same shapes as main/index.js: the instant regex path has no chunk,
      // the LLM path carries its chunk id and time window.
      const card = { ...event.card, id: `${event.card.reference}-${now}` }
      if (event.path === 'instant') {
        emit('scripture-suggestion', { ...card, chunkId: null, startAt: now - 300, fireAt: now + 300 })
      } else {
        emit('scripture-suggestion', {
          ...card,
          chunkId: event.chunkId,
          startAt: lineTimes[event.firstLine] - 1,
          fireAt: lineTimes[event.lastLine],
        })
      }
    }, event.at))
  }
}

contextBridge.exposeInMainWorld('electronAPI', {
  getAudioDevices: async () => session.devices,
  getSettings:     async () => settings,
  saveSettings:    async (patch) => (settings = { ...settings, ...patch }),
  getLogPath:      async () => '',

  checkBibleDb:    async () => ({ ready: true }),
  checkLlmStatus:  async () => ({ ok: true, model: session.llmModel, error: null }),
  setLlmEndpoint:  async () => ({ ok: true, model: session.llmModel, error: null }),
  checkVideoPsalm: async () => ({ running: true }),

  startListening: async () => {
    setTimeout(replay, 400)   // model load
    return { started: true }
  },
  stopListening: async () => {
    timers.forEach(clearTimeout)
    timers = []
    emit('listening-status', { listening: false, message: 'Stopped.' })
    return { stopped: true }
  },

  lookupReference: async (query) =>
    session.lookups[query] || { ok: false, error: `Could not read "${query}" as a reference` },
  sendToVideoPsalm: async () => ({ ok: true }),
  copyToClipboard:  async () => ({ ok: true }),

  onTranscript:          on('transcript-update'),
  onListeningStatus:     on('listening-status'),
  onListeningError:      on('listening-error'),
  onScriptureSuggestion: on('scripture-suggestion'),
  onLlmError:            on('llm-error'),
  onAnalyzing:           on('scripture-analyzing'),
  onAnalyzingDone:       on('scripture-analyzing-done'),
  removeAllListeners:    (channel) => { delete listeners[channel] },
})
