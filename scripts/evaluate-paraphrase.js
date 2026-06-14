#!/usr/bin/env node
/**
 * evaluate-paraphrase.js: how well each method finds a verse that was quoted
 * or paraphrased without being named, and how fast.
 *
 * Methods:
 *   keyword    verseSearch alone; a card only for strong quotes (no LLM)
 *   search     whether the right verse is anywhere in the top 5 candidates
 *              (the most a judge could find)
 *   llm        the old way: ask the LLM to name verses from memory
 *   judge      strong quotes from keyword search, the rest decided by the LLM
 *              choosing among the top 5 candidates
 *
 * Usage: node scripts/evaluate-paraphrase.js [--methods keyword,search,llm,judge]
 * The llm and judge methods need LM Studio running.
 */

require('./electron-stub')
console.warn = () => {}
const quiet = console.log
console.log = (...a) => { if (!(typeof a[0] === 'string' && /^\d{4}-\d\d-\d\dT/.test(a[0]))) quiet(...a) }

const { performance } = require('perf_hooks')
const bibleDb = require('../src/main/bibleDb')
const { VerseSearch, isStrong } = require('../src/main/verseSearch')
const { items } = require('./eval-paraphrase.json')

const arg = process.argv.indexOf('--methods')
const METHODS = (arg > -1 ? process.argv[arg + 1] : 'keyword,search').split(',')

const pct = (x) => `${(x * 100).toFixed(0)}%`
const ms = (x) => `${x < 10 ? x.toFixed(1) : Math.round(x)} ms`
const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)] ?? 0 }

;(async () => {
  const t0 = performance.now()
  const search = new VerseSearch(await bibleDb.allVerses())
  const buildMs = performance.now() - t0
  if (!search.verses.length) { console.log('Run npm run setup-bible first.'); process.exitCode = 1; return }

  let llm = null
  if (METHODS.some(m => m === 'llm' || m === 'judge')) llm = require('../src/main/llmClient')

  // Each method returns the verses it would put on a card for this line.
  const run = {
    keyword: async (text) => {
      const c = search.search(text)
      return isStrong(c) ? [c[0].reference] : []
    },
    search: async (text) => search.search(text).map(c => c.reference),
    llm: async (text) => (await llm.queryScriptures(text)).map(r => r.reference),
    judge: async (text) => {
      const c = search.search(text)
      if (isStrong(c)) return [c[0].reference]
      const pick = await llm.pickVerse(text, c)
      return pick ? [pick.reference] : []
    },
  }

  console.log(`Paraphrase set: ${items.length} lines (${items.filter(i => i.refs.length).length} with a verse). ` +
    `Index built in ${Math.round(buildMs)} ms.\n`)
  console.log('| Method | Found | Wrong cards | Missed | False alarms on ordinary speech | Median time | Slowest |')
  console.log('|---|---|---|---|---|---|---|')

  const misses = {}
  for (const method of METHODS) {
    let found = 0, wrong = 0, missed = 0, alarms = 0
    const times = []
    misses[method] = []
    for (const item of items) {
      const s = performance.now()
      let out = await run[method](item.text)
      times.push(performance.now() - s)
      if (method !== 'search') out = out.slice(0, 1)          // a card is the first answer only
      const hit = out.some(r => item.refs.includes(normalise(r)))
      if (!item.refs.length) { if (out.length) { alarms++; misses[method].push(`false alarm: "${item.text.slice(0, 50)}" -> ${out[0]}`) } continue }
      if (hit) found++
      else if (out.length && method !== 'search') { wrong++; misses[method].push(`wrong: ${item.refs[0]} -> ${out[0]}`) }
      else { missed++; misses[method].push(`missed: ${item.refs[0]} (${item.category})`) }
    }
    const positives = items.filter(i => i.refs.length).length
    const negatives = items.length - positives
    const label = method === 'search' ? 'search (in top 5)' : method
    console.log(`| ${label} | ${found} of ${positives} (${pct(found / positives)}) | ${wrong} | ${missed} | ` +
      `${method === 'search' ? 'n/a' : `${alarms} of ${negatives}`} | ${ms(median(times))} | ${ms(Math.max(...times))} |`)
  }
  for (const method of METHODS) {
    if (misses[method].length) console.log(`\n${method}:\n  ` + misses[method].join('\n  '))
  }
})()

// The LLM writes "Psalm 23:1"; the database says "Psalms 23:1".
function normalise(ref) {
  return ref.replace(/^Psalm\b/, 'Psalms').replace(/:(\d+)-\d+$/, ':$1')
}
