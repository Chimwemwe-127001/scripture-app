/**
 * logger.js: minimal rotating file logger for the main process.
 *
 * Writes to userData/logs/scripture-app.log so a failure during a live
 * service leaves something to investigate afterwards. Console output is kept
 * as well for `npm run dev`.
 *
 * Dependency-free on purpose. Volume is low (a few lines per chunk), so a
 * simple append stream with size-based rotation is enough.
 */

const { app } = require('electron')
const { join } = require('path')
const fs = require('fs')

const MAX_BYTES = 5 * 1024 * 1024   // rotate at 5 MB
const KEEP_FILES = 3

let _logPath = null
let _stream = null
let _bytes = 0         // size of the current log file
let _failed = false    // if logging itself breaks, degrade silently and never crash the app

function logDir() {
  return join(app.getPath('userData'), 'logs')
}

function logPath() {
  if (!_logPath) _logPath = join(logDir(), 'scripture-app.log')
  return _logPath
}

/** scripture-app.log -> .1 -> .2 -> .3, the oldest is dropped. */
function rotate() {
  try {
    if (_stream) { _stream.end(); _stream = null }
    const p = logPath()
    for (let i = KEEP_FILES - 1; i >= 1; i--) {
      const from = `${p}.${i}`
      if (fs.existsSync(from)) fs.renameSync(from, `${p}.${i + 1}`)
    }
    if (fs.existsSync(p)) fs.renameSync(p, `${p}.1`)
  } catch {
    /* rotation is best-effort */
  }
  _bytes = 0
}

function stream() {
  if (_failed) return null
  if (_stream) return _stream
  try {
    fs.mkdirSync(logDir(), { recursive: true })
    const p = logPath()
    _bytes = fs.existsSync(p) ? fs.statSync(p).size : 0
    if (_bytes >= MAX_BYTES) rotate()
    _stream = fs.createWriteStream(p, { flags: 'a' })
    _stream.on('error', () => { _failed = true; _stream = null })
    return _stream
  } catch {
    _failed = true
    return null
  }
}

function write(level, scope, message, extra) {
  const line =
    `${new Date().toISOString()} ${level.padEnd(5)} [${scope}] ${message}` +
    (extra !== undefined ? ` ${safeJson(extra)}` : '')

  if (level === 'ERROR') console.error(line)
  else if (level === 'WARN') console.warn(line)
  else console.log(line)

  const s = stream()
  if (!s) return
  try {
    s.write(line + '\n')
    _bytes += Buffer.byteLength(line) + 1
    // Checked on every write so a long session rotates too, not only on start.
    if (_bytes >= MAX_BYTES) rotate()
  } catch { /* ignore */ }
}

function safeJson(v) {
  try { return JSON.stringify(v) } catch { return '[unserialisable]' }
}

module.exports = {
  info:  (scope, msg, extra) => write('INFO', scope, msg, extra),
  warn:  (scope, msg, extra) => write('WARN', scope, msg, extra),
  error: (scope, msg, extra) => write('ERROR', scope, msg, extra),
  getLogPath: logPath,
}
