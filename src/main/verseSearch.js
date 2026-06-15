/**
 * verseSearch.js: finds the verse a preacher is quoting by searching the KJV
 * text itself, instead of asking a model to remember it.
 *
 * Two steps:
 *   1. BM25 keyword ranking over all 31,102 verses (Robertson and Zaragoza,
 *      2009), on word stems, so spoken English meets KJV English: "knoweth"
 *      meets "know", "thee" meets "you", "labour" meets "labor".
 *   2. The best candidates are re-ranked by the word pairs they share with
 *      what was said, in order. That separates a real quote from a verse that
 *      only shares the same words: "my presence shall go with you" is Exodus
 *      33:14, not 33:15 ("if thy presence go not with me").
 *
 * Word pairs are weighted by how rare their words are, so "and the Lord said"
 * counts for little and "spirit of truth" counts for a lot.
 */

// Old English forms mapped to the modern words a preacher would say.
const ARCHAIC = {
  thee: 'you', thou: 'you', ye: 'you', thy: 'your', thine: 'your',
  hath: 'have', hast: 'have', doth: 'do', dost: 'do', art: 'are', shalt: 'shall',
  wilt: 'will', saith: 'say', spake: 'speak', unto: 'to', hither: 'here',
  whosoever: 'whoever', whatsoever: 'whatever', thereof: 'of', wherefore: 'why',
  begat: 'beget', brethren: 'brother', shew: 'show', shewed: 'showed',
  unrighteous: 'unjust', charity: 'love',
}

// British spellings in the KJV, and spoken contractions.
const SPELLING = {
  labour: 'labor', honour: 'honor', saviour: 'savior', neighbour: 'neighbor',
  favour: 'favor', colour: 'color', behaviour: 'behavior', savour: 'savor',
  harbour: 'harbor', fulness: 'fullness', judgement: 'judgment', won: 'will',
}

// Words that carry almost no meaning on their own (after the maps above).
const STOP = new Set((
  'a an the and or but if of to in on at by for with from as into upon out up down over ' +
  'is are was were be been being am do does did have has had will shall would should can could ' +
  'may might must not no nor so that this these those then than there here which who whom whose ' +
  'what when where why how it its i me my we us our you your he him his she her they them their ' +
  'all also said say one even every let lo behold now yea oh o'
).split(' '))

/** Light stemmer: enough to make "loveth", "loved", "loving" and "love" meet. */
function stem(word) {
  let w = SPELLING[word] || ARCHAIC[word] || word
  for (const suffix of ['eth', 'est', 'ing', 'ed', 'es', 's', 'e']) {
    if (w.length - suffix.length >= 3 && w.endsWith(suffix)) {
      w = w.slice(0, -suffix.length)
      break
    }
  }
  // "setteth" -> "sett" -> "set"
  if (/([b-df-hj-np-tv-z])\1$/.test(w)) w = w.slice(0, -1)
  return w
}

/** Spoken or written text to a sequence of normalised stems. */
function analyse(text) {
  const words = String(text)
    .toLowerCase()
    .replace(/’/g, "'")
    .replace(/n't\b/g, ' not').replace(/'re\b/g, ' are').replace(/'ll\b/g, ' will')
    .replace(/'ve\b/g, ' have').replace(/'m\b/g, ' am').replace(/'s\b/g, '')
    .match(/[a-z]+/g) || []
  return words.map(w => {
    const mapped = SPELLING[w] || ARCHAIC[w] || w
    return { stem: stem(mapped), stop: STOP.has(mapped) }
  })
}

const pairsOf = (tokens) => {
  const out = []
  for (let i = 1; i < tokens.length; i++) out.push(`${tokens[i - 1].stem} ${tokens[i].stem}`)
  return out
}

class VerseSearch {
  /** @param {Array<{book, chapter, verse, text}>} verses */
  constructor(verses) {
    this.verses = verses
    this.content = []                 // per verse: content stems
    this.pairs = []                   // per verse: Set of stem pairs, in order
    this.postings = new Map()         // stem -> [[verseIndex, count]]
    const df = new Map()
    let totalLength = 0

    verses.forEach((v, i) => {
      const tokens = analyse(v.text)
      const content = tokens.filter(t => !t.stop).map(t => t.stem)
      this.content.push(content)
      this.pairs.push(new Set(pairsOf(tokens)))
      totalLength += content.length
      const counts = new Map()
      for (const s of content) counts.set(s, (counts.get(s) || 0) + 1)
      for (const [s, c] of counts) {
        if (!this.postings.has(s)) this.postings.set(s, [])
        this.postings.get(s).push([i, c])
        df.set(s, (df.get(s) || 0) + 1)
      }
    })

    const n = verses.length
    this.avgLength = totalLength / Math.max(1, n)
    this.idf = new Map()
    for (const [s, f] of df) this.idf.set(s, Math.log(1 + (n - f + 0.5) / (f + 0.5)))
  }

  idfOf(s) {
    return this.idf.get(s) ?? Math.log(1 + this.verses.length)
  }

  /**
   * Candidate verses for what was said, best first.
   * Each: { book, chapter, verse, text, reference, score, pairWeight, coverage }
   *   pairWeight  rarity-weighted word pairs shared in order (quote evidence)
   *   coverage    share of what was said (by rarity) that the verse explains
   */
  search(text, k = 5, pool = 40) {
    const tokens = analyse(text)
    const queryContent = [...new Set(tokens.filter(t => !t.stop).map(t => t.stem))]
    if (queryContent.length < 2) return []

    // 1. BM25 over content stems.
    const K1 = 1.2, B = 0.75
    const scores = new Map()
    for (const s of queryContent) {
      const idf = this.idfOf(s)
      for (const [i, c] of this.postings.get(s) || []) {
        const len = this.content[i].length
        const tf = (c * (K1 + 1)) / (c + K1 * (1 - B + (B * len) / this.avgLength))
        scores.set(i, (scores.get(i) || 0) + idf * tf)
      }
    }
    const top = [...scores.entries()].sort((a, b) => b[1] - a[1]).slice(0, pool)

    // 2. Re-rank by shared word pairs in order, weighted by rarity.
    const queryPairs = [...new Set(pairsOf(tokens))]
    const queryMass = queryContent.reduce((sum, s) => sum + this.idfOf(s), 0)
    const ranked = top.map(([i, bm25]) => {
      const versePairs = this.pairs[i]
      let pairWeight = 0
      for (const p of queryPairs) {
        if (!versePairs.has(p)) continue
        const [a, b] = p.split(' ')
        pairWeight += Math.max(STOP.has(a) ? 0 : this.idfOf(a), STOP.has(b) ? 0 : this.idfOf(b))
      }
      const verseStems = new Set(this.content[i])
      const explained = queryContent.filter(s => verseStems.has(s)).reduce((sum, s) => sum + this.idfOf(s), 0)
      const v = this.verses[i]
      return {
        book: v.book, chapter: v.chapter, verse: v.verse, text: v.text,
        reference: `${v.book} ${v.chapter}:${v.verse}`,
        bm25,
        pairWeight,
        coverage: explained / queryMass,
        score: bm25 + 1.5 * pairWeight,
      }
    })
    ranked.sort((a, b) => b.score - a.score)
    return ranked.slice(0, k)
  }
}

/**
 * Is the best candidate clearly a quote of one verse? Strong matches can be
 * shown without asking the LLM. Thresholds are tuned on
 * scripts/eval-paraphrase.json; see scripts/evaluate-paraphrase.js.
 */
function isStrong(candidates, { longQuote = 25, minPairWeight = 12, minCoverage = 0.5, margin = 1.25 } = {}) {
  const [best, next] = candidates
  if (!best) return false
  if (next && best.score < next.score * margin) return false   // must clearly beat the runner-up
  // A long verbatim run is a quote even inside a longer sentence ("Here we
  // need to move quickly. And the Lord said, my presence shall go with you").
  if (best.pairWeight >= longQuote) return true
  // A shorter match must also explain most of what was said.
  return best.pairWeight >= minPairWeight && best.coverage >= minCoverage
}

/**
 * Candidates worth asking the LLM judge about: verses that share at least one
 * distinctive phrase (two words in order) with what was said. A verse that
 * only shares loose words is a topic match, not a quote. On our sermon
 * recording, every false alarm the judge made was a verse like that.
 */
function forJudge(candidates, minPairWeight = 3) {
  return candidates.filter(c => c.pairWeight >= minPairWeight)
}

module.exports = { VerseSearch, isStrong, forJudge, analyse, stem }
