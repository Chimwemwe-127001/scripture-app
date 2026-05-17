/**
 * llmClient.js — Queries LM Studio's OpenAI-compatible API to extract
 * Bible references from a sermon excerpt.
 *
 * LM Studio default endpoint: http://localhost:1234/v1
 */

const SYSTEM_PROMPT = `You are a Bible reference assistant for a church media operator.
Analyse the following sermon excerpt and identify Bible verses that are being directly quoted, paraphrased, or alluded to.

Return ONLY a valid JSON array. Each item must have exactly these fields:
{"reference":"John 3:16","book":"John","chapter":3,"verse_start":16,"verse_end":null,"confidence":"high","trigger":"explicit"}

Rules:
- "reference" is the standard Bible citation string (e.g. "Romans 8:28", "Psalm 23:1-4")
- "confidence": "high" (direct quote), "medium" (clear paraphrase), "low" (possible allusion)
- "trigger": "explicit" (named or quoted), "paraphrase" (rewording), "allusion" (theme/idea)
- "verse_end" is null for single verses, an integer for a range
- Return [] if no references are found
- No preamble, no markdown fences, no explanation — raw JSON array only`

class LlmClient {
  constructor(endpoint = 'http://localhost:1234/v1') {
    this.endpoint = endpoint.replace(/\/$/, '')
  }

  setEndpoint(url) {
    this.endpoint = url.replace(/\/$/, '')
    _dbg = null  // reset cached status
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
      const model = json?.data?.[0]?.id ?? null
      return { ok: true, model, error: null }
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

    let res
    try {
      res = await fetch(`${this.endpoint}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'local-model',   // LM Studio requires this field; uses whatever is loaded
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user',   content: text.trim() },
          ],
          temperature: 0.1,
          max_tokens: 512,
          stream: false,
        }),
        signal: AbortSignal.timeout(20000),
      })
    } catch (err) {
      console.error('[LLM] fetch error:', err.message)
      return []
    }

    if (!res.ok) {
      console.error('[LLM] HTTP error:', res.status)
      return []
    }

    let json
    try {
      json = await res.json()
    } catch (err) {
      console.error('[LLM] JSON parse error:', err.message)
      return []
    }

    const raw = json?.choices?.[0]?.message?.content ?? ''
    return this._parseResponse(raw)
  }

  // -------------------------------------------------------------------------
  // Parse LLM output, stripping any stray markdown fences
  // -------------------------------------------------------------------------
  _parseResponse(raw) {
    if (!raw) return []

    // Strip ```json ... ``` or ``` ... ``` fences
    let text = raw.trim()
    text = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()

    // Find the JSON array bounds
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
