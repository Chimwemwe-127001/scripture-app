import { useState, useRef, useEffect } from 'react'
import Icon from './Icon'

/**
 * ManualSearch: the operator's override.
 *
 * Detection will sometimes miss: the room is loud, the preacher paraphrases,
 * or the LLM is not running. The operator can always type the reference.
 * Ctrl+F focuses this box from anywhere in the app.
 */
export default function ManualSearch({ onLookup }) {
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

    if (result?.ok) setQuery('')
    else setError(result?.error || 'Not found')
  }

  return (
    <form onSubmit={submit}>
      <div
        className={`flex items-center gap-2 h-9 px-3 rounded-md bg-ink-2 border transition-colors
          ${error ? 'border-err/70' : 'border-line hover:border-line-strong focus-within:border-accent'}`}
      >
        <Icon name="search" size={15} className="text-fg-3 shrink-0" />
        <input
          ref={inputRef}
          name="lookup"
          type="text"
          value={query}
          onChange={e => { setQuery(e.target.value); setError('') }}
          onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); setError(''); e.target.blur() } }}
          placeholder="Look up a reference, e.g. Romans 8:28 or first john 1 verse 9"
          aria-label="Look up a reference"
          aria-invalid={!!error}
          spellCheck={false}
          className="flex-1 min-w-0 bg-transparent text-fg placeholder:text-fg-3 focus:outline-none"
        />
        <kbd className="font-mono text-[11px] text-fg-3 px-1.5 h-5 flex items-center border border-line rounded-sm">
          {busy ? '...' : query ? 'Enter' : 'Ctrl F'}
        </kbd>
      </div>
      {error && (
        <p role="alert" className="mt-1.5 flex items-center gap-1.5 text-[12px] text-err">
          <Icon name="alert" size={13} />
          {error}
        </p>
      )}
    </form>
  )
}
