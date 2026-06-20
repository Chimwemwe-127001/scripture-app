/**
 * translationRequest.js: notices when the preacher asks for a Bible
 * translation ("read it from the NIV", "in the New Living Translation").
 *
 * The app only suggests the switch. The operator presses to change
 * VideoPsalm's Bible, like every other action that reaches the screen.
 */

// Most specific names first, so "New King James" is not read as "King James"
// and "New Revised Standard" is not read as "Revised Standard".
// `cue: true` marks names that are ordinary words too ("the message",
// "passion", "good news"); they count only when followed by "translation",
// "version" or "Bible", or when asked for: "read it in the Message", "give
// me the Good News". Their abbreviations (TPT, GNT, MSG) always count.
const TRANSLATIONS = [
  { code: 'NKJV', names: ['new king james', 'nkjv'] },
  { code: 'KJV',  names: ['king james', 'authorized version', 'kjv'] },
  { code: 'NIV',  names: ['new international version', 'niv'] },
  { code: 'NLT',  names: ['new living translation', 'nlt'] },
  { code: 'NRSV', names: ['new revised standard', 'nrsv'] },
  { code: 'RSV',  names: ['revised standard', 'rsv'] },
  { code: 'ESV',  names: ['english standard version', 'esv'] },
  { code: 'NASB', names: ['new american standard', 'nasb'] },
  { code: 'ASV',  names: ['american standard version', 'asv'] },
  { code: 'AMPC', names: ['amplified classic', 'classic amplified', 'ampc'] },
  { code: 'AMP',  names: ['amplified'] },
  { code: 'NET',  names: ['new english translation'] },
  { code: 'CSB',  names: ['christian standard', 'csb'] },
  { code: 'TLB',  names: ['living bible'] },
  { code: 'GNT',  names: ['good news'], cue: true, abbr: ['gnt', 'gnb'] },
  { code: 'MSG',  names: ['message'], cue: true, abbr: ['msg'] },
  { code: 'TPT',  names: ['passion'], cue: true, abbr: ['tpt'] },
]

const CUE = '(?:translation|version|bible)'
// An ask: "read it in the", "switch to the", "give me the".
const ASK = '(?:(?:read(?:ing)?|switch(?:ing)?|go|turn)(?:\\s+(?:it|that|this|us))?\\s+(?:in|from|to)|give\\s+(?:me|us))\\s+the'

const PATTERNS = TRANSLATIONS.map(t => {
  const names = t.names.join('|')
  const forms = t.cue
    ? [`\\b(?:${names})\\s+${CUE}\\b`, `\\b${ASK}\\s+(?:${names})\\b`, ...(t.abbr || []).map(a => `\\b${a}\\b`)]
    : [`\\b(?:${names})\\b`]
  return { code: t.code, re: new RegExp(forms.join('|'), 'g') }
})

/**
 * Speech to plain lower case. Whisper writes "N.I.V." or "N I V" as often as
 * "NIV", so dots go and runs of single letters are joined.
 */
function normalise(text) {
  return String(text)
    .toLowerCase()
    .replace(/\./g, '')
    .replace(/\b(?:[a-z] ){2,4}[a-z]\b/g, m => m.replace(/ /g, ''))
}

/**
 * Translations named in a line, in spoken order.
 * @param {string} text
 * @returns {Array<{code: string, heard: string}>}
 */
function detectTranslations(text) {
  let s = normalise(text)
  const found = []
  for (const { code, re } of PATTERNS) {
    s = s.replace(re, (match, offset) => {
      found.push({ code, heard: match, offset })
      return ' '.repeat(match.length)   // consumed, so "king james" inside "new king james" does not match again
    })
  }
  return found.sort((a, b) => a.offset - b.offset).map(({ code, heard }) => ({ code, heard }))
}

/**
 * The VideoPsalm Bible button for a translation code. VideoPsalm names some
 * of them its own way ("NIV84", "MSG-Alt").
 * @param {string} code      e.g. 'NIV'
 * @param {string[]} buttons VideoPsalm's favourite Bibles, e.g. ['AMP', 'NIV84']
 * @returns {string|null}
 */
function matchBible(code, buttons) {
  const key = (s) => s.toUpperCase().replace(/[^A-Z0-9]/g, '')
  const want = key(code)
  return buttons.find(b => key(b) === want)
    || buttons.find(b => key(b).startsWith(want) && /^(\d+|ALT)$/.test(key(b).slice(want.length)))
    || null
}

module.exports = { detectTranslations, matchBible, TRANSLATIONS }
