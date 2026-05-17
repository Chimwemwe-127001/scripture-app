/**
 * bibleDb.js — Bible verse lookup using a sql.js SQLite database.
 * Loaded lazily on first query.
 */

const { join }       = require('path')
const { readFileSync, existsSync } = require('fs')

let _db   = null
let _SQL  = null

// ---------------------------------------------------------------------------
// Book name normalisation: handles LLM variations → canonical name in DB
// ---------------------------------------------------------------------------
const ALIASES = {
  'gen':'Genesis','ge':'Genesis','gn':'Genesis',
  'ex':'Exodus','exo':'Exodus',
  'lev':'Leviticus','le':'Leviticus','lv':'Leviticus',
  'num':'Numbers','nu':'Numbers','nm':'Numbers','nb':'Numbers',
  'deu':'Deuteronomy','de':'Deuteronomy','dt':'Deuteronomy','deut':'Deuteronomy',
  'josh':'Joshua','jos':'Joshua',
  'judg':'Judges','jdg':'Judges','jg':'Judges',
  'ru':'Ruth','rut':'Ruth',
  '1sa':'1 Samuel','1sam':'1 Samuel','1s':'1 Samuel','i samuel':'1 Samuel','i sam':'1 Samuel',
  '2sa':'2 Samuel','2sam':'2 Samuel','2s':'2 Samuel','ii samuel':'2 Samuel','ii sam':'2 Samuel',
  '1ki':'1 Kings','1kg':'1 Kings','1kgs':'1 Kings','i kings':'1 Kings',
  '2ki':'2 Kings','2kg':'2 Kings','2kgs':'2 Kings','ii kings':'2 Kings',
  '1ch':'1 Chronicles','1chr':'1 Chronicles','i chronicles':'1 Chronicles',
  '2ch':'2 Chronicles','2chr':'2 Chronicles','ii chronicles':'2 Chronicles',
  'ezr':'Ezra',
  'neh':'Nehemiah',
  'est':'Esther',
  'jb':'Job',
  'ps':'Psalms','psa':'Psalms','psalm':'Psalms','pss':'Psalms',
  'pro':'Proverbs','pr':'Proverbs','prv':'Proverbs',
  'ec':'Ecclesiastes','ecc':'Ecclesiastes','eccl':'Ecclesiastes','qoh':'Ecclesiastes',
  'so':'Song of Solomon','song':'Song of Solomon','sos':'Song of Solomon','ss':'Song of Solomon','sg':'Song of Solomon',
  'isa':'Isaiah','is':'Isaiah',
  'jer':'Jeremiah',
  'la':'Lamentations','lam':'Lamentations',
  'eze':'Ezekiel','ezek':'Ezekiel',
  'da':'Daniel','dan':'Daniel',
  'ho':'Hosea','hos':'Hosea',
  'am':'Amos',
  'ob':'Obadiah','oba':'Obadiah',
  'jon':'Jonah',
  'mi':'Micah','mic':'Micah',
  'na':'Nahum','nah':'Nahum',
  'hab':'Habakkuk',
  'zep':'Zephaniah','zeph':'Zephaniah',
  'hag':'Haggai','hg':'Haggai',
  'zec':'Zechariah','zech':'Zechariah',
  'mal':'Malachi',
  'mt':'Matthew','mat':'Matthew','matt':'Matthew',
  'mk':'Mark','mr':'Mark',
  'lu':'Luke','lk':'Luke',
  'jn':'John','joh':'John',
  'ac':'Acts',
  'ro':'Romans','rom':'Romans',
  '1co':'1 Corinthians','1cor':'1 Corinthians','i corinthians':'1 Corinthians',
  '2co':'2 Corinthians','2cor':'2 Corinthians','ii corinthians':'2 Corinthians',
  'ga':'Galatians','gal':'Galatians',
  'eph':'Ephesians',
  'php':'Philippians','phi':'Philippians','phil':'Philippians',
  'col':'Colossians',
  '1th':'1 Thessalonians','1thes':'1 Thessalonians','i thessalonians':'1 Thessalonians',
  '2th':'2 Thessalonians','2thes':'2 Thessalonians','ii thessalonians':'2 Thessalonians',
  '1ti':'1 Timothy','1tim':'1 Timothy','i timothy':'1 Timothy',
  '2ti':'2 Timothy','2tim':'2 Timothy','ii timothy':'2 Timothy',
  'ti':'Titus','tit':'Titus',
  'phm':'Philemon','pm':'Philemon',
  'heb':'Hebrews',
  'jas':'James','jm':'James',
  '1pe':'1 Peter','1pet':'1 Peter','i peter':'1 Peter',
  '2pe':'2 Peter','2pet':'2 Peter','ii peter':'2 Peter',
  '1jn':'1 John','1jo':'1 John','i john':'1 John',
  '2jn':'2 John','2jo':'2 John','ii john':'2 John',
  '3jn':'3 John','3jo':'3 John','iii john':'3 John',
  'jud':'Jude','jude':'Jude',
  're':'Revelation','rev':'Revelation','the revelation':'Revelation',
}

function normaliseBook(raw) {
  if (!raw) return null
  const lower = raw.trim().toLowerCase().replace(/\.$/, '')
  if (ALIASES[lower]) return ALIASES[lower]
  // Try capitalised match against full canonical names
  const cap = raw.trim().replace(/^\w/, c => c.toUpperCase())
  return cap
}

// ---------------------------------------------------------------------------
// Initialise DB
// ---------------------------------------------------------------------------
function getDbPath() {
  return join(__dirname, '../../bible-data/kjv.db')
}

async function initDb() {
  if (_db) return _db

  const dbPath = getDbPath()
  if (!existsSync(dbPath)) {
    return null
  }

  if (!_SQL) {
    const initSqlJs = require('sql.js')
    const wasmPath  = require.resolve('sql.js/dist/sql-wasm.wasm')
    const wasmBinary = readFileSync(wasmPath)
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
  if (!db) return null

  const bookName  = normaliseBook(ref.book || ref.reference?.split(/[\s\d]/)[0])
  const chapter   = parseInt(ref.chapter)
  const vStart    = parseInt(ref.verse_start)
  const vEnd      = ref.verse_end ? parseInt(ref.verse_end) : vStart

  if (!bookName || isNaN(chapter) || isNaN(vStart)) return null

  try {
    const stmt = db.prepare(
      `SELECT verse, text FROM verses
       WHERE book_name = ? AND chapter = ? AND verse >= ? AND verse <= ?
       ORDER BY verse`
    )
    stmt.bind([bookName, chapter, vStart, vEnd])

    const lines = []
    while (stmt.step()) {
      const row = stmt.getAsObject()
      lines.push(row.text)
    }
    stmt.free()

    if (lines.length === 0) return null

    const verseRange = vEnd > vStart ? `${vStart}-${vEnd}` : `${vStart}`
    const reference  = `${bookName} ${chapter}:${verseRange}`

    return {
      id:          `${bookName}-${chapter}-${vStart}-${Date.now()}`,
      reference,
      book:        bookName,
      chapter,
      verseStart:  vStart,
      verseEnd:    vEnd > vStart ? vEnd : null,
      text:        lines.join(' '),
      confidence:  ref.confidence  || 'medium',
      trigger:     ref.trigger     || 'allusion',
      translation: 'KJV',
    }
  } catch {
    return null
  }
}

module.exports = { lookupVerse, isDbReady }
