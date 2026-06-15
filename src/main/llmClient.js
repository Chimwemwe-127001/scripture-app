/**
 * llmClient.js: queries LM Studio's OpenAI-compatible API to find Bible
 * references (including paraphrases and allusions) in a sermon excerpt.
 *
 * LM Studio default endpoint: http://127.0.0.1:1234/v1
 *
 * Notes from testing:
 * - "localhost" costs about 2 s per new connection on Windows (IPv6 is tried
 *   first, then IPv4), so the default is 127.0.0.1.
 * - Requests must name the loaded model ID; the generic "local-model" is rejected.
 * - Mistral 7B's chat template rejects the `system` role, so the instructions
 *   are sent as part of the user message. This works with every model tried.
 */

const log = require('./logger')

const SYSTEM_PROMPT =
  'You are a Bible reference assistant for a church media operator. ' +
  'Find the Bible verses that this sermon excerpt quotes, paraphrases or alludes to. ' +
  'Return ONLY a JSON array of references written as "Book chapter:verse", for example ["John 3:16", "Romans 8:28-29"]. ' +
  'Return [] if there are none. No preamble, no markdown fences, no explanation.'

// The judge's first question. The instructions come first and never change,
// so LM Studio can reuse them from its prompt cache on every line.
const PICK_INSTRUCTIONS =
  'You help a church media team put Bible verses on the screen during a sermon.\n' +
  "Pick a verse ONLY if the preacher's words say the same thing as that verse: a quotation or a close paraphrase of it. " +
  'If he only shares a few words with a verse, or he is greeting, praying, giving instructions or talking generally about God, answer 0. ' +
  'Most sentences in a sermon are not quotations, so 0 is the usual answer.\n\n'

// The judge's second question needs the model to be this sure of "yes".
const CONFIRM_MIN_PROB = 0.9

// Models that should be excluded from chat (non-LLM model types)
const SKIP_KEYWORDS = ['whisper', 'embed', 'nomic', 'tts', 'dall-e']

class LlmClient {
  constructor(endpoint = 'http://127.0.0.1:1234/v1') {
    this.endpoint   = endpoint.replace(/\/$/, '')
    this._modelId   = null   // cached active model ID
    this._lastError = null
  }

  setEndpoint(url) {
    this.endpoint = url.replace(/\/$/, '')
    this._modelId = null   // invalidate cached model
  }

  /**
   * Fetch and cache the first available chat model ID from LM Studio.
   * @returns {Promise<string|null>}
   */
  async _getModelId() {
    if (this._modelId) return this._modelId
    try {
      const res = await fetch(`${this.endpoint}/models`, {
        signal: AbortSignal.timeout(4000),
      })
      if (!res.ok) return null
      const json = await res.json()
      const models = json?.data ?? []
      const chat = models.find(m => !SKIP_KEYWORDS.some(k => m.id.toLowerCase().includes(k)))
      this._modelId = chat?.id ?? null
      if (this._modelId) log.info('llm', 'Using model', { model: this._modelId })
      return this._modelId
    } catch {
      return null
    }
  }

  /**
   * Test whether LM Studio is running by hitting /v1/models.
   * @returns {Promise<{ok:boolean, model:string|null, error:string|null}>}
   */
  async checkStatus() {
    try {
      const res = await fetch(`${this.endpoint}/models`, {
        signal: AbortSignal.timeout(3000),
      })
      if (!res.ok) return { ok: false, model: null, error: `HTTP ${res.status}` }
      const json = await res.json()
      const models = json?.data ?? []
      const chat = models.find(m => !SKIP_KEYWORDS.some(k => m.id.toLowerCase().includes(k)))
      if (chat) this._modelId = chat.id   // keep cache fresh
      return { ok: !!chat, model: chat?.id ?? null, error: chat ? null : 'No chat model loaded' }
    } catch (err) {
      return { ok: false, model: null, error: err.message }
    }
  }

  /**
   * Ask the LLM to identify Bible references in the given sermon chunk.
   * @param {string} text     Current sermon chunk (~8-80 words)
   * @param {string} context  Rolling sermon context (last ~160 words) for disambiguation
   * @returns {Promise<Array>}  Array of reference objects (may be empty)
   */
  async queryScriptures(text, context = '') {
    if (!text?.trim()) return []

    const modelId = await this._getModelId()
    if (!modelId) {
      // LM Studio is optional. When it is not running, or has no chat model
      // loaded, the status chip already says so; reporting it as an error on
      // every chunk would only bury real problems.
      this._lastError = null
      return []
    }

    // Use a two-section prompt when there is meaningful earlier context (40+
    // words beyond the chunk). The context is for disambiguation only, and the
    // prompt says so, so the model does not return references from older text.
    const chunkWordCount   = text.trim().split(/\s+/).length
    const contextWordCount = context.trim() ? context.trim().split(/\s+/).length : 0
    const hasRichContext   = contextWordCount > chunkWordCount + 40

    let userContent
    if (hasRichContext) {
      userContent = (
        `${SYSTEM_PROMPT}\n\n` +
        `Recent sermon context (use ONLY to disambiguate; do NOT return references that are ` +
        `not directly supported by the Latest Segment below):\n${context.trim()}\n\n` +
        `Latest segment (identify Bible references here):\n${text.trim()}`
      )
    } else {
      userContent = `${SYSTEM_PROMPT}\n\nSermon excerpt:\n${text.trim()}`
    }

    const MAX_RETRIES = 1
    const RETRY_DELAY_MS = 2000

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      if (attempt > 0) {
        await new Promise(r => setTimeout(r, RETRY_DELAY_MS))
        log.warn('llm', 'Retrying request', { attempt, maxRetries: MAX_RETRIES })
      }

      let res
      try {
        res = await fetch(`${this.endpoint}/chat/completions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model:       modelId,
            messages:    [{ role: 'user', content: userContent }],
            temperature: 0.1,
            // Bare references are about 6 tokens each. If the model still hits
            // the limit, _parseResponse salvages the complete ones.
            max_tokens:  64,
            stream:      false,
          }),
          signal: AbortSignal.timeout(25000),
        })
      } catch (err) {
        log.error('llm', 'Request failed', { attempt, error: err.message })
        if (attempt === MAX_RETRIES) {
          // LM Studio went away mid-session. Report it once, then forget the
          // model so later chunks take the quiet path above until it is back.
          this._lastError = err.message
          this._modelId = null
          return []
        }
        continue
      }

      if (!res.ok) {
        let errBody = ''
        try { errBody = await res.text() } catch { /* ignore */ }
        log.error('llm', 'HTTP error', { attempt, status: res.status, body: errBody.slice(0, 200) })
        // The model ID may be stale (model switched in LM Studio), so refetch it next time.
        if (res.status === 400) this._modelId = null
        if (attempt === MAX_RETRIES) { this._lastError = `HTTP ${res.status}`; return [] }
        continue
      }

      let json
      try { json = await res.json() }
      catch (err) {
        log.error('llm', 'Response was not JSON', { error: err.message })
        this._lastError = 'Bad JSON from LM Studio'
        return []
      }

      if (json?.error) {
        const msg = typeof json.error === 'string' ? json.error : JSON.stringify(json.error)
        log.error('llm', 'Model error', { attempt, error: msg })
        if (attempt === MAX_RETRIES) { this._lastError = `LM Studio: ${msg}`; return [] }
        continue
      }

      this._lastError = null
      const raw = json?.choices?.[0]?.message?.content ?? ''
      return this._parseResponse(raw)
    }

    return []
  }

  getLastError() {
    return this._lastError ?? null
  }

  /**
   * The LLM as a judge, not a memory: given what the preacher said and the
   * verses that search found, which one (if any) is he quoting or
   * paraphrasing? It can only choose from real KJV text, so it cannot invent
   * a reference. Two short questions, each answered in one token:
   *   1. pick: the number of a verse, or 0 for none
   *   2. confirm: does the line carry that verse's message? (confirmVerse)
   * The second question removes picks that only share a few words: "God is
   * good all the time" is not 1 Timothy 4:4. Measured with
   * scripts/evaluate-paraphrase.js.
   *
   * @param {string} line        what was said
   * @param {Array<{reference, text}>} candidates  from verseSearch, best first
   * @returns {Promise<object|null>} the chosen candidate, or null
   */
  async pickVerse(line, candidates) {
    if (!line?.trim() || !candidates?.length) return null
    const list = candidates.map((c, i) => `${i + 1}. ${c.reference}: ${c.text.trim()}`).join('\n')
    const answer = await this._ask(
      `${PICK_INSTRUCTIONS}Preacher: "${line.trim()}"\n\n0. None of these\n${list}\n\nReply with one digit only.`
    )
    const n = parseChoice(answer?.text, candidates.length)
    if (!n) return null
    const pick = candidates[n - 1]
    return (await this.confirmVerse(line, pick)) ? pick : null
  }

  /**
   * Does what was said carry the message of this verse? The model sees the
   * verse text, so this also checks references it named from memory.
   * @param {string} line
   * @param {{reference, text}} verse
   * @returns {Promise<boolean>}
   */
  async confirmVerse(line, verse) {
    if (!line?.trim() || !verse?.text) return false
    const answer = await this._ask(
      `Is the preacher quoting or paraphrasing ${verse.reference}?\n\n` +
      `Preacher: "${line.trim()}"\n${verse.reference}: "${verse.text.trim()}"\n\n` +
      `Say yes only if his words carry the main message of the verse, not just a few of its words or a similar topic. ` +
      `Answer yes or no.`
    )
    return isConfirmed(answer)
  }

  /**
   * One short question to the model. Returns the reply and the probability of
   * each candidate first token, or null when LM Studio is unavailable.
   * @returns {Promise<{text:string, probs:Object<string,number>}|null>}
   */
  async _ask(prompt) {
    const modelId = await this._getModelId()
    if (!modelId) return null   // LM Studio is optional; search alone still works
    try {
      const res = await fetch(`${this.endpoint}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: modelId,
          messages: [{ role: 'user', content: prompt }],
          temperature: 0,
          max_tokens: 2,
          logprobs: true,
          top_logprobs: 5,
          stream: false,
        }),
        signal: AbortSignal.timeout(4000),
      })
      if (!res.ok) {
        if (res.status === 400) this._modelId = null   // model switched in LM Studio
        return null
      }
      const json = await res.json()
      const choice = json?.choices?.[0]
      const probs = {}
      for (const t of choice?.logprobs?.content?.[0]?.top_logprobs ?? []) {
        const token = t.token.trim().toLowerCase()
        probs[token] = (probs[token] ?? 0) + Math.exp(t.logprob)
      }
      return { text: choice?.message?.content ?? '', probs }
    } catch (err) {
      log.warn('llm', 'Judge request failed', { error: err.message })
      return null
    }
  }

  /**
   * Parse the model output into reference objects.
   * Strips markdown fences and any text around the JSON array.
   */
  _parseResponse(raw) {
    if (!raw) return []

    let text = raw.trim()
    text = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()

    const start = text.indexOf('[')
    if (start === -1) return []

    const end = text.lastIndexOf(']')

    // Normal case: a complete, well-formed array of "Book C:V" strings (or of
    // objects, which some models still write).
    if (end > start) {
      try {
        const arr = JSON.parse(text.slice(start, end + 1))
        if (Array.isArray(arr)) {
          return arr
            .map(r => (typeof r === 'string' ? parseReference(r) : r))
            .filter(r => r && r.reference && r.book)
        }
      } catch {
        // Fall through to salvage. A malformed tail should not discard the
        // references that are complete before it.
      }
    }

    if (text.includes('{')) return this._salvageObjects(text.slice(start))
    // A cut-off array of strings: keep every complete "Book C:V".
    return (text.slice(start).match(/"[^"]+"(?=\s*[,\]])/g) || [])
      .map(q => parseReference(q.slice(1, -1)))
      .filter(Boolean)
  }

  /**
   * Recover whole `{...}` objects from a truncated or malformed array.
   *
   * If the model hits the token limit mid-object, the array is cut off and
   * JSON.parse fails. This walks the string and keeps every balanced object
   * it finds, ignoring the incomplete tail.
   */
  _salvageObjects(text) {
    const out = []
    let depth = 0
    let objStart = -1
    let inString = false
    let escaped = false

    for (let i = 0; i < text.length; i++) {
      const ch = text[i]

      if (inString) {
        if (escaped) escaped = false
        else if (ch === '\\') escaped = true
        else if (ch === '"') inString = false
        continue
      }

      if (ch === '"') { inString = true; continue }

      if (ch === '{') {
        if (depth === 0) objStart = i
        depth++
      } else if (ch === '}') {
        depth--
        if (depth === 0 && objStart !== -1) {
          try {
            const obj = JSON.parse(text.slice(objStart, i + 1))
            if (obj && obj.reference && obj.book) out.push(obj)
          } catch { /* skip this object */ }
          objStart = -1
        } else if (depth < 0) {
          depth = 0
        }
      }
    }

    if (out.length > 0) {
      log.warn('llm', 'Salvaged references from a malformed response', { count: out.length })
    } else {
      log.error('llm', 'Unparseable response', { text: text.slice(0, 200) })
    }
    return out
  }
}

/** "Romans 8:28-29" to a reference object, or null if it is not one. */
function parseReference(str) {
  const m = String(str).trim().match(/^((?:[1-3]\s*)?[A-Za-z][A-Za-z ]*?)\s+(\d+)\s*:\s*(\d+)(?:\s*[-\u2013]\s*(\d+))?$/)
  if (!m) return null
  const [, book, chapter, start, end] = m
  return {
    reference:   `${book} ${chapter}:${start}${end ? `-${end}` : ''}`,
    book,
    chapter:     Number(chapter),
    verse_start: Number(start),
    verse_end:   end ? Number(end) : null,
    confidence:  'medium',
    trigger:     'allusion',
  }
}

/** The judge's pick: "2" -> 2. Null for 0, out of range, or no number. */
function parseChoice(text, count) {
  const n = parseInt((String(text ?? '').match(/\d+/) || [])[0], 10)
  return n >= 1 && n <= count ? n : null
}

/**
 * A confident "yes". Uses the token probabilities when the server returns
 * them, and the reply text when it does not.
 */
function isConfirmed(answer) {
  if (!answer || !/^\s*yes/i.test(answer.text)) return false
  const p = answer.probs?.yes
  return p === undefined ? true : p >= CONFIRM_MIN_PROB
}

const client = new LlmClient()
module.exports = client
module.exports.parseChoice = parseChoice
module.exports.isConfirmed = isConfirmed
module.exports.parseReference = parseReference
