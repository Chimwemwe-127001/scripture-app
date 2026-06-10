import { useEffect, useState } from 'react'
import Icon from './Icon'

/** Elapsed time since `since`, as H:MM:SS, updated every second. */
function SessionClock({ since }) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])
  const total = Math.max(0, Math.floor((now - since) / 1000))
  const h = Math.floor(total / 3600)
  const m = String(Math.floor((total % 3600) / 60)).padStart(2, '0')
  const s = String(total % 60).padStart(2, '0')
  return <span className="font-mono text-fg">{h}:{m}:{s}</span>
}

const DOT = {
  ok:   'bg-ok',
  warn: 'bg-warn',
  err:  'bg-err',
  off:  'bg-line-strong',
}

/** One system dependency: a state dot, a name and a short detail. */
function StatusChip({ state, label, detail, title }) {
  return (
    <div className="flex items-center gap-1.5 px-2 h-7 text-[12px]" title={title}>
      <span className={`w-1.5 h-1.5 rounded-full ${DOT[state]}`} />
      <span className="text-fg-2">{label}</span>
      {detail && <span className="text-fg-3 font-mono text-[11px]">{detail}</span>}
    </div>
  )
}

function ListenButton({ isListening, isStarting, onToggle }) {
  if (isStarting) {
    return (
      <button
        disabled
        className="flex items-center gap-2 h-8 px-3 rounded-md border border-line-strong text-fg-2 cursor-wait"
      >
        <span className="w-3 h-3 rounded-full border-2 border-fg-3 border-t-transparent animate-spin" />
        Loading model
      </button>
    )
  }
  if (isListening) {
    return (
      <button
        onClick={onToggle}
        title="Stop listening (Ctrl+L)"
        className="flex items-center gap-2 h-8 px-3 rounded-md border border-line-strong text-fg
                   hover:bg-ink-3 transition-colors"
      >
        <Icon name="stop" size={14} />
        Stop
      </button>
    )
  }
  return (
    <button
      onClick={onToggle}
      title="Start listening (Ctrl+L)"
      className="flex items-center gap-2 h-8 px-3 rounded-md bg-accent text-accent-ink font-medium
                 hover:brightness-110 transition"
    >
      <Icon name="mic" size={14} />
      Listen
    </button>
  )
}

/**
 * TopBar: session control on the left, system status on the right.
 * The session state is the first thing an operator checks, so it sits next
 * to the only button they need before a service: Listen.
 */
export default function TopBar({
  isListening, isStarting, listeningSince, statusMsg,
  whisperModel, engine, llmStatus, vpStatus, bibleDbReady,
  onToggleListen, settingsOpen, onToggleSettings,
}) {
  // While listening, show what the worker really loaded and where it runs.
  const running = engine ? `${engine.model} · ${engine.device === 'cuda' ? 'GPU' : 'CPU'}` : whisperModel
  const whisper = isListening
    ? { state: 'ok', detail: running }
    : isStarting
      ? { state: 'warn', detail: 'loading' }
      : { state: 'off', detail: whisperModel }

  const llm = llmStatus === null
    ? { state: 'off', detail: 'checking', title: 'Checking LM Studio' }
    : llmStatus.ok
      ? { state: 'ok', detail: null, title: `Connected to ${llmStatus.model}` }
      : { state: 'off', detail: 'off', title: `Not connected (${llmStatus.error || 'unreachable'}). Optional: explicit references still work.` }

  return (
    <header className="flex items-center gap-4 h-12 px-3 bg-ink-1 border-b border-line shrink-0">
      <div className="flex items-center gap-2 pr-1">
        <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
          <path d="M10 5.5C8 4 5 3.7 2.5 4.3v11C5 14.7 8 15 10 16.5 12 15 15 14.7 17.5 15.3v-11C15 3.7 12 4 10 5.5Z"
                fill="none" stroke="var(--color-fg-2)" strokeWidth="1.4" strokeLinejoin="round" />
          <path d="M10 5.5v11" stroke="var(--color-accent)" strokeWidth="1.6" />
        </svg>
        <span className="font-semibold text-fg tracking-tight">Scripture Panel</span>
      </div>

      <ListenButton isListening={isListening} isStarting={isStarting} onToggle={onToggleListen} />

      <div className="flex items-center gap-2 min-w-0 flex-1 text-fg-3">
        {isListening && (
          <>
            <span className="w-2 h-2 rounded-full bg-live live-dot" aria-hidden="true" />
            <SessionClock since={listeningSince} />
          </>
        )}
        {statusMsg && <span className="truncate">{statusMsg}</span>}
      </div>

      <div className="flex items-center divide-x divide-line">
        <StatusChip label="Whisper" {...whisper} title="Speech-to-text" />
        <StatusChip label="LM Studio" {...llm} />
        <StatusChip
          label="VideoPsalm"
          state={vpStatus ? 'ok' : 'off'}
          title={vpStatus ? 'VideoPsalm is running' : 'VideoPsalm not detected'}
        />
        <StatusChip
          label="KJV"
          state={bibleDbReady ? 'ok' : 'err'}
          detail={bibleDbReady ? null : 'missing'}
          title={bibleDbReady ? 'Bible database loaded' : 'Run npm run setup-bible'}
        />
      </div>

      <button
        onClick={onToggleSettings}
        aria-label="Settings"
        aria-expanded={settingsOpen}
        title="Settings (Ctrl+,)"
        className={`flex items-center justify-center w-8 h-8 rounded-md transition-colors
          ${settingsOpen ? 'bg-ink-3 text-fg' : 'text-fg-2 hover:bg-ink-2 hover:text-fg'}`}
      >
        <Icon name="sliders" />
      </button>
    </header>
  )
}
