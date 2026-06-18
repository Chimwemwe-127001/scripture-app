import { useEffect, useState } from 'react'
import Icon from './components/Icon'
import TranslationRequest from './components/TranslationRequest'

const api = window.electronAPI

// Same labels as the full window's cards.
const SOURCE = { explicit: 'Cited', paraphrase: 'Paraphrase', allusion: 'Allusion', quote: 'Quoted' }

const drag = { WebkitAppRegion: 'drag' }
const noDrag = { WebkitAppRegion: 'no-drag' }

function HeaderButton({ icon, label, onClick, children }) {
  return (
    <button
      onClick={onClick}
      title={label}
      aria-label={label}
      style={noDrag}
      className="h-7 min-w-7 px-1.5 flex items-center justify-center gap-1 rounded-md text-fg-2 hover:text-fg hover:bg-ink-3"
    >
      {icon && <Icon name={icon} size={14} />}
      {children}
    </button>
  )
}

/**
 * Mini: the small panel docked to VideoPsalm. It shows what the full window
 * publishes and sends every press back to it, so both always agree.
 */
export default function Mini() {
  const [state, setState] = useState(null)
  const act = (action) => api?.miniAction(action)

  useEffect(() => {
    if (!api?.onMiniState) return
    api.onMiniState(setState)
    act({ type: 'publish' })   // ask for the current state now that it can be received
    return () => api.removeAllListeners('mini-state')
  }, [])

  useEffect(() => {
    const handler = (e) => {
      if (e.ctrlKey && e.key === 'l') { e.preventDefault(); act({ type: 'toggle-listen' }); return }
      if (e.ctrlKey || e.altKey || e.metaKey) return
      if (/^[1-9]$/.test(e.key)) { e.preventDefault(); act({ type: 'send', number: Number(e.key) }); return }
      if ((e.key === 't' || e.key === 'T') && state?.translationAsk) { e.preventDefault(); act({ type: 'switch-bible' }) }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [state?.translationAsk])

  const s = state || { suggestions: [] }

  return (
    <div className="flex flex-col h-screen bg-ink-1 text-fg border border-line-strong">
      <header style={drag} className="flex items-center gap-2 h-10 pl-3 pr-1 border-b border-line shrink-0 select-none">
        {s.isListening
          ? <span className="w-2 h-2 rounded-full bg-live live-dot" aria-hidden="true" />
          : <span className="w-2 h-2 rounded-full bg-line-strong" aria-hidden="true" />}
        <span className="font-semibold tracking-tight">Scripture</span>
        <span className="flex-1 truncate text-[12px] text-fg-3">
          {s.isStarting ? 'loading model' : s.isListening ? 'listening' : 'not listening'}
        </span>
        <HeaderButton
          icon={s.isListening ? 'stop' : 'mic'}
          label={s.isListening ? 'Stop listening (Ctrl+L)' : 'Start listening (Ctrl+L)'}
          onClick={() => act({ type: 'toggle-listen' })}
        />
        <HeaderButton label="Collapse or expand" onClick={() => act({ type: 'collapse' })}>
          <span className="font-mono text-[13px]">_</span>
        </HeaderButton>
        <HeaderButton label="Open the full window" onClick={() => act({ type: 'open-main' })}>
          <span className="text-[12px]">Full</span>
        </HeaderButton>
      </header>

      <TranslationRequest
        compact
        request={s.translationAsk}
        onSwitch={() => act({ type: 'switch-bible' })}
        onDismiss={() => act({ type: 'dismiss-translation' })}
      />

      {s.live && (
        <div className="flex items-center gap-2 px-3 py-1.5 border-b border-line text-[12px]">
          <span className="w-1.5 h-1.5 rounded-full bg-live" aria-hidden="true" />
          <span className="font-mono uppercase tracking-wider text-live text-[10px]">On screen</span>
          <span className="truncate text-fg">{s.live.reference}</span>
          <span className="font-mono text-fg-3">{s.live.translation}</span>
          {s.live.mismatch && <span className="truncate text-warn">{s.live.mismatch}</span>}
        </div>
      )}

      {(s.error || s.notice) && (
        <p className={`px-3 py-1 text-[12px] truncate border-b border-line ${s.error ? 'text-err' : 'text-fg-2'}`}>
          {s.error || s.notice}
        </p>
      )}

      <ol className="flex-1 min-h-0 overflow-y-auto">
        {s.suggestions.length === 0 && (
          <li className="px-3 py-4 text-fg-3">
            {!state ? 'Connecting to the Scripture Panel…'
              : s.isListening ? 'Waiting for a verse.' : 'Press the microphone to start listening.'}
          </li>
        )}
        {s.suggestions.map((c, i) => (
          <li key={c.id}>
            <button
              onClick={() => act({ type: 'send', number: i + 1 })}
              title={`Send ${c.reference} to VideoPsalm (${i + 1})`}
              className={`w-full grid grid-cols-[22px_1fr] gap-x-2 px-2 py-1.5 text-left border-b border-line hover:bg-ink-2
                ${i === 0 ? 'bg-ink-2/60' : ''}`}
            >
              <kbd className={`row-span-2 mt-0.5 h-5 flex items-center justify-center rounded-sm border font-mono text-[11px]
                ${i === 0 ? 'border-accent text-accent' : 'border-line-strong text-fg-3'}`}>{i + 1}</kbd>
              <span className="flex items-baseline gap-2 min-w-0">
                <span className="font-semibold text-fg truncate">{c.reference}</span>
                <span className="text-[11px] text-fg-3 shrink-0">{SOURCE[c.trigger] || c.trigger}</span>
              </span>
              <span className="text-[12px] text-fg-3 truncate">{c.text}</span>
            </button>
          </li>
        ))}
      </ol>
    </div>
  )
}
