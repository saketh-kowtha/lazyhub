import { EventEmitter } from 'node:events'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ERR, MAX_MESSAGE_BYTES, PROTOCOL_VERSION, SESSION_TTL_MS, issueSession } from './protocol.js'
import { attachLineReader, authorize, currentSession, deny, parseRequest, send } from './wire.js'

function fakeSocket() {
  const socket = new EventEmitter()
  socket.written = []
  socket.destroyed = false
  socket.write = chunk => { socket.written.push(JSON.parse(String(chunk))); return true }
  socket.destroy = () => { socket.destroyed = true }
  return socket
}

const dirs = []
const tmp = () => { const d = mkdtempSync(join(tmpdir(), 'lazyhub-wire-')); dirs.push(d); return d }
afterEach(() => { while (dirs.length) rmSync(dirs.pop(), { recursive: true, force: true }) })

describe('wire: framing (#491)', () => {
  it('delivers complete trimmed lines, also across chunk boundaries, and skips blank lines', () => {
    const socket = fakeSocket()
    const lines = []
    attachLineReader(socket, line => lines.push(line))
    socket.emit('data', Buffer.from('{"a":1}\n  \n{"b"'))
    socket.emit('data', Buffer.from(':2}\r\n'))
    expect(lines).toEqual(['{"a":1}', '{"b":2}'])
  })

  it('answers an oversize line with E_TOO_LARGE and closes the connection', () => {
    const socket = fakeSocket()
    const lines = []
    attachLineReader(socket, line => lines.push(line))
    socket.emit('data', Buffer.from('x'.repeat(MAX_MESSAGE_BYTES + 1) + '\n'))
    expect(lines).toEqual([])
    expect(socket.destroyed).toBe(true)
    expect(socket.written).toEqual([{ id: null, ok: false, code: ERR.TOO_LARGE, error: 'message too large' }])
  })

  it('an unterminated oversize buffer is refused too', () => {
    const socket = fakeSocket()
    attachLineReader(socket, () => {})
    socket.emit('data', Buffer.from('y'.repeat(MAX_MESSAGE_BYTES + 1)))
    expect(socket.destroyed).toBe(true)
  })
})

describe('wire: envelope (#491)', () => {
  it('accepts an object with the current version and reads a string or number id', () => {
    expect(parseRequest(JSON.stringify({ v: PROTOCOL_VERSION, id: 'a', type: 'ping' }))).toMatchObject({ error: null, id: 'a' })
    expect(parseRequest(JSON.stringify({ v: PROTOCOL_VERSION, id: 7, type: 'ping' }))).toMatchObject({ error: null, id: 7 })
    expect(parseRequest(JSON.stringify({ v: PROTOCOL_VERSION, id: { x: 1 } }))).toMatchObject({ error: null, id: null })
  })

  it.each(['not json', '[]', '"str"', 'null', '42'])('rejects %s as malformed', raw => {
    expect(parseRequest(raw)).toMatchObject({ msg: null, id: null, error: { code: ERR.MALFORMED } })
  })

  it('rejects a missing or different version and still reports the id', () => {
    expect(parseRequest(JSON.stringify({ id: 3, type: 'ping' }))).toMatchObject({ id: 3, error: { code: ERR.VERSION } })
    expect(parseRequest(JSON.stringify({ v: PROTOCOL_VERSION + 1, id: 3 }))).toMatchObject({ id: 3, error: { code: ERR.VERSION } })
  })

  it('deny and send write one JSON line and never throw on a dead socket', () => {
    const socket = fakeSocket()
    deny(socket, undefined, ERR.UNAUTHENTICATED, 'request denied')
    expect(socket.written).toEqual([{ id: null, ok: false, code: ERR.UNAUTHENTICATED, error: 'request denied' }])
    const dead = { write: () => { throw new Error('EPIPE') } }
    expect(() => send(dead, { ok: true })).not.toThrow()
  })
})

describe('wire: sessions (#491)', () => {
  it('authorize fails closed without a session and checks the presented secret otherwise', () => {
    expect(authorize(null, 'anything')).toBe(ERR.UNAUTHENTICATED)
    const session = { token: 'secret', expiresAt: Date.now() + 1000, revoked: false }
    expect(authorize(session, 'secret')).toBeNull()
    expect(authorize(session, 'other')).toBe(ERR.UNAUTHENTICATED)
    expect(authorize(session, undefined)).toBe(ERR.UNAUTHENTICATED)
    expect(authorize({ ...session, revoked: true }, 'secret')).toBe(ERR.AUTH_REVOKED)
  })

  it('rotates an expired session in place and writes the new secret', () => {
    const path = join(tmp(), 'token')
    const old = issueSession(path, Date.now() - SESSION_TTL_MS - 5)
    const next = currentSession(old, path)
    expect(next.token).not.toBe(old.token)
    expect(readFileSync(path, 'utf8')).toBe(next.token)
    expect(authorize(next, next.token)).toBeNull()
    expect(authorize(next, old.token)).toBe(ERR.UNAUTHENTICATED)
  })

  it('never rotates a revoked session, nor a live one', () => {
    const path = join(tmp(), 'token')
    const live = issueSession(path)
    expect(currentSession(live, path)).toBe(live)
    const revoked = { ...issueSession(path, Date.now() - SESSION_TTL_MS - 5), revoked: true }
    expect(currentSession(revoked, path)).toBe(revoked)
  })

  it('keeps the expired session (clients refused) when the secret cannot be rewritten', () => {
    const expired = { token: 'old', expiresAt: Date.now() - 1, revoked: false }
    const kept = currentSession(expired, join(tmp(), 'missing-dir', 'token'))
    expect(kept).toBe(expired)
    expect(authorize(kept, 'old')).toBe(ERR.AUTH_EXPIRED)
  })
})

describe('both local servers use this module (#491)', () => {
  const read = rel => readFileSync(new URL(rel, import.meta.url), 'utf8')

  it.each([['server.js', './server.js'], ['ipc.js', '../ipc.js']])('%s does not carry its own framing, envelope or session rotation', (_name, rel) => {
    const src = read(rel)
    expect(src).toMatch(/from '\.\/(?:daemon\/)?wire\.js'/)
    expect(src).not.toMatch(/MAX_MESSAGE_BYTES/)
    expect(src).not.toMatch(/JSON\.parse\(raw\)/)
    expect(src).not.toMatch(/checkSession\(/)
    expect(src).not.toMatch(/msg\.v !== PROTOCOL_VERSION/)
  })
})
