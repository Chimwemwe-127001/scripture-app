import { useEffect, useRef } from 'react'

export default function TranscriptPanel({ words }) {
  const bottomRef = useRef(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [words])

  const text = words.join(' ')

  return (
    <div className="flex flex-col w-64 shrink-0 bg-surface-2 rounded-lg overflow-hidden border border-surface-3">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-surface-3 shrink-0">
        <svg className="w-4 h-4 text-brand-light shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
            d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
        </svg>
        <span className="text-xs font-semibold text-surface-4 uppercase tracking-wider">Live Transcript</span>
      </div>

      <div className="flex-1 overflow-y-auto p-3">
        {words.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center gap-2 text-surface-4">
            <svg className="w-8 h-8 opacity-30" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
            </svg>
            <p className="text-xs opacity-50">Waiting for audio input…</p>
          </div>
        ) : (
          <p className="text-sm text-slate-200 leading-relaxed">
            {text}
            <span className="inline-block w-2 h-3 ml-0.5 bg-brand-light rounded-sm animate-pulse align-middle" />
          </p>
        )}
        <div ref={bottomRef} />
      </div>

      <div className="px-3 py-1.5 border-t border-surface-3 shrink-0">
        <span className="text-xs text-surface-4">
          {words.length} <span className="opacity-60">words</span>
        </span>
      </div>
    </div>
  )
}
