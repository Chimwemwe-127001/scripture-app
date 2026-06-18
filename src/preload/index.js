const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
  // Audio device listing
  getAudioDevices: () => ipcRenderer.invoke('get-audio-devices'),
  testInput:       (deviceIndex) => ipcRenderer.invoke('test-input', deviceIndex),
  onInputLevel:    (cb) => ipcRenderer.on('input-level', (_e, d) => cb(d)),

  // Whisper lifecycle
  startListening: (opts) => ipcRenderer.invoke('start-listening', opts),
  stopListening:  () => ipcRenderer.invoke('stop-listening'),

  // LLM (LM Studio) controls
  checkLlmStatus:  () => ipcRenderer.invoke('check-llm-status'),
  setLlmEndpoint:  (url) => ipcRenderer.invoke('set-llm-endpoint', url),

  // Bible DB status
  checkBibleDb: () => ipcRenderer.invoke('check-bible-db'),

  // Manual reference lookup, the operator's override when detection misses
  lookupReference: (query) => ipcRenderer.invoke('lookup-reference', query),

  // Persisted settings
  getSettings:  () => ipcRenderer.invoke('get-settings'),
  saveSettings: (patch) => ipcRenderer.invoke('save-settings', patch),

  // Diagnostics
  getLogPath: () => ipcRenderer.invoke('get-log-path'),

  // Clipboard
  copyToClipboard: (text) => ipcRenderer.invoke('copy-to-clipboard', text),

  // VideoPsalm integration
  checkVideoPsalm:  () => ipcRenderer.invoke('check-videopsalm'),
  sendToVideoPsalm: (reference) => ipcRenderer.invoke('send-to-videopsalm', reference),
  setVideoPsalmBible: (code) => ipcRenderer.invoke('set-videopsalm-bible', code),

  // Incoming events from main process
  onTranscript:          (cb) => ipcRenderer.on('transcript-update',    (_e, d) => cb(d)),
  onTranscriptPartial:   (cb) => ipcRenderer.on('transcript-partial',   (_e, d) => cb(d)),
  onListeningStatus:     (cb) => ipcRenderer.on('listening-status',     (_e, d) => cb(d)),
  onListeningError:      (cb) => ipcRenderer.on('listening-error',      (_e, d) => cb(d)),
  onScriptureSuggestion: (cb) => ipcRenderer.on('scripture-suggestion', (_e, d) => cb(d)),
  onLlmError:            (cb) => ipcRenderer.on('llm-error',            (_e, d) => cb(d)),
  onAnalyzing:           (cb) => ipcRenderer.on('scripture-analyzing',      (_e, d) => cb(d)),
  onAnalyzingDone:       (cb) => ipcRenderer.on('scripture-analyzing-done', (_e, d) => cb(d)),
  onTranslationRequest:  (cb) => ipcRenderer.on('translation-request',  (_e, d) => cb(d)),

  // Mini panel docked to VideoPsalm. The full window publishes its state, the
  // panel shows it and sends its button presses back.
  setMiniPanel:     (on) => ipcRenderer.invoke('set-mini-panel', on),
  publishMiniState: (state) => ipcRenderer.send('mini-state', state),
  onMiniState:      (cb) => ipcRenderer.on('mini-state', (_e, d) => cb(d)),
  miniAction:       (action) => ipcRenderer.send('mini-action', action),
  onMiniAction:     (cb) => ipcRenderer.on('mini-action', (_e, d) => cb(d)),

  removeAllListeners: (ch) => ipcRenderer.removeAllListeners(ch),
})
