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

export default function ScriptureCard({ scripture, onSelect }) {
  const conf = CONFIDENCE_STYLES[scripture.confidence] || CONFIDENCE_STYLES.low

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
        <span className="text-xs text-brand opacity-0 group-hover:opacity-100 transition-opacity font-medium">
          ＋ Select →
        </span>
      </div>
    </div>
  )
}
