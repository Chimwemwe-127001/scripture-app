/**
 * bookNames.js: single source of truth for Bible book names.
 *
 * Used by both the regex extractor and the database lookup, so a spelling
 * such as "1 samuel", "song of solomon" or "First Corinthians" resolves the
 * same way everywhere.
 *
 * There are two alias tiers:
 *
 *   LOOKUP  Broad. Normalises book names the LLM has already said ARE books,
 *           so short forms like "is", "am" or "so" are safe here.
 *
 *   SPOKEN  Conservative. Builds the regex that scans raw transcript text.
 *           Short ambiguous forms are left out because "am 3" or "is 40"
 *           appear constantly in ordinary speech.
 */

// ---------------------------------------------------------------------------
// Canonical book table
// ---------------------------------------------------------------------------
// `num`/`base` mark numbered books so prefix variants can be generated
// mechanically (1/1st/i/first x Samuel/sam/sa x with and without a space)
// rather than hand-listed and inevitably missed.

const BOOKS = [
  // ---- Old Testament ----
  { name: 'Genesis',         spoken: ['gen', 'genesis'],                     lookup: ['ge', 'gn'] },
  { name: 'Exodus',          spoken: ['exo', 'exod', 'exodus'],              lookup: ['ex'] },
  { name: 'Leviticus',       spoken: ['lev', 'leviticus'],                   lookup: ['le', 'lv'] },
  { name: 'Numbers',         spoken: ['num', 'numbers'],                     lookup: ['nu', 'nm', 'nb'] },
  { name: 'Deuteronomy',     spoken: ['deut', 'deu', 'deuteronomy'],         lookup: ['de', 'dt'] },
  { name: 'Joshua',          spoken: ['josh', 'joshua'],                     lookup: ['jos'] },
  { name: 'Judges',          spoken: ['judg', 'judges'],                     lookup: ['jdg', 'jg'] },
  { name: 'Ruth',            spoken: ['ruth'],                               lookup: ['ru', 'rut'] },
  { name: '1 Samuel',  num: 1, base: 'Samuel',       spoken: ['sam', 'samuel'],       lookup: ['sa', 'sm'] },
  { name: '2 Samuel',  num: 2, base: 'Samuel',       spoken: ['sam', 'samuel'],       lookup: ['sa', 'sm'] },
  { name: '1 Kings',   num: 1, base: 'Kings',        spoken: ['kgs', 'kings'],        lookup: ['ki', 'kg'] },
  { name: '2 Kings',   num: 2, base: 'Kings',        spoken: ['kgs', 'kings'],        lookup: ['ki', 'kg'] },
  { name: '1 Chronicles', num: 1, base: 'Chronicles', spoken: ['chr', 'chron', 'chronicles'], lookup: ['ch'] },
  { name: '2 Chronicles', num: 2, base: 'Chronicles', spoken: ['chr', 'chron', 'chronicles'], lookup: ['ch'] },
  { name: 'Ezra',            spoken: ['ezra'],                               lookup: ['ezr'] },
  { name: 'Nehemiah',        spoken: ['neh', 'nehemiah'],                    lookup: [] },
  { name: 'Esther',          spoken: ['esth', 'esther'],                     lookup: ['est'] },
  { name: 'Job',             spoken: ['job'],                                lookup: ['jb'] },
  { name: 'Psalms',          spoken: ['psa', 'psalm', 'psalms'],             lookup: ['ps', 'pss'] },
  { name: 'Proverbs',        spoken: ['prov', 'pro', 'proverbs'],            lookup: ['pr', 'prv'] },
  { name: 'Ecclesiastes',    spoken: ['eccl', 'ecc', 'ecclesiastes'],        lookup: ['ec', 'qoh'] },
  { name: 'Song of Solomon', spoken: ['song', 'sos', 'song of solomon', 'song of songs', 'canticles'], lookup: ['so', 'ss', 'sg'] },
  { name: 'Isaiah',          spoken: ['isa', 'isaiah'],                      lookup: ['is'] },
  { name: 'Jeremiah',        spoken: ['jer', 'jeremiah'],                    lookup: [] },
  { name: 'Lamentations',    spoken: ['lam', 'lamentations'],                lookup: ['la'] },
  { name: 'Ezekiel',         spoken: ['ezek', 'eze', 'ezekiel'],             lookup: [] },
  { name: 'Daniel',          spoken: ['dan', 'daniel'],                      lookup: ['da'] },
  { name: 'Hosea',           spoken: ['hos', 'hosea'],                       lookup: ['ho'] },
  { name: 'Joel',            spoken: ['joel'],                               lookup: [] },
  { name: 'Amos',            spoken: ['amos'],                               lookup: ['am'] },
  { name: 'Obadiah',         spoken: ['obad', 'obadiah'],                    lookup: ['ob', 'oba'] },
  { name: 'Jonah',           spoken: ['jon', 'jonah'],                       lookup: [] },
  { name: 'Micah',           spoken: ['mic', 'micah'],                       lookup: ['mi'] },
  { name: 'Nahum',           spoken: ['nah', 'nahum'],                       lookup: ['na'] },
  { name: 'Habakkuk',        spoken: ['hab', 'habakkuk'],                    lookup: [] },
  { name: 'Zephaniah',       spoken: ['zeph', 'zep', 'zephaniah'],           lookup: [] },
  { name: 'Haggai',          spoken: ['hag', 'haggai'],                      lookup: ['hg'] },
  { name: 'Zechariah',       spoken: ['zech', 'zec', 'zechariah'],           lookup: [] },
  { name: 'Malachi',         spoken: ['mal', 'malachi'],                     lookup: [] },

  // ---- New Testament ----
  { name: 'Matthew',         spoken: ['matt', 'mat', 'matthew'],             lookup: ['mt'] },
  { name: 'Mark',            spoken: ['mark', 'mrk'],                        lookup: ['mk', 'mr'] },
  { name: 'Luke',            spoken: ['luke', 'luk'],                        lookup: ['lu', 'lk'] },
  { name: 'John',            spoken: ['john'],                               lookup: ['jn', 'joh'] },
  { name: 'Acts',            spoken: ['acts'],                               lookup: ['ac', 'act'] },
  { name: 'Romans',          spoken: ['rom', 'romans'],                      lookup: ['ro'] },
  { name: '1 Corinthians', num: 1, base: 'Corinthians', spoken: ['cor', 'corinthians'], lookup: ['co'] },
  { name: '2 Corinthians', num: 2, base: 'Corinthians', spoken: ['cor', 'corinthians'], lookup: ['co'] },
  { name: 'Galatians',       spoken: ['gal', 'galatians'],                   lookup: ['ga'] },
  { name: 'Ephesians',       spoken: ['eph', 'ephesians'],                   lookup: [] },
  { name: 'Philippians',     spoken: ['phil', 'philippians'],                lookup: ['php', 'phi'] },
  { name: 'Colossians',      spoken: ['col', 'colossians'],                  lookup: [] },
  { name: '1 Thessalonians', num: 1, base: 'Thessalonians', spoken: ['thess', 'thes', 'thessalonians'], lookup: ['th'] },
  { name: '2 Thessalonians', num: 2, base: 'Thessalonians', spoken: ['thess', 'thes', 'thessalonians'], lookup: ['th'] },
  { name: '1 Timothy', num: 1, base: 'Timothy', spoken: ['tim', 'timothy'],  lookup: ['ti'] },
  { name: '2 Timothy', num: 2, base: 'Timothy', spoken: ['tim', 'timothy'],  lookup: ['ti'] },
  { name: 'Titus',           spoken: ['titus'],                              lookup: ['tit', 'ti'] },
  { name: 'Philemon',        spoken: ['philem', 'philemon'],                 lookup: ['phm', 'pm'] },
  { name: 'Hebrews',         spoken: ['heb', 'hebrews'],                     lookup: [] },
  { name: 'James',           spoken: ['jas', 'james'],                       lookup: ['jm'] },
  { name: '1 Peter', num: 1, base: 'Peter', spoken: ['pet', 'peter'],        lookup: ['pe'] },
  { name: '2 Peter', num: 2, base: 'Peter', spoken: ['pet', 'peter'],        lookup: ['pe'] },
  { name: '1 John',  num: 1, base: 'John',  spoken: ['john'],                lookup: ['jn', 'jo'] },
  { name: '2 John',  num: 2, base: 'John',  spoken: ['john'],                lookup: ['jn', 'jo'] },
  { name: '3 John',  num: 3, base: 'John',  spoken: ['john'],                lookup: ['jn', 'jo'] },
  { name: 'Jude',            spoken: ['jude'],                               lookup: ['jud'] },
  { name: 'Revelation',      spoken: ['rev', 'revelation', 'apocalypse'],    lookup: ['re', 'apoc', 'the revelation'] },
]

// Number-prefix word forms, e.g. 1 -> "1", "1st", "i", "first"
const NUM_PREFIXES = {
  1: ['1', '1st', 'i', 'first'],
  2: ['2', '2nd', 'ii', 'second'],
  3: ['3', '3rd', 'iii', 'third'],
}

/**
 * Expand one book entry into every alias string that should map to it.
 * For numbered books this is the cross product of prefix, separator and stem.
 */
function expand(book, tier) {
  const stems = new Set([...(book[tier] || [])])
  const out = new Set()

  if (book.num) {
    // Stems for numbered books are unnumbered ("sam", "corinthians"), so the
    // canonical base name has to be folded in too.
    stems.add(book.base.toLowerCase())
    for (const prefix of NUM_PREFIXES[book.num]) {
      for (const stem of stems) {
        // Numeric prefixes work with or without a space ("1sam", "1 sam");
        // word prefixes always need one ("first sam", never "firstsam").
        const isWordPrefix = /[a-z]/.test(prefix)
        out.add(`${prefix} ${stem}`)
        if (!isWordPrefix) out.add(`${prefix}${stem}`)
      }
    }
  } else {
    stems.add(book.name.toLowerCase())
    for (const stem of stems) out.add(stem)
  }

  return [...out]
}

// ---------------------------------------------------------------------------
// Built maps
// ---------------------------------------------------------------------------

/** Broad map for normalising LLM output. alias -> canonical name */
const LOOKUP_MAP = new Map()
/** Conservative map for scanning raw transcript text. alias -> canonical name */
const SPOKEN_MAP = new Map()

for (const book of BOOKS) {
  // The canonical name itself must always resolve, in both tiers.
  LOOKUP_MAP.set(book.name.toLowerCase(), book.name)
  SPOKEN_MAP.set(book.name.toLowerCase(), book.name)

  for (const alias of expand(book, 'spoken')) {
    if (!SPOKEN_MAP.has(alias)) SPOKEN_MAP.set(alias, book.name)
    if (!LOOKUP_MAP.has(alias)) LOOKUP_MAP.set(alias, book.name)
  }
  // Lookup-only aliases are short or ambiguous, so they never go into the transcript regex.
  for (const alias of expand(book, 'lookup')) {
    if (!LOOKUP_MAP.has(alias)) LOOKUP_MAP.set(alias, book.name)
  }
}

const CANONICAL = new Set(BOOKS.map(b => b.name))

/**
 * Book names that are also ordinary English words. A bare chapter reference
 * for one of these ("mark 3", "job 12", "acts 2") is far more likely to be
 * normal speech than a scripture citation, so the extractor requires an
 * explicit verse number before trusting them.
 */
const AMBIGUOUS = new Set(['Mark', 'Job', 'Acts', 'Ruth', 'Luke', 'John', 'Song of Solomon', 'Amos', 'James'])

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Collapse whitespace, lowercase, drop trailing periods and ordinal dots. */
function canonicaliseKey(raw) {
  return String(raw)
    .trim()
    .toLowerCase()
    .replace(/\./g, '')
    .replace(/\s+/g, ' ')
}

/**
 * Normalise any book spelling to the exact canonical name used in the DB.
 *
 * Returns null for anything unrecognised rather than guessing, so the caller
 * can log a clear miss instead of running a SQL query that cannot match.
 *
 * @param {string} raw
 * @returns {string|null} canonical book name, or null if unrecognised
 */
function normaliseBook(raw) {
  if (!raw) return null

  const key = canonicaliseKey(raw)
  if (!key) return null

  const direct = LOOKUP_MAP.get(key)
  if (direct) return direct

  // Tolerate a missing space between number and name ("1samuel" handled above,
  // but also "2ndtimothy" and similar run-together LLM output).
  const spaced = key.replace(/^(\d+(?:st|nd|rd)?)\s*/, '$1 ')
  const viaSpaced = LOOKUP_MAP.get(spaced)
  if (viaSpaced) return viaSpaced

  return null
}

/** True if `name` is exactly a canonical book name. */
function isCanonical(name) {
  return CANONICAL.has(name)
}

/** True if a bare chapter reference to this book should be distrusted. */
function isAmbiguous(name) {
  return AMBIGUOUS.has(name)
}

/**
 * Regex-safe alternation of every spoken alias, longest first so that
 * "1 corinthians" wins over "corinthians" and "song of solomon" over "song".
 */
function spokenAlternation() {
  return [...SPOKEN_MAP.keys()]
    .sort((a, b) => b.length - a.length)
    .map(k => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('|')
}

/** Resolve a spoken-tier alias (used by the transcript extractor). */
function resolveSpoken(alias) {
  return SPOKEN_MAP.get(canonicaliseKey(alias)) || null
}

module.exports = {
  BOOKS,
  CANONICAL,
  normaliseBook,
  isCanonical,
  isAmbiguous,
  spokenAlternation,
  resolveSpoken,
}
