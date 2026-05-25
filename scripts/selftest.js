#!/usr/bin/env node
/**
 * selftest.js: regression checks for the detection pipeline.
 *
 * Covers the pure, deterministic parts that carry the most risk: reference
 * extraction, book-name normalisation, verse lookup and LLM response parsing.
 * A bug in any of these is silent in the app: the card simply never appears.
 *
 * Run:  npm test
 * The verse lookup checks need bible-data/kjv.db (npm run setup-bible) and
 * are skipped if it is missing.
 */

require('./electron-stub')

const bookNames = require('../src/main/bookNames')
const extractor = require('../src/main/bibleExtractor')
const bibleDb   = require('../src/main/bibleDb')
const llmClient = require('../src/main/llmClient')

let passed = 0
let failed = 0
const failures = []

function check(name, actual, expected) {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a === e) {
    passed++
  } else {
    failed++
    failures.push(`  ${name}\n      expected ${e}\n      actual   ${a}`)
  }
}

function group(title) {
  console.log(`\n${title}`)
}

// ---------------------------------------------------------------------------
group('Book names: tricky spellings')
// ---------------------------------------------------------------------------
check('1 samuel',           bookNames.normaliseBook('1 samuel'), '1 Samuel')
check('song of solomon',    bookNames.normaliseBook('song of solomon'), 'Song of Solomon')
check('First Corinthians',  bookNames.normaliseBook('First Corinthians'), '1 Corinthians')
check('II Timothy',         bookNames.normaliseBook('II Timothy'), '2 Timothy')
check('2nd timothy',        bookNames.normaliseBook('2nd timothy'), '2 Timothy')
check('third john',         bookNames.normaliseBook('third john'), '3 John')
check('Ps. -> Psalms',      bookNames.normaliseBook('Ps.'), 'Psalms')
check('Song of Songs',      bookNames.normaliseBook('Song of Songs'), 'Song of Solomon')
check('unknown -> null',    bookNames.normaliseBook('Zorblax'), null)
check('all 66 books',       bookNames.CANONICAL.size, 66)

// ---------------------------------------------------------------------------
group('Extraction: references')
// ---------------------------------------------------------------------------
const refs = (s) => extractor.extract(s).map(r => r.reference)
const confs = (s) => extractor.extract(s).map(r => `${r.reference}[${r.confidence}]`)

check('explicit colon',     refs('turn with me to John 3:16'), ['John 3:16'])
check('spoken "verse"',     refs('First Corinthians 13 verse 4'), ['1 Corinthians 13:4'])
check('range',              refs('Romans 8:28-30 says'), ['Romans 8:28-30'])
check('chapter+verse words', refs('second timothy chapter 3 verse 16'), ['2 Timothy 3:16'])
check('numbered book',      refs('go to 1 samuel 17:45'), ['1 Samuel 17:45'])
check('multi-book line',    refs('John 3:16 and Romans 8:28'), ['John 3:16', 'Romans 8:28'])
check('dedupes repeats',    refs('John 3:16 ... John 3:16'), ['John 3:16'])

group('Extraction: ordinary speech must not match')
check('"mark 3 things"',    refs('I want to mark 3 things this morning'), [])
check('"job 12 years"',     refs('he lost his job 12 years ago'), [])
check('"acts 2 church"',    refs('we want to be the acts 2 church'), [])
check('plain numbers',      refs('he was 45 minutes late in 2024'), [])

group('Extraction: confidence levels')
check('colon = high',       confs('John 3:16'), ['John 3:16[high]'])
check('bare space = medium', confs('John 3 16'), ['John 3:16[medium]'])
check('bare chapter = low', confs('open to Romans 8'), ['Romans 8[low]'])
check('inverted range dropped', refs('John 3:16-2'), ['John 3:16'])

// ---------------------------------------------------------------------------
group('LLM response parsing')
// ---------------------------------------------------------------------------
const parse = (s) => llmClient._parseResponse(s).map(r => r.reference)
const OBJ_A = '{"reference":"John 3:16","book":"John","chapter":3,"verse_start":16}'
const OBJ_B = '{"reference":"Romans 8:28","book":"Romans","chapter":8,"verse_start":28}'

check('clean array',        parse(`[${OBJ_A}]`), ['John 3:16'])
check('markdown fenced',    parse('```json\n[' + OBJ_A + ']\n```'), ['John 3:16'])
check('with preamble',      parse(`Sure! [${OBJ_A}] hope that helps`), ['John 3:16'])
check('empty array',        parse('[]'), [])
check('prose only',         parse('I found no references.'), [])
// A response cut off by the token limit still yields its complete objects.
check('truncated salvages', parse(`[${OBJ_A},${OBJ_B},{"reference":"Psalm 23:1","book":"Psal`),
  ['John 3:16', 'Romans 8:28'])

// ---------------------------------------------------------------------------
// DB-backed checks, skipped cleanly if the database has not been built.
// ---------------------------------------------------------------------------
;(async () => {
  if (!bibleDb.isDbReady()) {
    console.log('\nVerse lookup SKIPPED (run `npm run setup-bible` first)')
  } else {
    group('Verse lookup')

    const look = async (ref) => {
      const c = await bibleDb.lookupVerse(ref)
      return c ? c.reference : null
    }

    check('1 samuel resolves',
      await look({ book: '1 samuel', chapter: 17, verse_start: 45 }), '1 Samuel 17:45')
    check('song of solomon resolves',
      await look({ book: 'song of solomon', chapter: 2, verse_start: 1 }), 'Song of Solomon 2:1')
    check('First Corinthians resolves',
      await look({ book: 'First Corinthians', chapter: 13, verse_start: 4 }), '1 Corinthians 13:4')
    check('range preserved',
      await look({ book: 'John', chapter: 3, verse_start: 16, verse_end: 17 }), 'John 3:16-17')
    check('hallucinated range capped at 10',
      await look({ book: 'Psalms', chapter: 119, verse_start: 1, verse_end: 400 }), 'Psalms 119:1-10')
    check('inverted range collapses',
      await look({ book: 'John', chapter: 3, verse_start: 10, verse_end: 2 }), 'John 3:10')
    check('nonexistent chapter -> null',
      await look({ book: 'Jude', chapter: 4, verse_start: 5 }), null)
    check('unknown book -> null',
      await look({ book: 'Zorblax', chapter: 1, verse_start: 1 }), null)

    group('End-to-end: transcript -> extract -> lookup')
    const line = 'turn to first corinthians 13 verse 4 and second timothy 3:16'
    const found = []
    for (const r of extractor.extract(line)) {
      const card = await bibleDb.lookupVerse(r)
      if (card) found.push(card.reference)
    }
    check('both references resolve', found, ['1 Corinthians 13:4', '2 Timothy 3:16'])
  }

  // -------------------------------------------------------------------------
  console.log('\n' + '─'.repeat(52))
  if (failed === 0) {
    console.log(`✓ all ${passed} checks passed`)
    process.exitCode = 0
  } else {
    console.log(`✗ ${failed} failed, ${passed} passed\n`)
    console.log(failures.join('\n\n'))
    process.exitCode = 1
  }
})()
