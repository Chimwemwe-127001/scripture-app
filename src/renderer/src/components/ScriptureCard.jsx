const CONFIDENCE_STYLES = {
  high:   { badge: 'bg-high/20 text-high border-high/40',   dot: 'bg-high',   label: 'High' },
  medium: { badge: 'bg-medium/20 text-medium border-medium/40', dot: 'bg-medium', label: 'Med' },
  low:    { badge: 'bg-low/20 text-low border-low/40',     dot: 'bg-low',   label: 'Low' }
}

const TRIGGER_LABELS = {
  explicit:   'Explicit',
  paraphrase: 'Paraphrase',
  allusion:   'Allusion'
}

import { useState } from 'react'

// Monitor icon (screen/display)
function MonitorIcon({ className }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
        d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
    </svg>
  )
}

function CopyButton({ text }) {
  const [copied, setCopied] = useState(false)
  const copy = (e) => {
    e.stopPropagation()
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }
  return (
    <button
      onClick={copy}
      title="Copy verse"
      className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-surface-3 text-surface-4 hover:text-white shrink-0"
    >
      {copied
        ? <svg className="w-3.5 h-3.5 text-high" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
        : <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
      }
    </button>
  )
}

// Sends reference directly to VideoPsalm's search box
function SendToVPButton({ reference }) {
  const [state, setState] = useState('idle') // idle | sending | ok | error
  const [errMsg, setErrMsg] = useState('')

  const send = async (e) => {
    e.stopPropagation()
    setState('sending')
    try {
      const result = await window.electronAPI.sendToVideoPsalm(reference)
      if (result?.ok) {
        setState('ok')
        setTimeout(() => setState('idle'), 2000)
      } else {
        setErrMsg(result?.error || 'Unknown error')
        setState('error')
        setTimeout(() => setState('idle'), 3000)
      }
    } catch (err) {
      setErrMsg(err.message || 'Failed')
      setState('error')
      setTimeout(() => setState('idle'), 3000)
    }
  }

  const label = {
    idle:    'Send to screen',
    sending: 'Sending…',
    ok:      'Sent ✓',
    error:   errMsg || 'Error',
  }[state]

  const colors = {
    idle:    'bg-brand/20 hover:bg-brand/40 text-brand-light border-brand/30 hover:border-brand',
    sending: 'bg-surface-3 text-surface-4 border-surface-3 cursor-wait',
    ok:      'bg-high/20 text-high border-high/40',
    error:   'bg-red-900/30 text-red-400 border-red-700/40',
  }[state]

  return (
    <button
      onClick={send}
      disabled={state === 'sending'}
      title={state === 'error' ? errMsg : 'Send verse reference to VideoPsalm'}
      className={`opacity-0 group-hover:opacity-100 transition-all flex items-center gap-1 text-xs px-2 py-0.5 rounded border font-medium ${colors}`}
    >
      <MonitorIcon className="w-3 h-3 shrink-0" />
      <span className="whitespace-nowrap">{label}</span>
    </button>
  )
}

export default function ScriptureCard({ scripture, onSelect }) {
  const conf = CONFIDENCE_STYLES[scripture.confidence] || CONFIDENCE_STYLES.low
  const copyText = `${scripture.reference} (${scripture.translation})\n"${scripture.text}"`

  return (
    <div
      className="card-enter bg-surface-2 border border-surface-3 rounded-lg p-3 cursor-pointer
                 hover:border-brand hover:bg-surface-3 transition-all duration-150 group"
      onClick={() => onSelect(scripture)}
      title="Click to add to selected queue"
    >
      <div className="flex items-start justify-between gap-2 mb-2">
        <div>
          <span className="text-brand-light font-semibold text-sm group-hover:text-white transition-colors">
            {scripture.reference}
          </span>
          <span className="ml-2 text-surface-4 text-xs">{scripture.translation}</span>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <CopyButton text={copyText} />
          <span className={`inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded border font-medium ${conf.badge}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${conf.dot}`} />
            {conf.label}
          </span>
        </div>
      </div>

      <p className="text-slate-300 text-xs leading-relaxed line-clamp-3 mb-2">
        {scripture.text}
      </p>

      <div className="flex items-center justify-between">
        <span className="text-surface-4 text-xs italic">
          {TRIGGER_LABELS[scripture.trigger] || scripture.trigger}
        </span>
        <div className="flex items-center gap-2">
          <SendToVPButton reference={scripture.reference} />
          <span className="text-xs text-brand opacity-0 group-hover:opacity-100 transition-opacity font-medium">
            ＋ Select →
          </span>
        </div>
      </div>
    </div>
  )
}
