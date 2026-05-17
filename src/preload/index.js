const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
  // Audio device listing
  getAudioDevices: () => ipcRenderer.invoke('get-audio-devices'),

  // Whisper lifecycle
  startListening: (opts) => ipcRenderer.invoke('start-listening', opts),
  stopListening:  () => ipcRenderer.invoke('stop-listening'),

  // Incoming events from main process
  onTranscript:      (cb) => ipcRenderer.on('transcript-update',  (_e, d) => cb(d)),
  onListeningStatus: (cb) => ipcRenderer.on('listening-status',   (_e, d) => cb(d)),
  onListeningError:  (cb) => ipcRenderer.on('listening-error',    (_e, d) => cb(d)),

  removeAllListeners: (ch) => ipcRenderer.removeAllListeners(ch),
})
