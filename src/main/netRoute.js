/**
 * netRoute.js: reach the second laptop through the network that actually
 * leads to it.
 *
 * At church the stream laptop can be on two networks at once (Ethernet to
 * Starlink for the stream, Wi-Fi to the other router for the second laptop).
 * When both routers hand out the same address range (192.168.1.x), Windows
 * cannot tell which one 192.168.1.128 is on and sends some requests down the
 * wrong one, where nothing answers: the link drops and returns at random.
 *
 * So when more than one of this laptop's addresses shares the target's range,
 * each is tried once with a quick connection test, and requests are then sent
 * from the one that answered. Windows sends a request out of the network
 * whose address it comes from, so this pins the route. A failure forgets the
 * choice and tests again. With a single network nothing changes.
 */

const http = require('http')
const net = require('net')
const os = require('os')
const log = require('./logger')

const PROBE_TIMEOUT_MS = 1500
const REMEMBER_MS = 60_000

const chosen = new Map()   // "host:port" -> { address, at }

/** This laptop's IPv4 addresses in the same /24 as host (an IPv4 address). */
function sameRange(host) {
  if (!net.isIPv4(host)) return []
  const prefix = host.split('.').slice(0, 3).join('.') + '.'
  const out = []
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list || []) {
      if (a.family === 'IPv4' && !a.internal && a.address.startsWith(prefix)) out.push(a.address)
    }
  }
  return out
}

function probe(host, port, localAddress) {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port, localAddress })
    const done = (ok) => { socket.destroy(); resolve(ok) }
    socket.setTimeout(PROBE_TIMEOUT_MS, () => done(false))
    socket.once('connect', () => done(true))
    socket.once('error', () => done(false))
  })
}

/** The local address to send from, or undefined to let Windows choose. */
async function localAddressFor(host, port) {
  const candidates = sameRange(host)
  if (candidates.length < 2) return undefined
  const key = `${host}:${port}`
  const known = chosen.get(key)
  if (known && Date.now() - known.at < REMEMBER_MS) return known.address
  for (const address of candidates) {
    if (await probe(host, port, address)) {
      if (known?.address !== address) {
        log.info('net', 'Two networks share this address range; using the one that reaches it', { target: key, via: address, of: candidates })
      }
      chosen.set(key, { address, at: Date.now() })
      return address
    }
  }
  chosen.delete(key)
  return undefined
}

/**
 * A small fetch for plain http on the local network, sent through the right
 * network. Answers like fetch: { ok, status, json(), text() }; throws on
 * timeout or no connection, after forgetting the chosen route.
 */
async function request(url, { method = 'GET', headers = {}, body, timeoutMs = 5000 } = {}) {
  const u = new URL(url)
  const port = Number(u.port) || 80
  const localAddress = await localAddressFor(u.hostname, port)
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: u.hostname, port, path: u.pathname + u.search, method, headers, localAddress,
      timeout: timeoutMs,
    }, (res) => {
      let data = ''
      res.setEncoding('utf8')
      res.on('data', (chunk) => { data += chunk })
      res.on('end', () => resolve({
        ok: res.statusCode >= 200 && res.statusCode < 300,
        status: res.statusCode,
        text: async () => data,
        json: async () => JSON.parse(data || 'null'),
      }))
    })
    const fail = (err) => {
      chosen.delete(`${u.hostname}:${port}`)
      reject(err)
    }
    req.on('timeout', () => req.destroy(new Error('The operation was aborted due to timeout')))
    req.on('error', fail)
    if (body !== undefined) req.write(body)
    req.end()
  })
}

/**
 * fetch for the rest of the app: plain http goes through request() above, so
 * it takes the right network; anything else is ordinary fetch.
 * Takes `timeoutMs` instead of an AbortSignal.
 */
function netFetch(url, { timeoutMs = 5000, ...options } = {}) {
  if (String(url).startsWith('http://')) return request(url, { ...options, timeoutMs })
  return fetch(url, { ...options, signal: AbortSignal.timeout(timeoutMs) })
}

module.exports = { request, netFetch, localAddressFor }
