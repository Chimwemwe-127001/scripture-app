const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
  // Audio device listing
  getAudioDevices: () => ipcRenderer.invoke('get-audio-devices'),

  // Whisper lifecycle
  startListening: (opts) => ipcRenderer.invoke('start-listening', opts),
  stopListening:  () => ipcRenderer.invoke('stop-listening'),

  // LLM (LM Studio) controls
  checkLlmStatus:  () => ipcRenderer.invoke('check-llm-status'),
  setLlmEndpoint:  (url) => ipcRenderer.invoke('set-llm-endpoint', url),

  // Bible DB status
  checkBibleDb: () => ipcRenderer.invoke('check-bible-db'),

  // Clipboard
  copyToClipboard: (text) => ipcRenderer.invoke('copy-to-clipboard', text),

  // VideoPsalm integration
  checkVideoPsalm:  () => ipcRenderer.invoke('check-videopsalm'),
  sendToVideoPsalm: (reference) => ipcRenderer.invoke('send-to-videopsalm', reference),

  // Incoming events from main process
  onTranscript:          (cb) => ipcRenderer.on('transcript-update',    (_e, d) => cb(d)),
  onListeningStatus:     (cb) => ipcRenderer.on('listening-status',     (_e, d) => cb(d)),
  onListeningError:      (cb) => ipcRenderer.on('listening-error',      (_e, d) => cb(d)),
  onScriptureSuggestion: (cb) => ipcRenderer.on('scripture-suggestion', (_e, d) => cb(d)),

  removeAllListeners: (ch) => ipcRenderer.removeAllListeners(ch),
})
