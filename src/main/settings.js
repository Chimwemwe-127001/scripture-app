/**
 * settings.js: persisted operator preferences.
 *
 * Remembers the Whisper model, audio device and LM Studio endpoint between
 * launches, so the operator does not reconfigure before every service. A
 * wrong input device fails silently (nothing transcribes), so this matters.
 *
 * Stored as JSON in userData. Small and dependency-free. Any read or write
 * failure falls back to defaults rather than blocking startup.
 */

const { app } = require('electron')
const { join } = require('path')
const fs = require('fs')
const log = require('./logger')

const DEFAULTS = {
  whisperModel: 'small',
  deviceIndex:  null,
  llmEndpoint:  'http://localhost:1234/v1',
  confidenceFilter: 'all',   // 'all' | 'medium' | 'high'
}

// Only these keys are accepted, so a hand-edited or stale file cannot inject
// arbitrary state into the app.
const ALLOWED = new Set(Object.keys(DEFAULTS))

const VALID_MODELS = new Set(['tiny', 'base', 'small', 'medium', 'large-v3'])
const VALID_FILTERS = new Set(['all', 'medium', 'high'])

let _cache = null

function settingsPath() {
  return join(app.getPath('userData'), 'settings.json')
}

/** Reject values that would break the app if they came back malformed. */
function validate(input) {
  const out = { ...DEFAULTS }
  if (!input || typeof input !== 'object') return out

  for (const [key, value] of Object.entries(input)) {
    if (!ALLOWED.has(key)) continue

    switch (key) {
      case 'whisperModel':
        if (VALID_MODELS.has(value)) out.whisperModel = value
        break
      case 'deviceIndex':
        if (value === null || (Number.isInteger(value) && value >= 0)) out.deviceIndex = value
        break
      case 'llmEndpoint':
        if (typeof value === 'string' && /^https?:\/\//i.test(value)) out.llmEndpoint = value
        break
      case 'confidenceFilter':
        if (VALID_FILTERS.has(value)) out.confidenceFilter = value
        break
    }
  }
  return out
}

function load() {
  if (_cache) return _cache
  try {
    const raw = fs.readFileSync(settingsPath(), 'utf8')
    _cache = validate(JSON.parse(raw))
    log.info('settings', 'Loaded saved settings', _cache)
  } catch (err) {
    if (err.code !== 'ENOENT') {
      log.warn('settings', 'Could not read settings, using defaults', { error: err.message })
    }
    _cache = { ...DEFAULTS }
  }
  return _cache
}

/** Merge a partial update, persist, and return the full resulting settings. */
function save(patch) {
  const merged = validate({ ...load(), ...patch })
  _cache = merged
  try {
    fs.mkdirSync(app.getPath('userData'), { recursive: true })
    fs.writeFileSync(settingsPath(), JSON.stringify(merged, null, 2), 'utf8')
  } catch (err) {
    // Non-fatal: the app still works this session, it just will not remember.
    log.warn('settings', 'Could not persist settings', { error: err.message })
  }
  return merged
}

module.exports = { load, save, DEFAULTS }
