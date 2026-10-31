import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'fs'
import { connect } from 'net'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const posix = process.platform !== 'win32'
const ENV_KEYS = ['HOME', 'TMPDIR', 'XDG_RUNTIME_DIR', 'LAZYHUB_SOCKET']

let root
let saved
let ipc

const mode = path => lstatSync(path).mode & 0o777

async function waitFor(fn) {
  for (let i = 0; i < 100; i += 1) {
    if (fn()) return
    await new Promise(resolve => setTimeout(resolve, 20))
  }
  throw new Error('timed out')
}

beforeEach(async () => {
  saved = Object.fromEntries(ENV_KEYS.map(k => [k, process.env[k]]))
  // Short root keeps Unix socket paths under the ~104 byte sun_path limit.
  root = mkdtempSync(join(posix ? '/tmp' : tmpdir(), 'lh-ipc-'))
  mkdirSync(join(root, 'home'))
  mkdirSync(join(root, 'tmp'))
  process.env.HOME = join(root, 'home')
  process.env.TMPDIR = join(root, 'tmp')
  delete process.env.XDG_RUNTIME_DIR
  delete process.env.LAZYHUB_SOCKET
  vi.resetModules()
  ipc = await import('./ipc.js')
})

afterEach(() => {
  ipc.stopIPC()
  vi.restoreAllMocks()
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
  rmSync(root, { recursive: true, force: true })
})

describe.skipIf(!posix)('startIPC endpoint hardening', () => {
  it('binds a 0600 socket in a 0700 private dir and writes a 0600 pointer, under a permissive umask', async () => {
    const old = process.umask(0o000)
    try {
      const path = ipc.startIPC()
      await waitFor(() => existsSync(join(root, 'home', '.lazyhub-socket')))
      expect(path.startsWith(join(root, 'home', '.config', 'lazyhub', 'run'))).toBe(true)
      expect(path).not.toMatch(/^\/tmp\/lazyhub-\d+\.sock$/)
      expect(mode(join(path, '..'))).toBe(0o700)
      expect(mode(path)).toBe(0o600)
      expect(mode(join(root, 'home', '.lazyhub-socket'))).toBe(0o600)
      expect(readFileSync(join(root, 'home', '.lazyhub-socket'), 'utf8')).toBe(path)

      const reply = await new Promise(resolve => {
        const c = connect(path, () => c.write('{"id":"1","type":"ping"}\n'))
        c.once('data', d => { c.destroy(); resolve(JSON.parse(d.toString())) })
      })
      expect(reply.pong).toBe(true)
    } finally {
      process.umask(old)
    }
  })

  it('tightens a loose directory we own and refuses a symlinked or foreign-owned one', () => {
    const dir = join(root, 'home', '.config', 'lazyhub', 'run')
    mkdirSync(join(dir, '..'), { recursive: true })
    mkdirSync(dir, { mode: 0o777 })
    chmodSync(dir, 0o777)
    expect(ipc.startIPC()).toBeTruthy()
    expect(mode(dir)).toBe(0o700)
    ipc.stopIPC()

    rmSync(dir, { recursive: true })
    mkdirSync(join(root, 'elsewhere'))
    symlinkSync(join(root, 'elsewhere'), dir)
    const onError = vi.fn()
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    expect(ipc.startIPC({ onError })).toBeNull()
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringMatching(/symlink/) }))
    expect(existsSync(join(root, 'elsewhere', `ipc-${process.pid}.sock`))).toBe(false)

    rmSync(dir)
    mkdirSync(dir, { mode: 0o700 })
    vi.spyOn(process, 'getuid').mockReturnValue(process.getuid() + 1)
    const onError2 = vi.fn()
    expect(ipc.startIPC({ onError: onError2 })).toBeNull()
    expect(onError2).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringMatching(/not owned/) }))
  })

  it('does not follow or replace a pre-created entry at the socket path', () => {
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    const victim = join(root, 'victim')
    writeFileSync(victim, 'keep')
    const squat = join(root, 'squat.sock')
    process.env.LAZYHUB_SOCKET = squat

    symlinkSync(victim, squat)
    expect(ipc.startIPC()).toBeNull()
    expect(readFileSync(victim, 'utf8')).toBe('keep')
    expect(lstatSync(squat).isSymbolicLink()).toBe(true)

    rmSync(squat)
    writeFileSync(squat, 'attacker file')
    expect(ipc.startIPC()).toBeNull()
    expect(readFileSync(squat, 'utf8')).toBe('attacker file')
  })

  it('surfaces a bind failure through onError instead of swallowing it', async () => {
    process.env.LAZYHUB_SOCKET = join(root, 'missing-dir', 'a.sock')
    const onError = vi.fn()
    ipc.startIPC({ onError })
    await waitFor(() => onError.mock.calls.length > 0)
    expect(onError.mock.calls[0][0].code).toMatch(/^E(NOENT|ACCES)$/)
  })

  it('removes the socket and its own pointer on process exit (crash cleanup) but not a newer instance pointer', async () => {
    const exitHandlers = []
    const realOn = process.on.bind(process)
    vi.spyOn(process, 'on').mockImplementation((event, fn) => {
      if (event === 'exit') exitHandlers.push(fn)
      return realOn(event, fn)
    })
    const path = ipc.startIPC()
    const pointer = join(root, 'home', '.lazyhub-socket')
    await waitFor(() => existsSync(pointer))
    expect(exitHandlers).toHaveLength(1)

    writeFileSync(pointer, '/some/other/instance.sock')
    exitHandlers[0]()
    expect(existsSync(path)).toBe(false)
    expect(readFileSync(pointer, 'utf8')).toBe('/some/other/instance.sock')

    writeFileSync(pointer, path)
    exitHandlers[0]()
    expect(existsSync(pointer)).toBe(false)
    process.off('exit', exitHandlers[0])
  })
})

describe.skipIf(posix)('startIPC on Windows', () => {
  it('uses an unpredictable named pipe', () => {
    const a = ipc.startIPC()
    expect(a).toMatch(/^\\\\\.\\pipe\\lazyhub-[0-9a-f]{32}$/)
  })
})

describe.skipIf(!posix)('IDE socket GitHub writes', () => {
  const request = (path, msg) => new Promise((resolve, reject) => {
    const sock = connect(path)
    let buf = ''
    sock.on('connect', () => sock.write(JSON.stringify(msg) + '\n'))
    sock.on('data', (d) => {
      buf += d.toString()
      if (buf.includes('\n')) { sock.end(); resolve(JSON.parse(buf.split('\n')[0])) }
    })
    sock.on('error', reject)
  })
  const start = async (opts) => {
    const handlers = {
      onReplyThread: vi.fn(async () => ({ ok: true, commentId: 7 })),
      onResolveThread: vi.fn(async () => ({ ok: true })),
    }
    const path = ipc.startIPC({ ...handlers, ...opts })
    await waitFor(() => existsSync(path))
    return { path, ...handlers }
  }

  it('refuses reply-thread and resolve-thread by default without calling handlers', async () => {
    const { path, onReplyThread, onResolveThread } = await start()
    const reply = await request(path, { id: 1, type: 'reply-thread', threadId: 'T', body: 'hi' })
    const resolve = await request(path, { id: 2, type: 'resolve-thread', threadId: 'T' })
    for (const r of [reply, resolve]) {
      expect(r).toMatchObject({ ok: false, error: 'writes-disabled' })
      expect(r.message).toContain('allow_writes')
    }
    expect(onReplyThread).not.toHaveBeenCalled()
    expect(onResolveThread).not.toHaveBeenCalled()
    expect(await request(path, { id: 3, type: 'ping' })).toMatchObject({ pong: true })
  })

  it('runs the handlers when allowWrites is true', async () => {
    const { path, onReplyThread, onResolveThread } = await start({ allowWrites: true })
    expect(await request(path, { id: 1, type: 'reply-thread', threadId: 'T', body: 'hi' })).toMatchObject({ ok: true, commentId: 7 })
    expect(await request(path, { id: 2, type: 'resolve-thread', threadId: 'T' })).toMatchObject({ ok: true })
    expect(onReplyThread).toHaveBeenCalledWith('T', 'hi')
    expect(onResolveThread).toHaveBeenCalledWith('T')
  })
})

describe.skipIf(!posix)('IPC message validation', () => {
  async function waitForSocket(path) {
    for (let i = 0; i < 100; i += 1) {
      const ok = await new Promise(resolve => {
        const c = connect(path)
        c.once('connect', () => { c.destroy(); resolve(true) })
        c.once('error', () => resolve(false))
      })
      if (ok) return
      await new Promise(r => setTimeout(r, 20))
    }
    throw new Error('socket never came up')
  }

  it.each(['null', '5', '"str"', 'true'])(
    'a well-formed JSON line that is not an object (%s) must not crash the process',
    async (line) => {
      const uncaught = []
      const onUncaught = err => uncaught.push(err)
      process.on('uncaughtException', onUncaught)
      try {
        const path = ipc.startIPC()
        await waitForSocket(path)
        const client = connect(path)
        await new Promise(resolve => client.once('connect', resolve))
        client.write(`${line}\n`)
        await new Promise(r => setTimeout(r, 150))
        client.destroy()
      } finally {
        process.off('uncaughtException', onUncaught)
      }
      expect(uncaught.map(e => e.message)).toEqual([])
    },
  )
})
