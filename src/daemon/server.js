import { createServer } from 'net'
import { writeFileSync, unlinkSync, chmodSync, mkdirSync } from 'fs'
import { dirname } from 'path'
import { runGh } from '../executor/core.js'
import { daemonPidPath, daemonSocketPath, ensureSocketDir, removeStaleSocket } from './lifecycle.js'
import { DaemonCache } from './cache.js'
import { EventBus } from './event-bus.js'
import { isGhMutation, writeAuditEntry } from './audit.js'

const DEFAULT_TTL = 60_000

function send(socket, payload) {
  try { socket.write(JSON.stringify(payload) + '\n') } catch { /* disconnected */ }
}

function cacheParts(args, stdin) {
  return ['daemon-gh', args, stdin || null]
}

/**
 * Start the K-lite daemon in the current process.
 *
 * @param {object} config loaded lazyhub config
 */
export function startDaemon(config = {}) {
  const socketPath = daemonSocketPath(config)
  const pidPath = daemonPidPath(config)
  const idleMs = Math.max(1, config.daemon?.idle_timeout_minutes || 30) * 60_000
  const startedAt = Date.now()
  const clients = new Set()
  const bus = new EventBus()
  const cache = new DaemonCache({ defaultTtl: DEFAULT_TTL })
  let ghCalls = 0
  let cacheHits = 0
  let idleTimer = null

  ensureSocketDir(socketPath)
  mkdirSync(dirname(pidPath), { recursive: true, mode: 0o700 })
  removeStaleSocket(socketPath)

  const server = createServer(socket => {
    clients.add(socket)
    if (idleTimer) {
      clearTimeout(idleTimer)
      idleTimer = null
    }
    let buffer = ''

    socket.on('data', chunk => {
      buffer += chunk.toString()
      const lines = buffer.split('\n')
      buffer = lines.pop()
      for (const line of lines) {
        if (line.trim()) handleMessage(socket, line.trim())
      }
    })
    socket.on('close', () => {
      clients.delete(socket)
      armIdleShutdown()
    })
    socket.on('error', () => {
      clients.delete(socket)
      armIdleShutdown()
    })
  })

  async function handleMessage(socket, raw) {
    let msg
    try { msg = JSON.parse(raw) } catch { return }
    const id = msg.id

    if (msg.type === 'ping' || msg.type === 'status') {
      send(socket, { id, ok: true, status: status() })
      return
    }

    if (msg.type === 'stop') {
      send(socket, { id, ok: true })
      shutdown(0)
      return
    }

    if (msg.type === 'subscribe' || msg.type === 'watch') {
      const event = msg.event || msg.payload?.event || 'pr-state-changed'
      bus.subscribe(event, socket)
      send(socket, { id, ok: true, subscribed: event })
      return
    }

    if (msg.type === 'invalidate') {
      const repo = msg.repo || msg.payload?.repo || null
      cache.invalidate(repo)
      send(socket, { id, ok: true })
      bus.publish('cache-invalidated', { repo })
      return
    }

    if (msg.type === 'gh') {
      try {
        const key = cache.key(cacheParts(msg.args, msg.stdin))
        const ttl = Number.isFinite(msg.ttl) ? msg.ttl : DEFAULT_TTL
        const cached = cache.get(key, ttl)
        if (cached) {
          cacheHits += 1
          send(socket, { id, ok: true, cached: true, source: cached.source, payload: cached.payload })
          return
        }
        ghCalls += 1
        const payload = await runGh(msg.args, { stdin: msg.stdin, json: msg.json, skipDaemon: true })
        cache.set(key, payload, { repo: msg.repo || null, op: 'daemon-gh' })
        if (isGhMutation(msg.args)) {
          writeAuditEntry({ op: 'daemon-gh', repo: msg.repo || null, args: msg.args.slice(0, 4) }, config)
          bus.publish('mutation', { repo: msg.repo || null, args: msg.args.slice(0, 2) })
        }
        send(socket, { id, ok: true, cached: false, payload })
      } catch (err) {
        send(socket, { id, error: err?.message || 'gh request failed' })
      }
      return
    }

    send(socket, { id, error: `unknown type: ${msg.type}` })
  }

  function status() {
    return {
      pid: process.pid,
      socketPath,
      uptimeMs: Date.now() - startedAt,
      clients: clients.size,
      ghCalls,
      cacheHits,
      protocols: ['ipc', 'mcp', 'gh-cache'],
    }
  }

  function armIdleShutdown() {
    if (clients.size > 0 || idleTimer) return
    idleTimer = setTimeout(() => shutdown(0), idleMs)
    idleTimer.unref?.()
  }

  function cleanup() {
    try { unlinkSync(pidPath) } catch { /* ignore */ }
    try { unlinkSync(socketPath) } catch { /* ignore */ }
  }

  function shutdown(code = 0) {
    cleanup()
    server.close(() => process.exit(code))
  }

  server.listen(socketPath, () => {
    if (process.platform !== 'win32') chmodSync(socketPath, 0o600)
    writeFileSync(pidPath, String(process.pid), 'utf8')
    process.stdout.write(JSON.stringify({ ok: true, socketPath, pid: process.pid }) + '\n')
    armIdleShutdown()
  })

  process.once('SIGINT', () => shutdown(0))
  process.once('SIGTERM', () => shutdown(0))
  process.once('exit', cleanup)

  return { server, socketPath, status, shutdown }
}
