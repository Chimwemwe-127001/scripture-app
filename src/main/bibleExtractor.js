/**
 * bibleExtractor.js: regex-based Bible reference extractor.
 *
 * Runs on every transcript segment as the fast path, so explicit references
 * reach the operator without waiting on the chunker or the LLM.
 * e.g. "John 3:16", "Romans 8:28-30", "First Corinthians 13 verse 4"
 *
 * Book names come from the shared bookNames module. See the note there on why
 * the spoken tier leaves out short, ambiguous abbreviations.
 */

const bookNames = require('./bookNames')

// ---------------------------------------------------------------------------
// Pattern, built once at module load.
//
// The book alternation has about 500 entries and extract() runs on every
// transcript segment, so the regex is compiled once rather than per call.
// ---------------------------------------------------------------------------

const BOOK_ALT = bookNames.spokenAlternation()

// Chapter and verse numbers are capped at 3 digits. No book exceeds 150
// chapters, and the cap stops the pattern matching years and phone numbers.
const PATTERN = new RegExp(
  // Book name, at a word boundary
  `\\b(${BOOK_ALT})` +
  // Optional "chapter" filler word, then the chapter number
  `\\s+(?:chapter\\s+)?(\\d{1,3})\\b` +
  // Optionally a verse, introduced by ':' / 'verse' / 'v' / ',' / whitespace...
  `(?:` +
    // A comma may come before "verse", as Whisper writes "15, verse 58", and
    // preachers often say "Mark 12 from verse 28".
    `(?:\\s*(:|,?\\s*(?:from\\s+)?verses?|,?\\s*vv?\\.?|,)\\s*|\\s+` +
    // ...or by '.' or '-' with no spaces, which is how Whisper often writes a
    // spoken "three sixteen" ("John 3.16", "Romans 8-28"). Requiring no spaces
    // keeps a sentence that ends "Romans 8. Then..." from becoming 8:1.
    `|([.\\-\\u2013]))` +
    `(\\d{1,3})\\b` +
    // Optionally a range end
    `(?:\\s*(?:[-\\u2013\\u2014]|through|thru|to)\\s*(\\d{1,3})\\b)?` +
  `)?`,
  'gi'
)

// A separator that positively signals a verse number, as opposed to two
// numbers that merely happen to sit next to each other in speech.
const STRONG_SEPARATOR = /^(?::|verses?|vv?\.?)$/i

/**
 * Extract explicit Bible references from a text string.
 *
 * Returns objects shaped for bibleDb.lookupVerse():
 * { reference, book, chapter, verse_start, verse_end, confidence, trigger, heard }
 * `heard` is the exact text that matched, so the UI can point at it.
 *
 * @param {string} text
 * @returns {Array<object>}
 */
function extract(text) {
  if (!text) return []

  const results = []
  const seen = new Set()

  // Shared regex object with the /g flag, so reset lastIndex first.
  PATTERN.lastIndex = 0

  let match
  while ((match = PATTERN.exec(text)) !== null) {
    const canonical = bookNames.resolveSpoken(match[1])
    if (!canonical) continue

    const chapter = parseInt(match[2], 10)
    if (!chapter || chapter < 1) continue

    const separator  = match[3] || match[4] || ''
    const verseStart = match[5] ? parseInt(match[5], 10) : null
    const verseEnd   = match[6] ? parseInt(match[6], 10) : null

    let confidence
    let isChapterOnly = false

    if (verseStart === null) {
      // Bare chapter reference, e.g. "Romans 8". Shown as verse 1 with low
      // confidence. A book that is also an ordinary English word ("mark 3",
      // "job 12") is far more likely to be plain speech than a citation, so
      // those are dropped.
      if (bookNames.isAmbiguous(canonical)) continue
      confidence = 'low'
      isChapterOnly = true
    } else if (STRONG_SEPARATOR.test(separator.replace(/^[,\s]+/, '').replace(/^from\s+/i, ''))) {
      // "John 3:16" or "John 3 verse 16": unambiguous.
      confidence = 'high'
    } else {
      // "John 3 16", "John 3.16", "Romans 8-28". Whisper often drops or
      // changes the colon, so these are worth showing, but they are a weaker
      // signal than an explicit separator.
      confidence = 'medium'
    }

    // Discard inverted ranges rather than querying for an empty span.
    const safeEnd = verseEnd !== null && verseEnd > verseStart ? verseEnd : null

    const reference = verseStart
      ? `${canonical} ${chapter}:${verseStart}${safeEnd ? `-${safeEnd}` : ''}`
      : `${canonical} ${chapter}`

    if (seen.has(reference)) continue
    seen.add(reference)

    results.push({
      reference,
      book:        canonical,
      chapter,
      verse_start: verseStart ?? 1,
      verse_end:   safeEnd,
      confidence,
      trigger:     'explicit',
      heard:       match[0].trim(),
      index:       match.index,   // where it was said in the line, for readingContext
      isChapterOnly,
    })
  }

  return results
}

module.exports = { extract }
