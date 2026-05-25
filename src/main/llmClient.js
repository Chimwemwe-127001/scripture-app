/**
 * llmClient.js: queries LM Studio's OpenAI-compatible API to find Bible
 * references (including paraphrases and allusions) in a sermon excerpt.
 *
 * LM Studio default endpoint: http://localhost:1234/v1
 *
 * Notes from testing:
 * - Requests must name the loaded model ID; the generic "local-model" is rejected.
 * - Mistral 7B's chat template rejects the `system` role, so the instructions
 *   are sent as part of the user message. This works with every model tried.
 */

const log = require('./logger')

const SYSTEM_PROMPT =
  'You are a Bible reference assistant for a church media operator. ' +
  'Analyse the following sermon excerpt and identify Bible verses that are being directly quoted, paraphrased, or alluded to. ' +
  'Return ONLY a valid JSON array. Each item must have exactly these fields: ' +
  '{"reference":"John 3:16","book":"John","chapter":3,"verse_start":16,"verse_end":null,"confidence":"high","trigger":"explicit"} ' +
  'Rules: "confidence" is "high" (direct quote), "medium" (paraphrase), or "low" (allusion). ' +
  '"trigger" is "explicit", "paraphrase", or "allusion". ' +
  '"verse_end" is null for single verses, integer for a range. ' +
  'Return [] if no references are found. No preamble, no markdown fences, no explanation. Raw JSON array only.'

// Models that should be excluded from chat (non-LLM model types)
const SKIP_KEYWORDS = ['whisper', 'embed', 'nomic', 'tts', 'dall-e']

class LlmClient {
  constructor(endpoint = 'http://localhost:1234/v1') {
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
      this._lastError = 'No chat model loaded in LM Studio'
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
            // Room for several references. If the model still hits the limit,
            // _parseResponse salvages the complete objects.
            max_tokens:  256,
            stream:      false,
          }),
          signal: AbortSignal.timeout(25000),
        })
      } catch (err) {
        log.error('llm', 'Request failed', { attempt, error: err.message })
        if (attempt === MAX_RETRIES) { this._lastError = err.message; return [] }
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

    // Normal case: a complete, well-formed array.
    if (end > start) {
      try {
        const arr = JSON.parse(text.slice(start, end + 1))
        if (Array.isArray(arr)) return arr.filter(r => r && r.reference && r.book)
      } catch {
        // Fall through to salvage. A malformed tail should not discard the
        // objects that are complete before it.
      }
    }

    return this._salvageObjects(text.slice(start))
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

const client = new LlmClient()
module.exports = client
