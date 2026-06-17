import { useState } from 'react'
import Icon from './Icon'

/**
 * The preacher asked for a translation ("read it in the NIV"). Nothing changes
 * on screen until the operator presses Switch, or T.
 */
export default function TranslationRequest({ request, onSwitch, onDismiss, compact = false }) {
  const [busy, setBusy] = useState(false)
  if (!request) return null

  const press = async () => {
    setBusy(true)
    await onSwitch()
    setBusy(false)
  }

  return (
    <div
      role="status"
      className={`flex items-center gap-3 bg-ink-2 border-b border-line ${compact ? 'px-2 py-1.5' : 'px-4 py-2'}`}
    >
      <span className="w-1.5 h-1.5 rounded-full bg-accent shrink-0" aria-hidden="true" />
      <p className="min-w-0 flex-1 truncate text-fg-2">
        Preacher asked for <span className="font-semibold text-fg">{request.code}</span>
        {!compact && <span className="ml-2 text-fg-3">heard "{request.heard}"</span>}
      </p>
      <button
        onClick={press}
        disabled={busy}
        title="Switch VideoPsalm to this Bible (T)"
        className="h-7 px-2.5 rounded-md bg-accent text-accent-ink font-medium hover:brightness-110 disabled:opacity-60"
      >
        {busy ? 'Switching' : compact ? 'Switch (T)' : 'Switch VideoPsalm (T)'}
      </button>
      <button
        onClick={onDismiss}
        aria-label="Dismiss"
        title="Dismiss"
        className="w-7 h-7 flex items-center justify-center rounded-md text-fg-3 hover:text-fg hover:bg-ink-3"
      >
        <Icon name="close" size={14} />
      </button>
    </div>
  )
}
