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
  whisperModel: 'auto',   // the worker picks the best model for the GPU, or the CPU
  deviceIndex:  null,
  deviceName:   null,   // the device the index pointed to, since Windows renumbers devices
  llmEndpoint:  'http://127.0.0.1:1234/v1',
  confidenceFilter: 'all',   // 'all' | 'medium' | 'high'
  miniPanel: true,           // the small panel docked to VideoPsalm
  miniCollapsed: false,
  miniOffset: { x: 8, y: 165, w: 360, h: 250 },   // from VideoPsalm's top-left corner, in DIPs
}

// Only these keys are accepted, so a hand-edited or stale file cannot inject
// arbitrary state into the app.
const ALLOWED = new Set(Object.keys(DEFAULTS))

// Models the worker supports. An older saved value (tiny, small, large-v3...)
// is not in this list, so it falls back to 'auto'.
const VALID_MODELS = new Set(['auto', 'distil-large-v3.5', 'large-v3-turbo', 'small.en'])
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
      case 'deviceName':
        if (value === null || (typeof value === 'string' && value.length <= 200)) out.deviceName = value
        break
      case 'llmEndpoint':
        // "localhost" costs about 2 s per new connection on Windows (IPv6 is
        // tried first), so saved values from older versions are rewritten.
        if (typeof value === 'string' && /^https?:\/\//i.test(value)) {
          out.llmEndpoint = value.replace(/^(https?:\/\/)localhost(?=[:/]|$)/i, '$1127.0.0.1')
        }
        break
      case 'confidenceFilter':
        if (VALID_FILTERS.has(value)) out.confidenceFilter = value
        break
      case 'miniPanel':
      case 'miniCollapsed':
        if (typeof value === 'boolean') out[key] = value
        break
      case 'miniOffset': {
        const ok = (n, lo, hi) => Number.isFinite(n) && n >= lo && n <= hi
        if (value && ok(value.x, -4000, 8000) && ok(value.y, -4000, 8000) &&
            ok(value.w, 240, 1200) && ok(value.h, 120, 1200)) {
          out.miniOffset = { x: Math.round(value.x), y: Math.round(value.y), w: Math.round(value.w), h: Math.round(value.h) }
        }
        break
      }
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

module.exports = { load, save, validate, DEFAULTS }
