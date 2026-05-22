import { useState, useRef, useEffect } from 'react'

/**
 * ManualSearch: the operator's override.
 *
 * Detection will sometimes miss: the room is loud, the preacher paraphrases,
 * or the LLM is not running. The operator can always type the reference.
 * Ctrl+F focuses this box from anywhere in the app.
 */
export default function ManualSearch({ onLookup, disabled }) {
  const [query, setQuery] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const inputRef = useRef(null)

  // Ctrl+F / Cmd+F focuses the box, so a verse can be found without the mouse.
  useEffect(() => {
    const handler = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
        e.preventDefault()
        inputRef.current?.focus()
        inputRef.current?.select()
      }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [])

  async function submit(e) {
    e.preventDefault()
    const text = query.trim()
    if (!text || busy) return

    setBusy(true)
    setError('')
    const result = await onLookup(text)
    setBusy(false)

    if (result?.ok) {
      setQuery('')
    } else {
      setError(result?.error || 'Not found')
      setTimeout(() => setError(''), 4000)
    }
  }

  return (
    <form onSubmit={submit} className="relative flex items-center">
      <svg
        className="absolute left-2 w-3.5 h-3.5 text-surface-4 pointer-events-none"
        fill="none" stroke="currentColor" viewBox="0 0 24 24"
      >
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
          d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
      </svg>

      <input
        ref={inputRef}
        type="text"
        value={query}
        disabled={disabled}
        onChange={e => { setQuery(e.target.value); setError('') }}
        onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); e.target.blur() } }}
        placeholder="Look up a verse…"
        title="Type a reference such as John 3:16 (Ctrl+F)"
        className={`bg-surface-3 border text-white text-xs rounded pl-7 pr-14 py-1 w-52
                    placeholder:text-surface-4 focus:outline-none transition-colors
                    disabled:opacity-40
                    ${error ? 'border-red-600' : 'border-surface-3 focus:border-brand'}`}
      />

      <button
        type="submit"
        disabled={disabled || busy || !query.trim()}
        className="absolute right-1 text-[10px] px-1.5 py-0.5 rounded bg-brand hover:bg-brand-light
                   text-white disabled:opacity-30 disabled:hover:bg-brand transition-colors"
      >
        {busy ? '…' : 'Find'}
      </button>

      {error && (
        <div className="absolute top-8 left-0 z-50 bg-red-900/90 border border-red-700 text-red-200
                        text-xs rounded px-2 py-1 whitespace-nowrap shadow-lg">
          {error}
        </div>
      )}
    </form>
  )
}
