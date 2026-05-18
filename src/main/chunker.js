/**
 * chunker.js — Rolling word-buffer that fires "chunk" events at regular
 * intervals when enough new sermon text has accumulated.
 *
 * Strategy:
 *   - Every INTERVAL_MS (9 s) fire a chunk if ≥ MIN_WORDS new words exist
 *   - Chunk is at most MAX_WORDS words
 *   - After firing, retain the last OVERLAP_WORDS words as context
 */

const { EventEmitter } = require('events')

const INTERVAL_MS  = 5_000
const MIN_WORDS    = 8
const MAX_WORDS    = 80
const OVERLAP_WORDS = 20

class Chunker extends EventEmitter {
  constructor() {
    super()
    this._words      = []
    this._timer      = null
    this._running    = false
    this._chunkId    = 0
    this._lastFireAt = 0
  }

  /** Feed new transcribed text in */
  addText(text) {
    if (!text?.trim() || !this._running) return
    const newWords = text.trim().split(/\s+/).filter(Boolean)
    this._words.push(...newWords)
  }

  start() {
    if (this._running) return
    this._running    = true
    this._words      = []
    this._chunkId    = 0
    this._lastFireAt = Date.now()
    this._timer      = setInterval(() => this._tick(), INTERVAL_MS)
  }

  stop() {
    this._running = false
    if (this._timer) {
      clearInterval(this._timer)
      this._timer = null
    }
    this._words = []
  }

  /** Force an immediate flush — used when listening stops */
  flush() {
    if (this._words.length >= MIN_WORDS) {
      this._fire()
    }
  }

  // ---------------------------------------------------------------------------

  _tick() {
    if (this._words.length >= MIN_WORDS) {
      this._fire()
    }
  }

  _fire() {
    const fireAt  = Date.now()
    const startAt = this._lastFireAt
    const text    = this._words.slice(0, MAX_WORDS).join(' ')
    this._words   = this._words.slice(
      Math.max(0, Math.min(MAX_WORDS, this._words.length) - OVERLAP_WORDS)
    )
    this._lastFireAt = fireAt
    const chunkId = ++this._chunkId
    this.emit('chunk', { text, chunkId, startAt, fireAt })
  }
}

module.exports = new Chunker()
