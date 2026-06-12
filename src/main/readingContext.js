/**
 * readingContext.js: remembers which passage the preacher is in.
 *
 * Preachers name a chapter once and then refer to verses on their own:
 * "Turn to John 14. ... start from verse 16 ... and verse 17." Once a book and
 * chapter have been cited, a bare "verse 16" is read as that chapter, and
 * "chapter 5, verse 3" with no book stays in the same book.
 *
 * The passage is forgotten after CONTEXT_TTL_MS without a new citation, so a
 * stray "verse 2" in a song much later does not turn into a card.
 */

const bibleExtractor = require('./bibleExtractor')

const CONTEXT_TTL_MS = 10 * 60 * 1000

const RANGE = String.raw`(?:\s*(?:[-–]|to|through|thru)\s*(\d{1,3})\b)?`
const AND_ONE = String.raw`(?:\s*(?:,|and)\s*(\d{1,3})\b)?`

// "verse 16", "from verse 16", "verses 16 to 18", "verse 13 and 17", "v. 16"
const VERSE_ONLY = new RegExp(String.raw`\b(?:from\s+)?(?:verses?|vv?\.?)\s*(\d{1,3})\b` + RANGE + AND_ONE, 'gi')
// "chapter 5" or "chapter 5, verse 3" with no book in front of it
const CHAPTER_ONLY = new RegExp(
  String.raw`\bchapter\s+(\d{1,3})\b(?:\s*,?\s*(?:verses?|vv?\.?)\s*(\d{1,3})\b` + RANGE + ')?', 'gi')

/** A reference built from the passage in context, shaped like bibleExtractor's. */
function contextRef(book, chapter, start, end, heard, index) {
  const verseStart = parseInt(start, 10)
  const verseEnd = end && parseInt(end, 10) > verseStart ? parseInt(end, 10) : null
  return {
    reference:   `${book} ${chapter}:${verseStart}${verseEnd ? `-${verseEnd}` : ''}`,
    book,
    chapter,
    verse_start: verseStart,
    verse_end:   verseEnd,
    confidence:  'medium',     // inferred, so never as sure as a full citation
    trigger:     'context',
    via:         `${book} ${chapter}`,
    heard:       heard.trim(),
    index,
  }
}

class ReadingContext {
  constructor(ttlMs = CONTEXT_TTL_MS) {
    this.ttlMs = ttlMs
    this.reset()
  }

  reset() {
    this.book = null
    this.chapter = null
    this.at = 0
  }

  /** The passage in context, e.g. "John 14", or null if there is none. */
  current(now = Date.now()) {
    return this.book && now - this.at <= this.ttlMs ? `${this.book} ${this.chapter}` : null
  }

  remember(book, chapter, now = Date.now()) {
    if (!book || !chapter) return
    this.book = book
    this.chapter = chapter
    this.at = now
  }

  /**
   * References in one line of transcript, in the order they were spoken:
   * full citations from bibleExtractor, plus verses that rely on the passage
   * in context. Full citations update the context as they go, so
   * "first John chapter 4, verse 8 and verse 19" gives 4:8 and 4:19.
   */
  process(text, now = Date.now()) {
    if (!text) return []
    const events = []
    const taken = []
    const free = (i) => !taken.some(([a, b]) => i >= a && i < b)

    for (const ref of bibleExtractor.extract(text)) {
      events.push({ index: ref.index, ref })
      taken.push([ref.index, ref.index + ref.heard.length])
    }
    for (const m of text.matchAll(CHAPTER_ONLY)) {
      if (!free(m.index)) continue
      events.push({ index: m.index, chapter: m })
      taken.push([m.index, m.index + m[0].length])
    }
    for (const m of text.matchAll(VERSE_ONLY)) {
      if (free(m.index)) events.push({ index: m.index, verse: m })
    }
    events.sort((a, b) => a.index - b.index)

    const out = []
    for (const e of events) {
      if (e.ref) {
        out.push(e.ref)
        this.remember(e.ref.book, e.ref.chapter, now)
        continue
      }
      if (!this.current(now)) continue

      if (e.chapter) {
        const [heard, chapter, verse, end] = e.chapter
        this.remember(this.book, parseInt(chapter, 10), now)
        if (verse) out.push(contextRef(this.book, this.chapter, verse, end, heard, e.index))
        continue
      }

      const [heard, verse, end, also] = e.verse
      out.push(contextRef(this.book, this.chapter, verse, end, heard, e.index))
      if (also) out.push(contextRef(this.book, this.chapter, also, null, heard, e.index))
      this.at = now   // still reading from this passage
    }
    return out
  }
}

module.exports = { ReadingContext, CONTEXT_TTL_MS }
