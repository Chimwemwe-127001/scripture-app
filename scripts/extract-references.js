#!/usr/bin/env node
/**
 * extract-references.js: runs transcript lines through the real detector.
 *
 * Reads a JSON array of strings on stdin and prints a JSON array of the
 * references that bibleExtractor finds and the KJV database confirms, the
 * same two steps the app takes. Used by scripts/eval_asr.py so transcription
 * quality is also scored by what actually matters: the verses found.
 */

require('./electron-stub')
console.warn = () => {}
console.log = () => {}

const extractor = require('../src/main/bibleExtractor')
const bibleDb   = require('../src/main/bibleDb')

let input = ''
process.stdin.on('data', (d) => { input += d })
process.stdin.on('end', async () => {
  const found = new Set()
  for (const line of JSON.parse(input)) {
    for (const ref of extractor.extract(line)) {
      const card = await bibleDb.lookupVerse(ref)
      if (card) found.add(card.reference)
    }
  }
  process.stdout.write(JSON.stringify([...found]) + '\n')
})
