/**
 * src/daemon/wire.js — the one place that frames, validates and authenticates the local sockets' messages (#491).
 *
 * The background helper (`src/daemon/server.js`) and the editor socket (`src/ipc.js`) speak the same
 * newline-delimited JSON with the same envelope: protocol version `v`, a per-run secret `auth`, a size
 * limit, and `{ id, ok: false, code, error }` denials. Both used to carry their own copy of that code; they
 * now share this module and keep only their own message types and policies.
 *
 * What stays per server (deliberately):
 *   - which message types need the secret (the daemon: control messages; the editor socket: everything);
 *   - whether a malformed line is answered (the daemon denies it; the editor socket ignores it).
 *
 * No GitHub access, no filesystem beyond the token file that issueSession() owns.
 */

import { ERR, MAX_MESSAGE_BYTES, PROTOCOL_VERSION, checkSession, issueSession } from './protocol.js'

/**
 * Write one JSON line. A disconnected client is not an error.
 * @param {import('net').Socket} socket
 * @param {object} payload
 */
export function send(socket, payload) {
  try { socket.write(JSON.stringify(payload) + '\n') } catch { /* disconnected */ }
}

/**
 * Answer a refused request. The message never says which part of the check failed beyond the code.
 * @param {import('net').Socket} socket
 * @param {string|number|null|undefined} id request id, when one could be read
 * @param {string} code one of ERR
 * @param {string} message
 */
export function deny(socket, id, code, message) {
  send(socket, { id: id ?? null, ok: false, code, error: message })
}

/**
 * Split a socket's byte stream into NDJSON lines, enforcing MAX_MESSAGE_BYTES. A line over the limit is
 * answered with E_TOO_LARGE and the connection is closed; `onLine` only ever sees complete, trimmed,
 * non-empty lines.
 * @param {import('net').Socket} socket
 * @param {(line: string) => void} onLine
 */
export function attachLineReader(socket, onLine) {
  let buffer = ''
  socket.on('data', chunk => {
    buffer += chunk.toString()
    const lines = buffer.split('\n')
    buffer = lines.pop()
    if (buffer.length > MAX_MESSAGE_BYTES || lines.some(l => l.length > MAX_MESSAGE_BYTES)) {
      deny(socket, null, ERR.TOO_LARGE, 'message too large')
      socket.destroy()
      return
    }
    for (const line of lines) {
      if (line.trim()) onLine(line.trim())
    }
  })
}

/**
 * Parse one request line and check the envelope.
 * @param {string} raw
 * @returns {{ msg: any, id: string|number|null, error: null } | { msg: null, id: string|number|null, error: { code: string, message: string } }}
 */
export function parseRequest(raw) {
  let msg
  try { msg = JSON.parse(raw) } catch { msg = undefined }
  if (!msg || typeof msg !== 'object' || Array.isArray(msg)) {
    return { msg: null, id: null, error: { code: ERR.MALFORMED, message: 'malformed message' } }
  }
  const id = typeof msg.id === 'string' || typeof msg.id === 'number' ? msg.id : null
  if (msg.v !== PROTOCOL_VERSION) {
    return { msg: null, id, error: { code: ERR.VERSION, message: 'unsupported protocol version' } }
  }
  return { msg, id, error: null }
}

/**
 * The session to check against: an expired secret is rotated in place, so a long-running process stays
 * reachable for clients that re-read the token file. Revoked sessions never rotate; when rotation fails
 * the expired session is kept and clients are refused (fail closed).
 * @template {{token:string, expiresAt:number, revoked:boolean}|null} S
 * @param {S} session
 * @param {string|null} tokenPath
 * @param {number} [now]
 * @returns {S | {token:string, expiresAt:number, revoked:boolean}}
 */
export function currentSession(session, tokenPath, now = Date.now()) {
  if (session && !session.revoked && now > session.expiresAt && tokenPath) {
    try { return issueSession(tokenPath, now) } catch { /* keep the expired one: clients are refused */ }
  }
  return session
}

/**
 * Check the presented secret against the session.
 * @param {{token:string, expiresAt:number, revoked?:boolean}|null} session
 * @param {unknown} presented
 * @returns {string|null} an ERR code, or null when authorized
 */
export function authorize(session, presented) {
  return session ? checkSession(session, presented) : ERR.UNAUTHENTICATED
}
