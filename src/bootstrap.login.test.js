/**
 * bootstrap.login.test.js — the login flow reaches gh only through runGh() (#288).
 * config.js and the audit log are mocked so nothing touches ~/.config/lazyhub.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('execa', () => ({ execa: vi.fn() }))
vi.mock('./config.js', () => ({
  writeDefaultConfig: vi.fn(),
  loadSavedRepo: vi.fn(() => null),
  saveDefaultRepo: vi.fn(),
}))
vi.mock('./daemon/audit.js', () => ({ writeAuditEntry: vi.fn(), hashArgs: vi.fn(() => 'h') }))

import { execa } from 'execa'
import { bootstrap } from './bootstrap.js'

const SECRET = 'ghp_secretsecretsecretsecretsecretsecret12'
let loggedIn
let stdinWrites
let prev

/** @param {boolean} isTTY */
function setTty(isTTY) {
  Object.defineProperty(process.stdin, 'isTTY', { value: isTTY, configurable: true, writable: true })
}

beforeEach(() => {
  vi.clearAllMocks()
  setTty(true)
  loggedIn = false
  stdinWrites = []
  prev = { host: process.env.GH_HOST, token: process.env.GITHUB_TOKEN }
  delete process.env.GH_HOST
  process.env.GITHUB_TOKEN = SECRET
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
  execa.mockImplementation((bin, args) => {
    const done = (r) => Object.assign(Promise.resolve({ stderr: '', ...r }), {
      stdin: { write: (d) => stdinWrites.push(d), end: () => {} },
    })
    if (bin === 'git') return done({ exitCode: 0, stdout: 'https://github.com/me/repo.git' })
    if (args[1] === 'token') return done(loggedIn ? { exitCode: 0, stdout: 'tok' } : { exitCode: 1, stdout: '' })
    if (args[1] === 'login') { loggedIn = true; return done({ exitCode: 0, stdout: '' }) }
    return done({ exitCode: 0, stdout: 'me\n' })
  })
})
afterEach(() => {
  vi.restoreAllMocks()
  delete process.stdin.isTTY
  for (const [k, v] of [['GH_HOST', prev.host], ['GITHUB_TOKEN', prev.token]]) {
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
})

describe('bootstrap login via runGh', () => {
  it('sends GITHUB_TOKEN on stdin only, never in argv', async () => {
    await bootstrap(vi.fn())
    const login = execa.mock.calls.find(([, args]) => args[1] === 'login')
    expect(login[1]).toEqual(['auth', 'login', '--with-token'])
    expect(JSON.stringify(execa.mock.calls)).not.toContain(SECRET)
    expect(stdinWrites).toEqual([SECRET])
  })

  it('runs browser login with inherited stdio and no timeout', async () => {
    delete process.env.GITHUB_TOKEN
    vi.spyOn(process, 'platform', 'get').mockReturnValue('darwin') // hasBrowser() is true
    await bootstrap(vi.fn())
    const login = execa.mock.calls.find(([, args]) => args[1] === 'login')
    expect(login[1]).toEqual(['auth', 'login', '--web', '--git-protocol', 'https'])
    expect(login[2]).toMatchObject({ stdio: 'inherit', timeout: 0 })
  })

  it('without a TTY, a failed token login prints guidance and exits non-zero instead of prompting', async () => {
    setTty(false)
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(process, 'exit').mockImplementation((code) => { throw new Error(`exit ${code}`) })
    execa.mockImplementation((bin, args) => Object.assign(
      Promise.resolve({ stderr: '', stdout: 'x', exitCode: args[1] === 'token' || args[1] === 'login' ? 1 : 0 }),
      { stdin: { write: () => {}, end: () => {} } },
    ))
    await expect(bootstrap(vi.fn())).rejects.toThrow('exit 1')
    expect(execa.mock.calls.filter(([, args]) => args[1] === 'login')).toHaveLength(1) // --with-token only
  })
})

describe('bootstrap credential handling', () => {
  it('never lets the token reach call history, the daemon, or errors', async () => {
    const lifecycle = await import('./daemon/lifecycle.js')
    const { getGhCallHistory, runGh } = await import('./executor/core.js')
    const daemon = vi.spyOn(lifecycle, 'requestDaemon').mockResolvedValue({ payload: SECRET })
    process.env.LAZYHUB_DAEMON_SOCKET = '/nonexistent/daemon.sock'
    try {
      const reply = (r) => () => Object.assign(Promise.resolve({ stderr: '', ...r }), {
        stdin: { write: () => {}, end: () => {} },
      })
      execa.mockImplementation(reply({ exitCode: 0, stdout: SECRET }))
      // Even without json:false, `auth token` must not be daemon-served or cached.
      await runGh(['auth', 'token'])
      await runGh(['auth', 'token'], { json: false })
      execa.mockImplementation(reply({ exitCode: 1, stderr: `bad credentials ${SECRET}` }))
      const err = await runGh(['auth', 'login', '--with-token'], { json: false, stdin: SECRET }).catch(e => e)
      expect(err.exitCode).toBe(1)
      // The write's cache invalidation is expected; no read (or token) goes over the socket.
      expect(daemon.mock.calls.map(([, req]) => req.type)).toEqual(['invalidate'])
      expect(JSON.stringify(daemon.mock.calls)).not.toContain(SECRET)
      expect(JSON.stringify(getGhCallHistory())).not.toContain(SECRET)
      expect(JSON.stringify({ message: err.message, stderr: err.stderr, args: err.args })).not.toContain(SECRET)
    } finally {
      delete process.env.LAZYHUB_DAEMON_SOCKET
    }
  })
})
