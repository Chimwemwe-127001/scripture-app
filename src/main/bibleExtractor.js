/**
 * bibleExtractor.js — Regex-based Bible reference extractor.
 * Catches explicit references from transcript text without needing an LLM.
 * e.g. "John 3:16", "Romans 8:28-30", "First Corinthians 13:4"
 */

// Book names: canonical name, plus common spoken/abbreviated forms
const BOOKS = [
  // Old Testament
  { name: 'Genesis',        abbr: ['gen', 'genesis'] },
  { name: 'Exodus',         abbr: ['ex', 'exod', 'exodus'] },
  { name: 'Leviticus',      abbr: ['lev', 'leviticus'] },
  { name: 'Numbers',        abbr: ['num', 'numbers'] },
  { name: 'Deuteronomy',    abbr: ['deut', 'deu', 'deuteronomy'] },
  { name: 'Joshua',         abbr: ['josh', 'joshua'] },
  { name: 'Judges',         abbr: ['judg', 'judges'] },
  { name: 'Ruth',           abbr: ['ruth'] },
  { name: '1 Samuel',       abbr: ['1sam', '1 sam', 'first samuel', '1samuel'] },
  { name: '2 Samuel',       abbr: ['2sam', '2 sam', 'second samuel', '2samuel'] },
  { name: '1 Kings',        abbr: ['1kgs', '1 kgs', '1kings', '1 kings', 'first kings'] },
  { name: '2 Kings',        abbr: ['2kgs', '2 kgs', '2kings', '2 kings', 'second kings'] },
  { name: '1 Chronicles',   abbr: ['1chr', '1chron', '1 chr', '1chronicles', 'first chronicles'] },
  { name: '2 Chronicles',   abbr: ['2chr', '2chron', '2 chr', '2chronicles', 'second chronicles'] },
  { name: 'Ezra',           abbr: ['ezra'] },
  { name: 'Nehemiah',       abbr: ['neh', 'nehemiah'] },
  { name: 'Esther',         abbr: ['esth', 'esther'] },
  { name: 'Job',            abbr: ['job'] },
  { name: 'Psalms',         abbr: ['ps', 'psa', 'psalm', 'psalms'] },
  { name: 'Proverbs',       abbr: ['prov', 'pro', 'proverbs'] },
  { name: 'Ecclesiastes',   abbr: ['eccl', 'ecc', 'ecclesiastes'] },
  { name: 'Song of Solomon',abbr: ['song', 'sos', 'song of solomon', 'song of songs', 'canticles'] },
  { name: 'Isaiah',         abbr: ['isa', 'isaiah'] },
  { name: 'Jeremiah',       abbr: ['jer', 'jeremiah'] },
  { name: 'Lamentations',   abbr: ['lam', 'lamentations'] },
  { name: 'Ezekiel',        abbr: ['ezek', 'eze', 'ezekiel'] },
  { name: 'Daniel',         abbr: ['dan', 'daniel'] },
  { name: 'Hosea',          abbr: ['hos', 'hosea'] },
  { name: 'Joel',           abbr: ['joel'] },
  { name: 'Amos',           abbr: ['amos'] },
  { name: 'Obadiah',        abbr: ['obad', 'obadiah'] },
  { name: 'Jonah',          abbr: ['jon', 'jonah'] },
  { name: 'Micah',          abbr: ['mic', 'micah'] },
  { name: 'Nahum',          abbr: ['nah', 'nahum'] },
  { name: 'Habakkuk',       abbr: ['hab', 'habakkuk'] },
  { name: 'Zephaniah',      abbr: ['zeph', 'zep', 'zephaniah'] },
  { name: 'Haggai',         abbr: ['hag', 'haggai'] },
  { name: 'Zechariah',      abbr: ['zech', 'zec', 'zechariah'] },
  { name: 'Malachi',        abbr: ['mal', 'malachi'] },
  // New Testament
  { name: 'Matthew',        abbr: ['matt', 'mat', 'matthew'] },
  { name: 'Mark',           abbr: ['mark', 'mrk'] },
  { name: 'Luke',           abbr: ['luke', 'luk'] },
  { name: 'John',           abbr: ['john', 'jn'] },
  { name: 'Acts',           abbr: ['acts', 'act'] },
  { name: 'Romans',         abbr: ['rom', 'romans'] },
  { name: '1 Corinthians',  abbr: ['1cor', '1 cor', '1corinthians', 'first corinthians'] },
  { name: '2 Corinthians',  abbr: ['2cor', '2 cor', '2corinthians', 'second corinthians'] },
  { name: 'Galatians',      abbr: ['gal', 'galatians'] },
  { name: 'Ephesians',      abbr: ['eph', 'ephesians'] },
  { name: 'Philippians',    abbr: ['phil', 'philippians'] },
  { name: 'Colossians',     abbr: ['col', 'colossians'] },
  { name: '1 Thessalonians',abbr: ['1thess', '1 thess', '1thes', 'first thessalonians'] },
  { name: '2 Thessalonians',abbr: ['2thess', '2 thess', '2thes', 'second thessalonians'] },
  { name: '1 Timothy',      abbr: ['1tim', '1 tim', '1timothy', 'first timothy'] },
  { name: '2 Timothy',      abbr: ['2tim', '2 tim', '2timothy', 'second timothy'] },
  { name: 'Titus',          abbr: ['titus', 'tit'] },
  { name: 'Philemon',       abbr: ['phm', 'philemon'] },
  { name: 'Hebrews',        abbr: ['heb', 'hebrews'] },
  { name: 'James',          abbr: ['jas', 'james'] },
  { name: '1 Peter',        abbr: ['1pet', '1 pet', '1peter', 'first peter'] },
  { name: '2 Peter',        abbr: ['2pet', '2 pet', '2peter', 'second peter'] },
  { name: '1 John',         abbr: ['1jn', '1 jn', '1john', 'first john'] },
  { name: '2 John',         abbr: ['2jn', '2 jn', '2john', 'second john'] },
  { name: '3 John',         abbr: ['3jn', '3 jn', '3john', 'third john'] },
  { name: 'Jude',           abbr: ['jude'] },
  { name: 'Revelation',     abbr: ['rev', 'apoc', 'revelation'] },
]

// Build a lookup map: lowercase abbreviation → canonical name
const BOOK_MAP = new Map()
for (const b of BOOKS) {
  for (const a of b.abbr) BOOK_MAP.set(a.toLowerCase(), b.name)
}

// Parse canonical book name into book/chapter fields for bibleDb
function parseBookMeta(canonicalName) {
  const parts = canonicalName.split(' ')
  const book  = canonicalName
  return book
}

/**
 * Extract explicit Bible references from a text string.
 * Returns an array of objects compatible with bibleDb.lookupVerse():
 * { reference, book, chapter, verse_start, verse_end, confidence, trigger }
 */
function extract(text) {
  if (!text) return []

  // Build alternation of all known abbreviations (longest first to avoid partial matches)
  const bookAlts = [...BOOK_MAP.keys()]
    .sort((a, b) => b.length - a.length)
    .map(k => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('|')

  // Pattern: optional spoken prefix (turn to, go to, open to, in, found in, see)
  // then book name, then chapter:verse or "chapter X verse Y" form
  const pattern = new RegExp(
    `(?:^|\\b)` +
    `(${bookAlts})` +
    `\\s+` +
    `(\\d+)` +
    `(?:` +
      `[:\\s]\\s*(\\d+)` +
      `(?:\\s*[-\\u2013]\\s*(\\d+))?` +
    `)?`,
    'gi'
  )

  const results = []
  const seen    = new Set()
  let match

  while ((match = pattern.exec(text)) !== null) {
    const rawBook   = match[1].toLowerCase()
    const canonical = BOOK_MAP.get(rawBook)
    if (!canonical) continue

    const chapter    = parseInt(match[2], 10)
    const verseStart = match[3] ? parseInt(match[3], 10) : null
    const verseEnd   = match[4] ? parseInt(match[4], 10) : null

    if (!chapter) continue

    const reference = verseStart
      ? `${canonical} ${chapter}:${verseStart}${verseEnd ? `-${verseEnd}` : ''}`
      : `${canonical} ${chapter}`

    if (seen.has(reference)) continue
    seen.add(reference)

    results.push({
      reference,
      book:        canonical,
      chapter,
      verse_start: verseStart ?? 1,
      verse_end:   verseEnd ?? null,
      confidence:  'high',
      trigger:     'explicit',
    })
  }

  return results
}

module.exports = { extract }
