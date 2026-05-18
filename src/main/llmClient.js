/**
 * llmClient.js — Queries LM Studio's OpenAI-compatible API to extract
 * Bible references from a sermon excerpt.
 *
 * LM Studio default endpoint: http://localhost:1234/v1
 *
 * Key findings from testing:
 * - `local-model` is no longer a valid model ID — must use the actual model ID
 * - Mistral 7B rejects `system` role messages (jinja template limitation)
 * - Fix: fold system prompt into user message; works with all models
 */

const SYSTEM_PROMPT =
  'You are a Bible reference assistant for a church media operator. ' +
  'Analyse the following sermon excerpt and identify Bible verses that are being directly quoted, paraphrased, or alluded to. ' +
  'Return ONLY a valid JSON array. Each item must have exactly these fields: ' +
  '{"reference":"John 3:16","book":"John","chapter":3,"verse_start":16,"verse_end":null,"confidence":"high","trigger":"explicit"} ' +
  'Rules: "confidence" is "high" (direct quote), "medium" (paraphrase), or "low" (allusion). ' +
  '"trigger" is "explicit", "paraphrase", or "allusion". ' +
  '"verse_end" is null for single verses, integer for a range. ' +
  'Return [] if no references are found. No preamble, no markdown fences, no explanation — raw JSON array only.'

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
      if (this._modelId) console.log('[LLM] Using model:', this._modelId)
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
   * @param {string} text  Sermon excerpt (~80 words)
   * @returns {Promise<Array>}  Array of reference objects (may be empty)
   */
  async queryScriptures(text) {
    if (!text?.trim()) return []

    const modelId = await this._getModelId()
    if (!modelId) {
      this._lastError = 'No chat model loaded in LM Studio'
      return []
    }

    // Fold system prompt into user message — works with all models including
    // Mistral which rejects the system role in its jinja template
    const userContent = `${SYSTEM_PROMPT}\n\nSermon excerpt:\n${text.trim()}`

    const MAX_RETRIES = 1
    const RETRY_DELAY_MS = 2000

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      if (attempt > 0) {
        await new Promise(r => setTimeout(r, RETRY_DELAY_MS))
        console.warn(`[LLM] Retrying (attempt ${attempt}/${MAX_RETRIES})…`)
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
            max_tokens:  256,
            stream:      false,
          }),
          signal: AbortSignal.timeout(25000),
        })
      } catch (err) {
        console.error(`[LLM] fetch error (attempt ${attempt}):`, err.message)
        if (attempt === MAX_RETRIES) { this._lastError = err.message; return [] }
        continue
      }

      if (!res.ok) {
        let errBody = ''
        try { errBody = await res.text() } catch { /* ignore */ }
        console.error(`[LLM] HTTP ${res.status} (attempt ${attempt}):`, errBody.slice(0, 200))
        // Model ID may be stale (user switched model in LM Studio) — invalidate
        if (res.status === 400) this._modelId = null
        if (attempt === MAX_RETRIES) { this._lastError = `HTTP ${res.status}`; return [] }
        continue
      }

      let json
      try { json = await res.json() }
      catch (err) {
        console.error('[LLM] JSON parse error:', err.message)
        this._lastError = 'Bad JSON from LM Studio'
        return []
      }

      if (json?.error) {
        const msg = typeof json.error === 'string' ? json.error : JSON.stringify(json.error)
        console.error(`[LLM] model error (attempt ${attempt}):`, msg)
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

  // -------------------------------------------------------------------------
  // Parse LLM output, stripping any stray markdown fences
  // -------------------------------------------------------------------------
  _parseResponse(raw) {
    if (!raw) return []

    let text = raw.trim()
    text = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()

    const start = text.indexOf('[')
    const end   = text.lastIndexOf(']')
    if (start === -1 || end === -1) return []

    try {
      const arr = JSON.parse(text.slice(start, end + 1))
      return Array.isArray(arr) ? arr.filter(r => r.reference && r.book) : []
    } catch (err) {
      console.error('[LLM] response parse error:', err.message, '\nRaw:', text.slice(0, 200))
      return []
    }
  }
}

const client = new LlmClient()
module.exports = client
