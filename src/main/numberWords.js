/**
 * numberWords.js: spoken numbers to digits, so "Isaiah sixty three verse ten"
 * reads like "Isaiah 63 verse 10".
 *
 * Whisper usually writes digits, but not always, and Parakeet writes words.
 * Chapters run to 150 and verses to 176, so numbers up to the hundreds are
 * enough. Adjacent numbers stay separate when they cannot form one number:
 * "John three sixteen" becomes "John 3 16".
 */

const ONES = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
}
const TEENS = {
  ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15,
  sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
}
const TENS = {
  twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90,
}

const word = (w) => w.toLowerCase()
const isOnes = (w) => word(w) in ONES
const isTeen = (w) => word(w) in TEENS
const isTens = (w) => word(w) in TENS

/**
 * Read one number starting at tokens[i]. Returns { value, next } or null.
 * Handles "sixty three", "twenty-eight", "one hundred and nineteen",
 * "a hundred and five".
 */
function readNumber(tokens, i) {
  let value = null
  let j = i

  const below100 = (k) => {
    const w = tokens[k]
    if (w === undefined) return null
    if (isTeen(w)) return { value: TEENS[word(w)], next: k + 1 }
    if (isTens(w)) {
      const [t, o] = word(w).split('-')            // "twenty-eight"
      if (o && o in ONES) return { value: TENS[t] + ONES[o], next: k + 1 }
      if (tokens[k + 1] && isOnes(tokens[k + 1]) && word(tokens[k + 1]) !== 'zero') {
        return { value: TENS[word(w)] + ONES[word(tokens[k + 1])], next: k + 2 }
      }
      return { value: TENS[word(w)], next: k + 1 }
    }
    if (isOnes(w)) return { value: ONES[word(w)], next: k + 1 }
    const hyphen = /^(\w+)-(\w+)$/.exec(word(w))   // "sixty-three"
    if (hyphen && hyphen[1] in TENS && hyphen[2] in ONES) {
      return { value: TENS[hyphen[1]] + ONES[hyphen[2]], next: k + 1 }
    }
    return null
  }

  // "one hundred ...", "a hundred ..."
  const lead = word(tokens[j] || '')
  if ((lead === 'a' || isOnes(tokens[j] || '')) && word(tokens[j + 1] || '') === 'hundred') {
    value = (lead === 'a' ? 1 : ONES[lead]) * 100
    j += 2
    if (word(tokens[j] || '') === 'and') j += 1
    const rest = below100(j)
    if (rest) return { value: value + rest.value, next: rest.next }
    if (word(tokens[j - 1]) === 'and') j -= 1      // "and" belonged to the sentence
    return { value, next: j }
  }
  return below100(i)
}

/** Replace spoken numbers in text with digits; everything else is kept. */
function wordsToDigits(text) {
  if (!text || !/[a-z]/i.test(text)) return text
  // Split into words and the separators between them, so spacing and
  // punctuation survive the rewrite.
  const parts = String(text).split(/([A-Za-z]+(?:-[A-Za-z]+)?)/)
  const tokens = []      // indexes into parts that are words
  for (let k = 1; k < parts.length; k += 2) tokens.push(k)

  const out = [...parts]
  const words = tokens.map((k) => parts[k])
  let i = 0
  while (i < words.length) {
    const n = readNumber(words, i)
    if (!n) { i += 1; continue }
    // A number may only span words joined by spaces (or "and"), not commas.
    let next = n.next
    for (let k = i; k < next - 1; k++) {
      if (!/^\s+$/.test(parts[tokens[k] + 1])) { next = k + 1; break }
    }
    const value = next === n.next ? n.value : readNumber(words.slice(0, next), i)?.value
    if (value === undefined || value === null) { i += 1; continue }
    out[tokens[i]] = String(value)
    for (let k = i + 1; k < next; k++) { out[tokens[k]] = ''; out[tokens[k] - 1] = '' }
    i = next
  }
  return out.join('').replace(/ {2,}/g, ' ')
}

module.exports = { wordsToDigits }
