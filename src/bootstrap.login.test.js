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

beforeEach(() => {
  vi.clearAllMocks()
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
})
