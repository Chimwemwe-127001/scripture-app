#!/usr/bin/env node
/**
 * evaluate.js: measures the regex detection path against a labelled set.
 *
 * Reports standard information-retrieval metrics (precision, recall, F1)
 * at two stages:
 *   1. Extraction  - what bibleExtractor.extract() returns from the text.
 *   2. Validated   - extractions that also resolve in the KJV database,
 *                    which is what actually reaches the operator.
 * It also reports recall per category and the latency of each stage.
 *
 * The LLM path is not measured here because it needs LM Studio running.
 *
 * Run:  npm run eval       (needs bible-data/kjv.db from npm run setup-bible)
 */

require('./electron-stub')

const { performance } = require('perf_hooks')
const extractor = require('../src/main/bibleExtractor')
const bibleDb   = require('../src/main/bibleDb')
const { items } = require('./eval-set.json')

const LATENCY_RUNS = 1000

// The logger warns about every reference that is not in the database. Those
// misses are expected here (they are the negatives), so keep the report clean.
console.warn = () => {}
console.log = ((log) => (...args) => {
  if (typeof args[0] === 'string' && /^\d{4}-\d\d-\d\dT/.test(args[0])) return
  log(...args)
})(console.log)

// ---------------------------------------------------------------------------
// Metrics
// ---------------------------------------------------------------------------

function score(predictedPerItem) {
  let tp = 0, fp = 0, fn = 0
  items.forEach((item, i) => {
    const gold = new Set(item.refs)
    const pred = new Set(predictedPerItem[i])
    for (const r of pred) (gold.has(r) ? tp++ : fp++)
    for (const r of gold) if (!pred.has(r)) fn++
  })
  const precision = tp + fp === 0 ? 1 : tp / (tp + fp)
  const recall    = tp + fn === 0 ? 1 : tp / (tp + fn)
  const f1        = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall)
  return { tp, fp, fn, precision, recall, f1 }
}

function percentile(sorted, p) {
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)
  return sorted[Math.max(0, idx)]
}

function timeIt(fn, runs) {
  const samples = []
  for (let i = 0; i < runs; i++) {
    const t0 = performance.now()
    fn(i)
    samples.push(performance.now() - t0)
  }
  samples.sort((a, b) => a - b)
  return { p50: percentile(samples, 50), p95: percentile(samples, 95) }
}

async function timeItAsync(fn, runs) {
  const samples = []
  for (let i = 0; i < runs; i++) {
    const t0 = performance.now()
    await fn(i)
    samples.push(performance.now() - t0)
  }
  samples.sort((a, b) => a - b)
  return { p50: percentile(samples, 50), p95: percentile(samples, 95) }
}

const pct = (x) => `${(x * 100).toFixed(1)}%`
const us  = (x) => `${(x * 1000).toFixed(1)} µs`

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

;(async () => {
  if (!bibleDb.isDbReady()) {
    console.log('bible-data/kjv.db not found. Run `npm run setup-bible` first.')
    process.exitCode = 1
    return
  }

  // Stage 1: extraction
  const extracted = items.map(item => extractor.extract(item.text))
  const extractedRefs = extracted.map(list => list.map(r => r.reference))

  // Stage 2: keep only extractions that resolve in the database
  const validatedRefs = []
  for (const list of extracted) {
    const kept = []
    for (const ref of list) {
      if (await bibleDb.lookupVerse(ref)) kept.push(ref.reference)
    }
    validatedRefs.push(kept)
  }

  const s1 = score(extractedRefs)
  const s2 = score(validatedRefs)

  const positives = items.filter(it => it.refs.length > 0)
  const negatives = items.filter(it => it.refs.length === 0)
  const negFired = negatives.filter(it => {
    const i = items.indexOf(it)
    return validatedRefs[i].length > 0
  }).length

  console.log(`Evaluation set: ${items.length} utterances ` +
    `(${positives.length} with references, ${negatives.length} without), ` +
    `${positives.reduce((n, it) => n + it.refs.length, 0)} gold references\n`)

  console.log('| Stage | Precision | Recall | F1 | TP | FP | FN |')
  console.log('|---|---|---|---|---|---|---|')
  for (const [name, s] of [['Extraction (regex)', s1], ['Validated (regex + KJV lookup)', s2]]) {
    console.log(`| ${name} | ${pct(s.precision)} | ${pct(s.recall)} | ${pct(s.f1)} | ${s.tp} | ${s.fp} | ${s.fn} |`)
  }
  console.log(`\nFalse alarms on ordinary speech: ${negFired} of ${negatives.length} negative utterances ` +
    `(${pct(negFired / negatives.length)})\n`)

  // Recall per category, after validation
  const categories = [...new Set(positives.map(it => it.category))]
  console.log('| Category | Gold refs | Found | Recall |')
  console.log('|---|---|---|---|')
  for (const cat of categories) {
    let gold = 0, found = 0
    items.forEach((it, i) => {
      if (it.category !== cat) return
      gold += it.refs.length
      found += it.refs.filter(r => validatedRefs[i].includes(r)).length
    })
    console.log(`| ${cat} | ${gold} | ${found} | ${pct(found / gold)} |`)
  }

  // Latency
  const texts = items.map(it => it.text)
  const lookups = extracted.flat()
  await bibleDb.lookupVerse(lookups[0])   // load the database before timing

  const tExtract = timeIt(i => extractor.extract(texts[i % texts.length]), LATENCY_RUNS)
  const tLookup  = await timeItAsync(i => bibleDb.lookupVerse(lookups[i % lookups.length]), LATENCY_RUNS)

  console.log(`\n| Stage (${LATENCY_RUNS} runs) | p50 | p95 |`)
  console.log('|---|---|---|')
  console.log(`| Regex extraction per segment | ${us(tExtract.p50)} | ${us(tExtract.p95)} |`)
  console.log(`| KJV lookup per reference | ${us(tLookup.p50)} | ${us(tLookup.p95)} |`)
})()
