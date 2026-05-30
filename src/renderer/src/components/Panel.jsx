/**
 * Panel: the frame shared by the three console columns, so headers,
 * counts and footers line up across the whole screen.
 */
export default function Panel({ title, count, actions, footer, className = '', children }) {
  return (
    <section className={`flex flex-col min-h-0 bg-ink-1 ${className}`} aria-label={title}>
      <header className="flex items-center justify-between h-10 px-4 border-b border-line shrink-0">
        <div className="flex items-baseline gap-2">
          <h2 className="text-[12px] font-semibold text-fg-2">{title}</h2>
          {count > 0 && <span className="font-mono text-[11px] text-fg-3">{count}</span>}
        </div>
        <div className="flex items-center gap-1">{actions}</div>
      </header>
      <div className="flex-1 min-h-0 overflow-y-auto">{children}</div>
      {footer && (
        <footer className="flex items-center justify-between h-8 px-4 border-t border-line shrink-0 text-[12px] text-fg-3">
          {footer}
        </footer>
      )}
    </section>
  )
}

/** Small text button used in panel headers ("Clear"). */
export function PanelAction({ onClick, children, title }) {
  return (
    <button
      onClick={onClick}
      title={title}
      className="h-6 px-2 rounded-sm text-[12px] text-fg-3 hover:text-fg hover:bg-ink-2 transition-colors"
    >
      {children}
    </button>
  )
}
