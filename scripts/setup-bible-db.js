#!/usr/bin/env node
/**
 * setup-bible-db.js
 * Downloads the KJV Bible JSON from scrollmapper/bible_databases and
 * creates a sql.js SQLite binary at bible-data/kjv.db
 *
 * Run once:  node scripts/setup-bible-db.js
 */

const { join } = require('path')
const { writeFileSync, mkdirSync } = require('fs')

const KJV_URL =
  'https://raw.githubusercontent.com/scrollmapper/bible_databases/master/json/t_kjv.json'

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

async function main() {
  console.log('Downloading KJV Bible data from scrollmapper/bible_databases …')
  console.log(KJV_URL)

  let data
  try {
    const res = await fetch(KJV_URL)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    data = await res.json()
  } catch (err) {
    console.error('\nFailed to download Bible data:', err.message)
    console.error('Check your internet connection and try again.')
    process.exit(1)
  }

  const rows = data?.resultset?.row
  if (!rows || !Array.isArray(rows)) {
    console.error('Unexpected JSON format.')
    process.exit(1)
  }

  console.log(`Parsing ${rows.length} verses …`)

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
  for (const row of rows) {
    const [, bookId, chapter, verse, text] = row.field
    const bookName = BOOK_NAMES[bookId]
    if (!bookName) continue
    stmt.run([bookId, bookName, chapter, verse, text, 'KJV'])
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
