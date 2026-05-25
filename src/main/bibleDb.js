/**
 * bibleDb.js: Bible verse lookup from the KJV SQLite database via sql.js.
 * The database is loaded lazily on the first query.
 */

const { join }       = require('path')
const { readFileSync, existsSync } = require('fs')
const { app }        = require('electron')
const bookNames      = require('./bookNames')
const log            = require('./logger')

let _db   = null
let _SQL  = null

/**
 * Hard ceiling on how many verses a single card may span.
 *
 * The LLM sometimes invents a range end ("verse_end": 400), which would put a
 * whole chapter on one card. Longer ranges are truncated rather than rejected,
 * because the opening verses are still the useful part.
 */
const MAX_VERSE_SPAN = 10

// Book names are normalised by ./bookNames.js, shared with the extractor so
// both always agree on spellings such as "1 samuel" or "First Corinthians".

// ---------------------------------------------------------------------------
// Initialise DB
// ---------------------------------------------------------------------------
function getDbPath() {
  if (app.isPackaged) {
    return join(process.resourcesPath, 'bible-data', 'kjv.db')
  }
  return join(__dirname, '..', '..', 'bible-data', 'kjv.db')
}

function getWasmPath() {
  if (app.isPackaged) {
    // sql.js is asarUnpacked so it lands at app.asar.unpacked/node_modules/...
    return join(process.resourcesPath, 'app.asar.unpacked', 'node_modules', 'sql.js', 'dist', 'sql-wasm.wasm')
  }
  return require.resolve('sql.js/dist/sql-wasm.wasm')
}

async function initDb() {
  if (_db) return _db

  const dbPath = getDbPath()
  if (!existsSync(dbPath)) {
    return null
  }

  if (!_SQL) {
    const initSqlJs = require('sql.js')
    const wasmBinary = readFileSync(getWasmPath())
    _SQL = await initSqlJs({ wasmBinary })
  }

  const fileBuffer = readFileSync(dbPath)
  _db = new _SQL.Database(fileBuffer)
  return _db
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Check if the Bible database file is present.
 */
function isDbReady() {
  return existsSync(getDbPath())
}

/**
 * Look up verse text for a reference object returned by the LLM.
 * @param {object} ref  { reference, book, chapter, verse_start, verse_end }
 * @returns {object|null}  Full scripture card, or null if not found.
 */
async function lookupVerse(ref) {
  const db = await initDb()
  if (!db) {
    log.warn('bibleDb', 'Lookup attempted but no database is loaded')
    return null
  }

  const rawBook  = ref.book || ref.reference?.replace(/\d+\s*:.*$/, '').trim()
  const bookName = bookNames.normaliseBook(rawBook)
  const chapter  = parseInt(ref.chapter, 10)
  const vStart   = parseInt(ref.verse_start, 10)

  if (!bookName) {
    // Logged so spellings the alias table does not cover can be added.
    log.warn('bibleDb', 'Unrecognised book name', { raw: rawBook, ref: ref.reference })
    return null
  }
  if (isNaN(chapter) || chapter < 1 || isNaN(vStart) || vStart < 1) {
    log.warn('bibleDb', 'Invalid chapter/verse', { ref: ref.reference, chapter, vStart })
    return null
  }

  // Clamp the range: ignore inverted ends, then cap the span.
  let vEnd = ref.verse_end ? parseInt(ref.verse_end, 10) : vStart
  if (isNaN(vEnd) || vEnd < vStart) vEnd = vStart
  if (vEnd - vStart + 1 > MAX_VERSE_SPAN) {
    log.warn('bibleDb', 'Verse range capped', {
      ref: ref.reference, requested: vEnd, capped: vStart + MAX_VERSE_SPAN - 1,
    })
    vEnd = vStart + MAX_VERSE_SPAN - 1
  }

  try {
    const stmt = db.prepare(
      `SELECT verse, text FROM verses
       WHERE book_name = ? AND chapter = ? AND verse >= ? AND verse <= ?
       ORDER BY verse`
    )
    stmt.bind([bookName, chapter, vStart, vEnd])

    const lines = []
    let lastVerse = vStart
    while (stmt.step()) {
      const row = stmt.getAsObject()
      lines.push(row.text)
      lastVerse = row.verse
    }
    stmt.free()

    if (lines.length === 0) {
      // A valid book with a chapter or verse that does not exist, e.g. an
      // invented "Jude 4:5".
      log.warn('bibleDb', 'Reference not found in database', {
        book: bookName, chapter, vStart, vEnd,
      })
      return null
    }

    // Report the range actually retrieved, not the one requested. Near the
    // end of a chapter the DB may hold fewer verses than asked for.
    const actualEnd  = lines.length > 1 ? lastVerse : vStart
    const verseRange = actualEnd > vStart ? `${vStart}-${actualEnd}` : `${vStart}`
    const reference  = `${bookName} ${chapter}:${verseRange}`

    return {
      id:          `${bookName}-${chapter}-${vStart}-${Date.now()}`,
      reference,
      book:        bookName,
      chapter,
      verseStart:  vStart,
      verseEnd:    actualEnd > vStart ? actualEnd : null,
      text:        lines.join(' '),
      confidence:  ref.confidence  || 'medium',
      trigger:     ref.trigger     || 'allusion',
      translation: 'KJV',
    }
  } catch (err) {
    log.error('bibleDb', 'Lookup threw', { ref: ref.reference, error: err.message })
    return null
  }
}

module.exports = { lookupVerse, isDbReady }
