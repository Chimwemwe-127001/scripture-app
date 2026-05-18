import { useState, useEffect, useRef } from 'react'

/** Format sentAt timestamp as relative or clock time */
function timeAgo(ts) {
  const diff = Math.floor((Date.now() - ts) / 1000)
  if (diff < 5)  return 'just now'
  if (diff < 60) return `${diff}s ago`
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  const d = new Date(ts)
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function useRelativeTimes(items) {
  const [, setTick] = useState(0)
  useEffect(() => {
    if (items.length === 0) return
    const id = setInterval(() => setTick(t => t + 1), 10000)
    return () => clearInterval(id)
  }, [items.length])
}

function ResendBtn({ scripture }) {
  const [state, setState] = useState('idle')
  const [errMsg, setErrMsg] = useState('')

  const resend = async (e) => {
    e.stopPropagation()
    setState('sending')
    try {
      const result = await window.electronAPI?.sendToVideoPsalm(scripture.reference)
      if (result?.ok) {
        setState('ok')
        setTimeout(() => setState('idle'), 2000)
      } else {
        setErrMsg(result?.error || 'Error')
        setState('error')
        setTimeout(() => setState('idle'), 3000)
      }
    } catch (err) {
      setErrMsg(err.message)
      setState('error')
      setTimeout(() => setState('idle'), 3000)
    }
  }

  if (state === 'ok')
    return <span className="text-xs text-high font-medium px-2">Sent ✓</span>
  if (state === 'error')
    return <span className="text-xs text-red-400 px-2" title={errMsg}>Failed</span>

  return (
    <button
      onClick={resend}
      disabled={state === 'sending'}
      title="Resend to VideoPsalm"
      className="opacity-0 group-hover:opacity-100 flex items-center gap-1 text-xs
                 text-brand-light hover:text-white transition-all px-2 py-0.5
                 rounded border border-brand/40 hover:border-brand hover:bg-brand/20"
    >
      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
          d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
      </svg>
      {state === 'sending' ? '…' : 'Resend'}
    </button>
  )
}

export default function SentScreen({ history, onRemove, onClear }) {
  useRelativeTimes(history)
  const bottomRef = useRef(null)

  // Scroll to newest when items are added
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }, [history.length])

  return (
    <div className="flex flex-col w-72 shrink-0 bg-surface-2 rounded-lg overflow-hidden border border-surface-3">

      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-surface-3 shrink-0">
        <div className="flex items-center gap-2">
          <svg className="w-4 h-4 text-brand-light shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
          </svg>
          <span className="text-xs font-semibold text-surface-4 uppercase tracking-wider">Sent to Screen</span>
        </div>
        {history.length > 0 && (
          <span className="bg-brand text-white text-xs font-bold px-2 py-0.5 rounded-full">
            {history.length}
          </span>
        )}
      </div>

      {/* Items list — newest at top */}
      <div className="flex-1 overflow-y-auto p-2 flex flex-col gap-1.5">
        {history.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center gap-2 text-surface-4 py-8">
            <svg className="w-9 h-9 opacity-20" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1}
                d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
            </svg>
            <p className="text-xs opacity-40">Nothing sent to screen yet</p>
            <p className="text-xs opacity-25 mt-1">Click "Send to Screen" on any verse</p>
          </div>
        ) : (
          [...history].reverse().map(item => (
            <div
              key={item.id}
              className="bg-surface border border-surface-3 rounded-lg px-3 py-2 group
                         hover:border-brand/40 transition-colors"
            >
              <div className="flex items-start justify-between gap-1 mb-0.5">
                <div className="flex items-center gap-1.5 min-w-0">
                  {item.sentToVP && (
                    <svg className="w-3 h-3 text-brand-light shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                        d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                    </svg>
                  )}
                  <span className="text-brand-light font-semibold text-sm truncate">{item.reference}</span>
                  <span className="text-surface-4 text-xs shrink-0">{item.translation}</span>
                </div>

                <div className="flex items-center gap-0.5 shrink-0">
                  <ResendBtn scripture={item} />
                  <button
                    onClick={() => onRemove(item.id)}
                    className="opacity-0 group-hover:opacity-100 text-surface-4 hover:text-red-400 transition-all p-0.5 rounded"
                    title="Remove"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              </div>

              <p className="text-slate-400 text-xs leading-relaxed line-clamp-2">{item.text}</p>
              <p className="text-surface-4 text-xs mt-1 opacity-60">{timeAgo(item.sentAt)}</p>
            </div>
          ))
        )}
        <div ref={bottomRef} />
      </div>

      {/* Footer */}
      <div className="px-3 py-2 border-t border-surface-3 shrink-0">
        <div className="flex items-center justify-between">
          <span className="text-xs text-surface-4">
            {history.length} {history.length === 1 ? 'verse' : 'verses'} this session
          </span>
          {history.length > 0 && (
            <button
              onClick={onClear}
              className="text-xs text-surface-4 hover:text-red-400 transition-colors"
            >
              Clear history
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
