import { useState } from 'react'
import Icon from './Icon'

const CONFIDENCE = {
  high:   { bars: 3, label: 'High',   color: 'bg-ok' },
  medium: { bars: 2, label: 'Medium', color: 'bg-warn' },
  low:    { bars: 1, label: 'Low',    color: 'bg-fg-3' },
}

const SOURCE = {
  explicit:   'Cited',
  paraphrase: 'Paraphrase',
  allusion:   'Allusion',
}

/** Confidence as a label plus a 3-step bar, so it does not rely on colour. */
function Confidence({ level }) {
  const c = CONFIDENCE[level] || CONFIDENCE.low
  return (
    <span className="flex items-center gap-1.5 text-[12px] text-fg-3" title={`${c.label} confidence`}>
      <span className="flex items-end gap-[2px] h-[10px]" aria-hidden="true">
        {[1, 2, 3].map(n => (
          <span
            key={n}
            className={`w-[3px] rounded-[1px] ${n <= c.bars ? c.color : 'bg-line-strong'}`}
            style={{ height: `${4 + n * 2}px` }}
          />
        ))}
      </span>
      {c.label}
    </span>
  )
}

function CopyButton({ text }) {
  const [copied, setCopied] = useState(false)

  const copy = async (e) => {
    e.stopPropagation()
    try {
      // Prefer the main-process clipboard over navigator.clipboard. A packaged
      // build loads from file://, which is not a secure context, so the browser
      // API may be unavailable there.
      if (window.electronAPI?.copyToClipboard) {
        await window.electronAPI.copyToClipboard(text)
      } else {
        await navigator.clipboard.writeText(text)
      }
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      /* copying is a convenience, so a failure is not shown */
    }
  }

  return (
    <button
      onClick={copy}
      aria-label="Copy verse text"
      title="Copy verse text"
      className="w-8 h-8 flex items-center justify-center rounded-md text-fg-3 hover:text-fg hover:bg-ink-3"
    >
      <Icon name={copied ? 'check' : 'copy'} size={15} className={copied ? 'text-ok' : ''} />
    </button>
  )
}

function SendButton({ scripture, hotkey, primary, onSendToScreen }) {
  const [state, setState] = useState('idle')
  const [error, setError] = useState('')

  const send = async (e) => {
    e.stopPropagation()
    setState('sending')
    // Same handler as the number keys, so both paths behave identically.
    const result = await onSendToScreen(scripture)
    if (result?.ok) {
      setState('sent')
      setTimeout(() => setState('idle'), 2000)
    } else {
      setError(result?.error || 'Send failed')
      setState('error')
      setTimeout(() => setState('idle'), 3000)
    }
  }

  const look = state === 'error'
    ? 'border border-err/60 text-err'
    : state === 'sent'
      ? 'border border-ok/60 text-ok'
      : primary
        ? 'bg-accent text-accent-ink hover:brightness-110'
        : 'border border-line-strong text-fg hover:bg-ink-3'

  return (
    <button
      onClick={send}
      disabled={state === 'sending'}
      title={state === 'error' ? error : `Send to VideoPsalm${hotkey ? ` (${hotkey})` : ''}`}
      className={`flex items-center gap-2 h-8 pl-3 pr-2 rounded-md font-medium transition ${look}`}
    >
      {state === 'sending' ? 'Sending' : state === 'sent' ? 'Sent' : state === 'error' ? 'Failed' : 'Send'}
      {state === 'idle' && hotkey && (
        <kbd
          className={`font-mono text-[11px] min-w-[18px] h-[18px] px-1 flex items-center justify-center rounded-sm
            ${primary ? 'bg-accent-ink/15' : 'bg-ink-3 text-fg-2'}`}
        >
          {hotkey}
        </kbd>
      )}
      {state === 'sent' && <Icon name="check" size={14} />}
    </button>
  )
}

/**
 * ScriptureCard: one suggestion in the Next up queue.
 *
 * Reading order is hotkey, reference, verse, then where it came from. The
 * top card (key 1) is emphasised because it is what the operator most often
 * sends. Hovering highlights the source of the card in the transcript.
 */
export default function ScriptureCard({ scripture, hotkey, primary, onSent, onSendToScreen, onFocusRef }) {
  const copyText = `${scripture.reference} (${scripture.translation})\n"${scripture.text}"`
  const heardDiffers = scripture.heard && scripture.heard.toLowerCase() !== scripture.reference.toLowerCase()

  return (
    <article
      className={`card-enter group grid grid-cols-[52px_1fr] border-b border-line cursor-default
        ${primary ? 'bg-ink-2 shadow-[inset_2px_0_0_var(--color-accent)]' : 'hover:bg-ink-2/60'}`}
      onMouseEnter={() => onFocusRef?.(scripture.reference)}
      onMouseLeave={() => onFocusRef?.(null)}
      onClick={() => onSent?.(scripture, false)}
      title="Click to mark as used without sending"
    >
      <div className={`pt-3.5 text-center font-mono text-[22px] leading-none
        ${primary ? 'text-accent' : 'text-fg-3'}`}
      >
        {hotkey ?? ''}
      </div>

      <div className="py-3 pr-4 min-w-0">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-baseline gap-2 min-w-0">
            <h3 className="text-[15px] font-semibold text-fg truncate">{scripture.reference}</h3>
            <span className="font-mono text-[11px] text-fg-3">{scripture.translation}</span>
          </div>
          <Confidence level={scripture.confidence} />
        </div>

        <p className={`mt-1.5 font-serif leading-[1.55] line-clamp-3
          ${primary ? 'text-[17px] text-fg' : 'text-[16px] text-fg-2'}`}
        >
          {scripture.text}
        </p>

        <div className="mt-2.5 flex items-center justify-between gap-3">
          <p className="text-[12px] text-fg-3 truncate">
            {scripture.manual
              ? 'Typed by operator'
              : <>
                  {SOURCE[scripture.trigger] || scripture.trigger}
                  {heardDiffers && <> · heard <span className="text-fg-2 italic">"{scripture.heard}"</span></>}
                </>}
          </p>
          <div className="flex items-center gap-1 shrink-0">
            <CopyButton text={copyText} />
            <SendButton
              scripture={scripture}
              hotkey={hotkey}
              primary={primary}
              onSendToScreen={onSendToScreen}
            />
          </div>
        </div>
      </div>
    </article>
  )
}
