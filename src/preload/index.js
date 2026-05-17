const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
  onTranscript: (callback) => ipcRenderer.on('transcript-update', (_e, data) => callback(data)),
  onScripture: (callback) => ipcRenderer.on('scripture-suggestion', (_e, data) => callback(data)),
  removeAllListeners: (channel) => ipcRenderer.removeAllListeners(channel)
})
