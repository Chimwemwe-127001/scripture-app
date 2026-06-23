/**
 * projectionLink.js: laptop 1's side of the link to Scripture Panel Companion.
 *
 * Laptop 1 makes every connection, with the address and key from Settings:
 *   - it posts the panel state whenever it changes, and repeats it every few
 *     seconds so the Companion can tell the link is alive;
 *   - it keeps one request open for the Companion's button presses and keys,
 *     which arrive at once and are handled like this laptop's own.
 */

const settings = require('./settings')
const { netFetch } = require('./netRoute')
const log = require('./logger')

const REPEAT_MS = 4000
const RETRY_MS = 3000
const POLL_TIMEOUT_MS = 30000   // the Companion answers within 25 s

/** http://host:port/<path> for the projection laptop, or null if it is not set up. */
function projectionUrl(path) {
  const { projectionAddress: address, sendToProjection } = settings.load()
  if (!address || !sendToProjection) return null
  const hostPort = /:\d+$/.test(address) ? address : `${address}:8765`
  return `http://${hostPort}${path}`
}

const headers = () => ({ 'Content-Type': 'application/json', 'X-Receiver-Key': settings.load().projectionKey || '' })

let lastState = null
let posting = false
let again = false

/** Send the newest state. While one post is on its way, only the latest waits. */
async function postState() {
  const url = projectionUrl('/mini/state')
  if (!url || !lastState) return
  if (posting) { again = true; return }
  posting = true
  try {
    await netFetch(url, {
      method: 'POST', headers: headers(), body: JSON.stringify(lastState), timeoutMs: 3000,
    })
  } catch { /* the laptop is away; the repeat below tries again */ }
  posting = false
  if (again) { again = false; postState() }
}

function pushState(state) {
  lastState = state
  postState()
}

async function pollActions(onAction) {
  for (;;) {
    const url = projectionUrl('/mini/actions')
    let wait = RETRY_MS
    if (url) {
      try {
        const res = await netFetch(url, { headers: headers(), timeoutMs: POLL_TIMEOUT_MS })
        if (res.ok) {
          const { actions } = await res.json()
          for (const action of actions || []) {
            log.info('link', 'Action from the second laptop', { type: action?.type, number: action?.number })
            onAction(action)
          }
          wait = 0
        }
      } catch { /* away or timed out; try again shortly */ }
    }
    if (wait) await new Promise(r => setTimeout(r, wait))
  }
}

function start({ onAction }) {
  setInterval(postState, REPEAT_MS)
  pollActions(onAction)
}

module.exports = { start, pushState, projectionUrl, headers }
