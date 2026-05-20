#!/usr/bin/env node
/**
 * setup-bible-db.js: builds the local KJV database.
 *
 * Downloads the public-domain KJV CSV from scrollmapper/bible_databases and
 * writes a SQLite file (31,102 verses) to bible-data/kjv.db using sql.js.
 *
 * Run once:  npm run setup-bible
 */

const { join } = require('path')
const { writeFileSync, mkdirSync } = require('fs')

const KJV_URL =
  'https://raw.githubusercontent.com/scrollmapper/bible_databases/master/formats/csv/KJV.csv'

const BOOK_NAMES = [
  '',           // 0 padding
  'Genesis','Exodus','Leviticus','Numbers','Deuteronomy',
  'Joshua','Judges','Ruth','1 Samuel','2 Samuel',
  '1 Kings','2 Kings','1 Chronicles','2 Chronicles','Ezra',
  'Nehemiah','Esther','Job','Psalms','Proverbs',
  'Ecclesiastes','Song of Solomon','Isaiah','Jeremiah','Lamentations',
  'Ezekiel','Daniel','Hosea','Joel','Amos',
  'Obadiah','Jonah','Micah','Nahum','Habakkuk',
  'Zephaniah','Haggai','Zechariah','Malachi',
  'Matthew','Mark','Luke','John','Acts','Romans',
  '1 Corinthians','2 Corinthians','Galatians','Ephesians','Philippians',
  'Colossians','1 Thessalonians','2 Thessalonians','1 Timothy','2 Timothy',
  'Titus','Philemon','Hebrews','James','1 Peter',
  '2 Peter','1 John','2 John','3 John','Jude','Revelation',
]

// Build reverse map: book name -> id
const BOOK_ID = {}
BOOK_NAMES.forEach((name, i) => { if (name) BOOK_ID[name.toLowerCase()] = i })

// The scrollmapper CSV uses Roman numerals and long Revelation title, so add aliases
const CSV_ALIASES = {
  'i samuel': '1 samuel',     'ii samuel': '2 samuel',
  'i kings': '1 kings',       'ii kings': '2 kings',
  'i chronicles': '1 chronicles', 'ii chronicles': '2 chronicles',
  'i corinthians': '1 corinthians', 'ii corinthians': '2 corinthians',
  'i thessalonians': '1 thessalonians', 'ii thessalonians': '2 thessalonians',
  'i timothy': '1 timothy',   'ii timothy': '2 timothy',
  'i peter': '1 peter',       'ii peter': '2 peter',
  'i john': '1 john',         'ii john': '2 john',
  'iii john': '3 john',       'revelation of john': 'revelation',
}
for (const [alias, canonical] of Object.entries(CSV_ALIASES)) {
  if (BOOK_ID[canonical] !== undefined) BOOK_ID[alias] = BOOK_ID[canonical]
}

// RFC 4180 CSV parser that handles multi-line quoted fields
// Returns array of rows (each row is an array of field strings)
function parseCsv(text) {
  const rows = []
  let pos = 0
  const len = text.length

  // Skip header line
  while (pos < len && text[pos] !== '\n') pos++
  if (pos < len) pos++ // consume \n

  while (pos < len) {
    const fields = []
    // Parse one row
    while (true) {
      let field = ''
      if (text[pos] === '"') {
        // Quoted field
        pos++ // skip opening "
        while (pos < len) {
          if (text[pos] === '"') {
            if (text[pos + 1] === '"') { field += '"'; pos += 2 } // escaped quote
            else { pos++; break }                                  // closing quote
          } else {
            field += text[pos++]
          }
        }
      } else {
        // Unquoted field: read until comma or newline
        while (pos < len && text[pos] !== ',' && text[pos] !== '\r' && text[pos] !== '\n') {
          field += text[pos++]
        }
      }
      fields.push(field)

      if (pos >= len || text[pos] === '\r' || text[pos] === '\n') {
        if (pos < len && text[pos] === '\r') pos++ // skip \r
        if (pos < len && text[pos] === '\n') pos++ // skip \n
        break // end of row
      }
      pos++ // skip comma, continue to next field
    }
    if (fields.length >= 4 && fields[0]) rows.push(fields)
  }
  return rows
}

async function main() {
  console.log('Downloading KJV Bible data from scrollmapper/bible_databases …')
  console.log(KJV_URL)

  let csvText
  try {
    const res = await fetch(KJV_URL)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    csvText = await res.text()
  } catch (err) {
    console.error('\nFailed to download Bible data:', err.message)
    console.error('Check your internet connection and try again.')
    process.exit(1)
  }

  const rows = parseCsv(csvText)
  console.log(`Parsing ${rows.length} rows …`)

  const initSqlJs = require('sql.js')
  const wasmPath  = require.resolve('sql.js/dist/sql-wasm.wasm')
  const wasmBinary = require('fs').readFileSync(wasmPath)
  const SQL = await initSqlJs({ wasmBinary })
  const db  = new SQL.Database()

  db.run(`
    CREATE TABLE verses (
      book_id   INTEGER NOT NULL,
      book_name TEXT    NOT NULL,
      chapter   INTEGER NOT NULL,
      verse     INTEGER NOT NULL,
      text      TEXT    NOT NULL,
      translation TEXT  NOT NULL DEFAULT 'KJV'
    );
    CREATE INDEX idx_ref ON verses (book_name, chapter, verse);
  `)

  const stmt = db.prepare(
    'INSERT INTO verses VALUES (?,?,?,?,?,?)'
  )

  let count = 0
  for (const [bookName, chapter, verse, text] of rows) {
    const bookId = BOOK_ID[bookName?.toLowerCase()]
    if (!bookId || !text) continue
    stmt.run([bookId, BOOK_NAMES[bookId], parseInt(chapter), parseInt(verse), text, 'KJV'])
    count++
  }
  stmt.free()

  console.log(`Inserted ${count} verses.`)

  const outDir = join(__dirname, '..', 'bible-data')
  mkdirSync(outDir, { recursive: true })
  const outPath = join(outDir, 'kjv.db')

  const dbBuffer = Buffer.from(db.export())
  writeFileSync(outPath, dbBuffer)
  db.close()

  console.log(`\n✓ Bible database saved to: ${outPath}`)
  console.log('  Size:', (dbBuffer.length / 1024 / 1024).toFixed(1), 'MB')
}

main()
