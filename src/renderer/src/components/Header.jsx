import { useEffect, useState } from 'react'

const MODELS = [
  { value: 'tiny',     label: 'tiny (~75 MB)' },
  { value: 'base',     label: 'base (~140 MB)' },
  { value: 'small',    label: 'small (~460 MB)' },
  { value: 'medium',   label: 'medium (~1.5 GB)' },
  { value: 'large-v3', label: 'large-v3 (~3 GB)' },
]

const api = window.electronAPI

export default function Header({
  isListening, statusMsg, errorMsg, demoMode,
  whisperModel, deviceIndex,
  onModelChange, onDeviceChange,
  onToggleListen, onToggleDemo,
}) {
  const [devices, setDevices] = useState([])
  const [loadingDevices, setLoadingDevices] = useState(false)

  useEffect(() => {
    if (!api) return
    setLoadingDevices(true)
    api.getAudioDevices().then(result => {
      if (Array.isArray(result)) setDevices(result)
      setLoadingDevices(false)
    })
  }, [])

  return (
    <header className="flex items-center justify-between px-4 py-2 bg-surface-2 border-b border-surface-3 shrink-0 gap-4 flex-wrap">
      {/* Logo + title */}
      <div className="flex items-center gap-2 shrink-0">
        <div className="w-7 h-7 rounded bg-brand flex items-center justify-center">
          <svg className="w-4 h-4 text-white" fill="currentColor" viewBox="0 0 20 20">
            <path d="M9 4.804A7.968 7.968 0 005.5 4c-1.255 0-2.443.29-3.5.804v10A7.969 7.969 0 015.5 14c1.669 0 3.218.51 4.5 1.385A7.962 7.962 0 0114.5 14c1.255 0 2.443.29 3.5.804v-10A7.968 7.968 0 0014.5 4c-1.255 0-2.443.29-3.5.804V12a1 1 0 11-2 0V4.804z"/>
          </svg>
        </div>
        <span className="font-semibold text-white text-sm tracking-wide">Scripture Suggestion Panel</span>
      </div>

      {/* Controls row */}
      <div className="flex items-center gap-3 flex-wrap">

        {/* Whisper model selector */}
        <label className="flex items-center gap-1.5 text-xs text-surface-4">
          <span>Model</span>
          <select
            value={whisperModel}
            onChange={e => onModelChange(e.target.value)}
            disabled={isListening}
            className="bg-surface-3 border border-surface-3 text-white text-xs rounded px-2 py-1 focus:outline-none disabled:opacity-50"
          >
            {MODELS.map(m => (
              <option key={m.value} value={m.value}>{m.label}</option>
            ))}
          </select>
        </label>

        {/* Audio device selector */}
        {api && (
          <label className="flex items-center gap-1.5 text-xs text-surface-4">
            <span>Input</span>
            <select
              value={deviceIndex ?? ''}
              onChange={e => onDeviceChange(e.target.value === '' ? null : Number(e.target.value))}
              disabled={isListening || loadingDevices}
              className="bg-surface-3 border border-surface-3 text-white text-xs rounded px-2 py-1 max-w-[200px] focus:outline-none disabled:opacity-50"
            >
              <option value="">System default</option>
              {devices.map(d => (
                <option key={d.index} value={d.index}>{d.name}</option>
              ))}
            </select>
          </label>
        )}

        {/* Demo mode toggle */}
        <button
          onClick={onToggleDemo}
          disabled={isListening && !demoMode}
          title={demoMode ? 'Exit demo mode' : 'Run with simulated audio (no mic required)'}
          className={`text-xs px-2 py-1 rounded border transition-colors
            ${demoMode
              ? 'bg-amber-700/40 border-amber-600 text-amber-300'
              : 'border-surface-3 text-surface-4 hover:text-white hover:border-surface-4'
            } disabled:opacity-30`}
        >
          {demoMode ? '⚡ Demo' : 'Demo'}
        </button>

        {/* Start / Stop button */}
        <button
          onClick={onToggleListen}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-semibold transition-all
            ${isListening
              ? 'bg-red-700 hover:bg-red-600 text-white'
              : 'bg-brand hover:bg-brand-light text-white'
            }`}
        >
          {isListening ? (
            <>
              <span className="w-2 h-2 rounded-sm bg-white inline-block" />
              Stop
            </>
          ) : (
            <>
              <span className="relative flex w-2 h-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-50" />
                <span className="w-2 h-2 rounded-full bg-white inline-block" />
              </span>
              Listen
            </>
          )}
        </button>
      </div>

      {/* Status indicator */}
      <div className="flex items-center gap-2 shrink-0 ml-auto">
        <div className="relative flex items-center justify-center w-3 h-3">
          {isListening && <span className="pulse-ring absolute inline-flex h-3 w-3 rounded-full bg-high opacity-75" />}
          <span className={`w-2 h-2 rounded-full ${isListening ? 'bg-high' : 'bg-surface-4'}`} />
        </div>
        <span className={`text-xs ${isListening ? 'text-high' : 'text-surface-4'}`}>
          {statusMsg || (isListening ? 'LISTENING' : 'IDLE')}
        </span>
      </div>
    </header>
  )
}
