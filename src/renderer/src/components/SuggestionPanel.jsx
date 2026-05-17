import ScriptureCard from './ScriptureCard'

export default function SuggestionPanel({ suggestions, onSelect }) {
  return (
    <div className="flex flex-col flex-1 bg-surface rounded-lg overflow-hidden border border-surface-3">
      <div className="flex items-center justify-between px-3 py-2 border-b border-surface-3 shrink-0">
        <div className="flex items-center gap-2">
          <svg className="w-4 h-4 text-brand-light shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
          </svg>
          <span className="text-xs font-semibold text-surface-4 uppercase tracking-wider">Suggestions</span>
        </div>
        {suggestions.length > 0 && (
          <span className="bg-brand text-white text-xs font-bold px-2 py-0.5 rounded-full">
            {suggestions.length}
          </span>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-2">
        {suggestions.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center gap-3 text-surface-4">
            <svg className="w-10 h-10 opacity-20" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1}
                d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
            </svg>
            <div>
              <p className="text-sm font-medium opacity-40">Waiting for scripture matches…</p>
              <p className="text-xs opacity-30 mt-1">Suggestions appear as the pastor speaks</p>
            </div>
          </div>
        ) : (
          suggestions.map(s => (
            <ScriptureCard key={s.id} scripture={s} onSelect={onSelect} />
          ))
        )}
      </div>

      <div className="px-3 py-1.5 border-t border-surface-3 shrink-0">
        <span className="text-xs text-surface-4">
          Click a card to add it to the <span className="text-white">selected queue</span>
        </span>
      </div>
    </div>
  )
}
