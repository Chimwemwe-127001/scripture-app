import { useState } from 'react'

function CopyBtn({ text, title = 'Copy verse' }) {
  const [copied, setCopied] = useState(false)
  const copy = (e) => {
    e.stopPropagation()
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }
  return (
    <button onClick={copy} title={title}
      className="p-1 rounded hover:bg-surface-3 text-surface-4 hover:text-white transition-colors shrink-0 opacity-0 group-hover:opacity-100">
      {copied
        ? <svg className="w-3.5 h-3.5 text-high" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
        : <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
      }
    </button>
  )
}

function CopyAllBtn({ text }) {
  const [copied, setCopied] = useState(false)
  const copy = () => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }
  return (
    <button onClick={copy} title="Copy all verses"
      className="flex items-center gap-1 text-xs text-surface-4 hover:text-white transition-colors">
      {copied
        ? <svg className="w-3 h-3 text-high" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
        : <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
      }
      {copied ? 'Copied!' : 'Copy all'}
    </button>
  )
}

export default function SelectedQueue({ queue, onRemove }) {
  const allText = queue.map((v, i) => `${i + 1}. ${v.reference} (${v.translation})\n"${v.text}"`).join('\n\n')

  return (
    <div className="flex flex-col w-72 shrink-0 bg-surface-2 rounded-lg overflow-hidden border border-surface-3">
      <div className="flex items-center justify-between px-3 py-2 border-b border-surface-3 shrink-0">
        <div className="flex items-center gap-2">
          <svg className="w-4 h-4 text-brand-light shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
          </svg>
          <span className="text-xs font-semibold text-surface-4 uppercase tracking-wider">Selected Queue</span>
        </div>
        {queue.length > 0 && (
          <span className="bg-brand text-white text-xs font-bold px-2 py-0.5 rounded-full">
            {queue.length}
          </span>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-2">
        {queue.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center gap-2 text-surface-4">
            <svg className="w-8 h-8 opacity-20" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1}
                d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
            </svg>
            <p className="text-xs opacity-40">No verses selected yet</p>
          </div>
        ) : (
          queue.map((verse, index) => (
            <div
              key={verse.id}
              className="bg-surface border border-brand/30 rounded-lg p-3 relative group"
            >
              <div className="flex items-start justify-between gap-2 mb-1.5">
                <div className="flex items-center gap-2">
                  <span className="w-5 h-5 rounded-full bg-brand text-white text-xs flex items-center justify-center font-bold shrink-0">
                    {index + 1}
                  </span>
                  <span className="text-brand-light font-semibold text-sm">{verse.reference}</span>
                  <span className="text-surface-4 text-xs">{verse.translation}</span>
                </div>
                <div className="flex items-center gap-0.5">
                  <CopyBtn text={`${verse.reference} (${verse.translation})\n"${verse.text}"`} />
                  <button
                    onClick={() => onRemove(verse.id)}
                    className="text-surface-4 hover:text-red-400 transition-colors shrink-0 opacity-0 group-hover:opacity-100"
                    title="Remove from queue"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              </div>
              <p className="text-slate-300 text-xs leading-relaxed line-clamp-2">
                {verse.text}
              </p>
            </div>
          ))
        )}
      </div>

      <div className="px-3 py-2 border-t border-surface-3 shrink-0">
        <div className="flex items-center justify-between">
          <span className="text-xs text-surface-4">
            {queue.length} {queue.length === 1 ? 'verse' : 'verses'} ready
          </span>
          {queue.length > 0 && (
            <div className="flex items-center gap-2">
              <CopyAllBtn text={allText} />
              <button
                onClick={() => queue.forEach(v => onRemove(v.id))}
                className="text-xs text-surface-4 hover:text-red-400 transition-colors"
              >
                Clear all
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
