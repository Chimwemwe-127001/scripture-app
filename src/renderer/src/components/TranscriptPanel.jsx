import { useEffect, useRef } from 'react'
import Panel, { PanelAction } from './Panel'

/** m:ss since the first line of the session. */
function clock(ms) {
  const s = Math.max(0, Math.floor(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/**
 * Work out how each transcript line relates to the suggestions.
 *
 * Explicit references (regex path) carry the exact `heard` text, so that
 * phrase is marked inside its line. Paraphrases (LLM path) only know the time
 * window of the chunk they came from, so those lines get a margin rule and
 * the reference is tagged on the last line of the window.
 */
function linkLines(segments, links) {
  const byLine = new Map(segments.map(s => [s.id, { phrases: [], inWindow: [], tags: [] }]))

  for (const link of links) {
    if (link.heard) {
      // Newest matching line inside the window around the detection.
      const needle = link.heard.toLowerCase()
      const hit = [...segments].reverse().find(s =>
        s.at >= link.startAt - 2000 && s.at <= link.fireAt + 2000 &&
        s.text.toLowerCase().includes(needle))
      if (hit) byLine.get(hit.id).phrases.push(link)
      continue
    }
    const inside = segments.filter(s => s.at >= link.startAt && s.at <= link.fireAt + 1500)
    inside.forEach(s => byLine.get(s.id).inWindow.push(link))
    if (inside.length) byLine.get(inside[inside.length - 1].id).tags.push(link)
  }
  return byLine
}

function RefTag({ link, focused }) {
  return (
    <span
      className={`ml-1.5 inline-flex items-center h-[18px] px-1.5 rounded-sm font-mono text-[11px] align-[1px]
        ${focused ? 'bg-accent text-accent-ink' : 'bg-ink-2 text-accent'}`}
    >
      {link.reference}
    </span>
  )
}

/** A line of text with each heard phrase underlined and tagged. */
function LineText({ text, phrases, focusRef }) {
  if (phrases.length === 0) return text
  const parts = []
  let rest = text
  for (const link of phrases) {
    const i = rest.toLowerCase().indexOf(link.heard.toLowerCase())
    if (i === -1) continue
    const focused = focusRef === link.reference
    parts.push(rest.slice(0, i))
    parts.push(
      <span key={link.id}>
        <mark
          className={`text-fg underline decoration-2 underline-offset-[3px]
            ${focused ? 'bg-accent/20 decoration-accent' : 'bg-transparent decoration-accent/70'}`}
        >
          {rest.slice(i, i + link.heard.length)}
        </mark>
        {/* The tag only adds information when the words differ from the reference. */}
        {link.heard.toLowerCase() !== link.reference.toLowerCase() && <RefTag link={link} focused={focused} />}
      </span>
    )
    rest = rest.slice(i + link.heard.length)
  }
  parts.push(rest)
  return parts
}

export default function TranscriptPanel({
  segments, links = [], focusRef, isListening, isAnalyzing, onClear,
}) {
  const bottomRef = useRef(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' })
  }, [segments])

  const wordCount = segments.reduce((n, s) => n + s.text.split(/\s+/).length, 0)
  const lineLinks = linkLines(segments, links)
  const t0 = segments[0]?.at ?? 0

  return (
    <Panel
      title="Transcript"
      className="w-[340px] shrink-0"
      actions={segments.length > 0 && <PanelAction onClick={onClear} title="Clear transcript">Clear</PanelAction>}
      footer={<>
        <span className="font-mono">{wordCount} words</span>
        {isAnalyzing && <span className="text-fg-2">LM Studio is reading the last passage</span>}
      </>}
    >
      {segments.length === 0 ? (
        <div className="px-8 py-16 flex flex-col items-center text-center text-fg-3 gap-2">
          {isListening
            ? <p>Listening. Waiting for speech.</p>
            : <>
                <p className="text-fg-2">The transcript appears here once you start listening.</p>
                <p>
                  Press <kbd className="font-mono text-fg-2 px-1 border border-line rounded-sm">Ctrl L</kbd> or click Listen.
                </p>
              </>}
        </div>
      ) : (
        <ol className="py-2">
          {segments.map(seg => {
            const { phrases, inWindow, tags } = lineLinks.get(seg.id)
            const linked = phrases.length > 0 || inWindow.length > 0
            const focused = [...phrases, ...inWindow].some(l => l.reference === focusRef)
            return (
              <li key={seg.id} className="segment-enter grid grid-cols-[44px_1fr] pr-4">
                <span className="pt-[3px] pl-4 font-mono text-[11px] text-fg-3 select-none">
                  {clock(seg.at - t0)}
                </span>
                <p
                  className={`py-1 pl-3 border-l-2 leading-relaxed text-[14px]
                    ${inWindow.length ? (focused ? 'border-accent bg-accent/10' : 'border-accent/50') : 'border-transparent'}
                    ${linked ? 'text-fg' : 'text-fg-2'}`}
                >
                  <LineText text={seg.text} phrases={phrases} focusRef={focusRef} />
                  {tags.map(link => <RefTag key={link.id} link={link} focused={focusRef === link.reference} />)}
                </p>
              </li>
            )
          })}
          {isListening && (
            <li className="grid grid-cols-[44px_1fr] pr-4" aria-hidden="true">
              <span />
              <span className="pl-3.5 py-1"><span className="caret inline-block w-[7px] h-[15px] bg-fg-3 align-middle" /></span>
            </li>
          )}
        </ol>
      )}
      <div ref={bottomRef} />
    </Panel>
  )
}
