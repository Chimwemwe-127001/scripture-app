import { useEffect, useRef } from 'react'

export default function TranscriptPanel({ segments, isListening, isAnalyzing, chunkHighlights = [], onClear }) {
  const bottomRef = useRef(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [segments])

  const wordCount = segments.reduce((n, s) => n + s.text.split(/\s+/).length, 0)

  function getSegmentHighlight(seg) {
    // Matches on `seg.at` (arrival time). A segment is highlighted when it
    // arrived inside a chunk's time window, plus a short grace period.
    const at = seg.at
    if (at == null) return null
    for (const h of chunkHighlights) {
      if (at >= h.startAt && at <= h.fireAt + 1500) return h.color
    }
    return null
  }

  return (
    <div className="flex flex-col w-64 shrink-0 bg-surface-2 rounded-lg overflow-hidden border border-surface-3">
      <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-surface-3 shrink-0">
        <div className="flex items-center gap-2">
          <svg className="w-4 h-4 text-brand-light shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
          </svg>
          <span className="text-xs font-semibold text-surface-4 uppercase tracking-wider">Live Transcript</span>
        </div>
        {segments.length > 0 && (
          <button
            onClick={onClear}
            className="text-xs text-surface-4 hover:text-red-400 transition-colors"
            title="Clear transcript"
          >
            Clear
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-3">
        {segments.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center gap-2 text-surface-4">
            <svg className="w-8 h-8 opacity-30" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
            </svg>
            <p className="text-xs opacity-50">Waiting for audio input…</p>
          </div>
        ) : (
          <div className="text-sm text-slate-200 leading-relaxed">
            {segments.map((seg) => {
              const hl = getSegmentHighlight(seg)
              return (
                <span
                  key={seg.id}
                  className="segment-enter"
                  style={hl ? {
                    backgroundColor: hl.bg,
                    color: hl.text,
                    borderRadius: '3px',
                    padding: '1px 3px',
                    margin: '0 1px',
                  } : undefined}
                >
                  {seg.text}{' '}
                </span>
              )
            })}
            {isListening && (
              <span className="inline-block w-2 h-3 ml-0.5 bg-brand-light rounded-sm animate-pulse align-middle" />
            )}
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      <div className="px-3 py-1.5 border-t border-surface-3 shrink-0 flex items-center justify-between">
        <span className="text-xs text-surface-4">
          {wordCount} <span className="opacity-60">words</span>
        </span>
        {isAnalyzing && (
          <span className="flex items-center gap-1.5 text-xs text-amber-400">
            <span className="flex gap-px items-end h-3">
              <span className="w-0.5 h-2 bg-amber-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
              <span className="w-0.5 h-3 bg-amber-400 rounded-full animate-bounce" style={{ animationDelay: '120ms' }} />
              <span className="w-0.5 h-1.5 bg-amber-400 rounded-full animate-bounce" style={{ animationDelay: '240ms' }} />
            </span>
            <span>Analyzing…</span>
          </span>
        )}
      </div>
    </div>
  )
}
