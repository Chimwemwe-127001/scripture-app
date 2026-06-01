import Icon from './Icon'

const SHORTCUTS = [
  ['1-9', 'Send'],
  ['Ctrl F', 'Find'],
  ['Ctrl L', 'Listen'],
  ['Ctrl ,', 'Settings'],
]

/**
 * StatusBar: one line for what just happened (an error, or a confirmation
 * after a keyboard send) and the shortcuts, always visible.
 */
export default function StatusBar({ error, notice, onDismiss }) {
  return (
    <footer
      className={`flex items-center justify-between h-8 px-3 border-t shrink-0 text-[12px]
        ${error ? 'bg-[#2a1416] border-err/40' : 'bg-ink-1 border-line'}`}
    >
      <div role="status" aria-live="polite" className="flex items-center gap-2 min-w-0">
        {error ? (
          <>
            <Icon name="alert" size={13} className="text-err shrink-0" />
            <span className="text-err truncate">{error}</span>
            <button onClick={onDismiss} className="ml-1 text-fg-3 hover:text-fg shrink-0">
              Dismiss <kbd className="font-mono">Esc</kbd>
            </button>
          </>
        ) : notice ? (
          <span className="text-fg-2 truncate">{notice}</span>
        ) : (
          <span className="text-fg-3">Ready</span>
        )}
      </div>
      <div className="flex items-center gap-4 text-fg-3 shrink-0">
        {SHORTCUTS.map(([keys, label]) => (
          <span key={keys} className="flex items-center gap-1.5">
            <kbd className="font-mono text-[11px] text-fg-2 px-1 h-[18px] flex items-center border border-line rounded-sm">{keys}</kbd>
            {label}
          </span>
        ))}
      </div>
    </footer>
  )
}
