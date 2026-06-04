import { useState } from 'react'
import Icon from './Icon'
import Panel, { PanelAction } from './Panel'

const clockTime = (ts) =>
  new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })

function IconButton({ icon, label, onClick }) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      title={label}
      className="w-7 h-7 flex items-center justify-center rounded-md text-fg-3 hover:text-fg hover:bg-ink-3"
    >
      <Icon name={icon} size={14} />
    </button>
  )
}

/** The verse currently in VideoPsalm, marked the way a program monitor is. */
function LiveVerse({ item, onResend }) {
  const [busy, setBusy] = useState(false)
  const resend = async () => {
    setBusy(true)
    await onResend(item)
    setBusy(false)
  }

  return (
    <div className="m-3 rounded-md border border-line-strong overflow-hidden">
      <div className="h-[3px] bg-live" />
      <div className="p-4">
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-wider text-live">
            <span className="w-1.5 h-1.5 rounded-full bg-live live-dot" aria-hidden="true" />
            On screen
          </span>
          <time className="font-mono text-[11px] text-fg-3">{clockTime(item.sentAt)}</time>
        </div>
        <h3 className="mt-2 text-[19px] font-semibold text-fg">
          {item.reference}
          <span className="ml-2 font-mono text-[11px] font-normal text-fg-3">{item.translation}</span>
        </h3>
        <p className="mt-2 font-serif text-[16px] leading-[1.55] text-fg line-clamp-6">{item.text}</p>
        <button
          onClick={resend}
          disabled={busy}
          className="mt-4 flex items-center gap-2 h-8 px-3 rounded-md border border-line-strong text-fg hover:bg-ink-3"
        >
          <Icon name="resend" size={14} />
          {busy ? 'Sending' : 'Send again'}
        </button>
      </div>
    </div>
  )
}

/**
 * OnScreenPanel: what the congregation is seeing now, and what was shown
 * earlier in the service. Earlier verses can be sent again in one click,
 * which is common when a preacher returns to a text.
 */
export default function OnScreenPanel({ history, onResend, onRemove, onClear }) {
  const live = [...history].reverse().find(h => h.sentToVP)
  const earlier = [...history].reverse().filter(h => h !== live)

  return (
    <Panel
      title="On screen"
      className="w-[360px] shrink-0"
      actions={history.length > 0 && <PanelAction onClick={onClear} title="Clear history">Clear</PanelAction>}
      footer={<span className="font-mono">{history.length} used this service</span>}
    >
      {live ? (
        <LiveVerse item={live} onResend={onResend} />
      ) : (
        <div className="m-3 rounded-md border border-dashed border-line-strong px-5 py-8 text-center">
          <p className="text-fg-2">Nothing on screen yet.</p>
          <p className="mt-1 text-fg-3">
            Press <kbd className="font-mono text-fg-2 px-1 border border-line rounded-sm">1</kbd> to send the top suggestion.
          </p>
        </div>
      )}

      {earlier.length > 0 && (
        <>
          <h3 className="px-4 pt-3 pb-1.5 text-[11px] font-medium uppercase tracking-wider text-fg-3">Earlier</h3>
          <ul>
            {earlier.map(item => (
              <li key={`${item.id}-${item.sentAt}`} className="group grid grid-cols-[52px_1fr_auto] items-start px-1 py-2 border-t border-line hover:bg-ink-2/60">
                <time className="pl-3 pt-0.5 font-mono text-[11px] text-fg-3">{clockTime(item.sentAt)}</time>
                <div className="min-w-0">
                  <p className="text-fg font-medium">
                    {item.reference}
                    {!item.sentToVP && <span className="ml-2 text-[11px] font-normal text-fg-3">marked, not sent</span>}
                  </p>
                  <p className="text-[12px] text-fg-3 truncate">{item.text}</p>
                </div>
                <div className="flex pr-2 opacity-0 group-hover:opacity-100 focus-within:opacity-100">
                  <IconButton icon="resend" label={`Send ${item.reference} again`} onClick={() => onResend(item)} />
                  <IconButton icon="close" label={`Remove ${item.reference}`} onClick={() => onRemove(item)} />
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </Panel>
  )
}
