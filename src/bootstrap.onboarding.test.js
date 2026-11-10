/**
 * bootstrap.onboarding.test.js — first-run gh and auth failures name their cause and the next step
 * (docs/bugs/onboarding-install-auth.md: B3, B5, B9, B10, B11, B12). execa and config are mocked so
 * nothing touches the real gh, git or ~/.config/lazyhub.
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
import { bootstrap, formatFailureLines } from './bootstrap.js'

let errors
let outs
let prev

class Exit extends Error {}

/** @param {(bin: string, args: string[]) => object} handler */
function stubExeca(handler) {
  execa.mockImplementation((bin, args) => {
    const r = handler(bin, args)
    return Object.assign(Promise.resolve({ stderr: '', stdout: '', ...r }), { stdin: { write() {}, end() {} } })
  })
}

/**
 * The probe-only startup: gh answers, a token exists, git has no remote, `repo list` fails.
 *
 * @param {string} stderr what gh prints when `repo list` fails
 */
function repoListFails(stderr) {
  stubExeca((bin, args) => {
    if (bin === 'git') return { exitCode: 1 }
    if (args[0] === '--version') return { exitCode: 0, stdout: 'gh version 2.40.0' }
    if (args[1] === 'token') return { exitCode: 0, stdout: 'tok' }
    if (args[0] === 'repo' && args[1] === 'list') return { exitCode: 1, stderr }
    return { exitCode: 1 }
  })
}

async function run() {
  await expect(bootstrap(vi.fn())).rejects.toBeInstanceOf(Exit)
  return { err: errors.join('\n'), out: outs.join('') }
}

beforeEach(() => {
  vi.clearAllMocks()
  errors = []
  outs = []
  prev = { host: process.env.GH_HOST, tok: process.env.GITHUB_TOKEN }
  delete process.env.GH_HOST
  delete process.env.GITHUB_TOKEN
  vi.spyOn(console, 'error').mockImplementation((...a) => { errors.push(a.join(' ')) })
  vi.spyOn(process.stdout, 'write').mockImplementation((s) => { outs.push(String(s)); return true })
  vi.spyOn(process, 'exit').mockImplementation((code) => { throw Object.assign(new Exit(`exit ${code}`), { code }) })
  Object.defineProperty(process.stdin, 'isTTY', { value: false, configurable: true, writable: true })
})
afterEach(() => {
  vi.restoreAllMocks()
  delete process.stdin.isTTY
  for (const [k, v] of [['GH_HOST', prev.host], ['GITHUB_TOKEN', prev.tok]]) {
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
})

describe('repo list failure outside a repository', () => {
  it.each([
    ['B3 revoked token', 'gh: Bad credentials (HTTP 401)', /not signed in/i, 'gh auth login'],
    ['B9 SAML SSO', 'Resource protected by organization SAML enforcement. (HTTP 403)', /SAML SSO/, 'gh auth refresh'],
    ['B10 offline', 'error connecting to api.github.com\ncheck your internet connection', /Cannot reach api\.github\.com/, null],
    ['B11 rate limit', 'API rate limit exceeded for user ID 1. (HTTP 403)', /rate limit/i, null],
  ])('%s: names the cause, not "No repositories found"', async (_name, stderr, cause, fix) => {
    repoListFails(stderr)
    const { err } = await run()
    expect(err).toMatch(cause)
    if (fix) expect(err).toContain(fix)
    expect(err).not.toMatch(/No repositories found/)
    expect(err).not.toContain('{refresh-key}')
  })
})

describe('B5 gh too old for `auth token`', () => {
  it('asks to update gh instead of claiming the user is logged out', async () => {
    stubExeca((bin, args) => {
      if (bin === 'git') return { exitCode: 1 }
      if (args[0] === '--version') return { exitCode: 0, stdout: 'gh version 2.10.0' }
      if (args[1] === 'token') return { exitCode: 1, stderr: 'unknown command "token" for "gh auth"' }
      return { exitCode: 1 }
    })
    const { err, out } = await run()
    expect(err).toMatch(/too old/)
    expect(err).toContain('brew upgrade gh')
    expect(out).not.toMatch(/Not authenticated|Starting login/)
    expect(execa.mock.calls.some(([, a]) => a[1] === 'login')).toBe(false)
  })
})

describe('B12 gh does not answer', () => {
  it('says gh did not respond, not that it is missing, and passes a short timeout', async () => {
    stubExeca((bin, args) => (args?.[0] === '--version' ? { exitCode: undefined, timedOut: true, failed: true } : { exitCode: 1 }))
    const { err } = await run()
    expect(err).toMatch(/gh did not respond within 10s/)
    expect(err).not.toMatch(/not installed/)
    expect(execa.mock.calls.find(([, a]) => a[0] === '--version')[2].timeout).toBeLessThanOrEqual(10_000)
  })

  it('a hung `gh auth token` is reported the same way', async () => {
    stubExeca((bin, args) => {
      if (bin === 'git') return { exitCode: 1 }
      if (args[0] === '--version') return { exitCode: 0, stdout: 'gh version 2.40.0' }
      if (args[1] === 'token') return { exitCode: undefined, timedOut: true, failed: true }
      return { exitCode: 1 }
    })
    const { err } = await run()
    expect(err).toMatch(/gh did not respond/)
  })
})

describe('formatFailureLines', () => {
  it('prefers the literal command over a hint with placeholders', () => {
    expect(formatFailureLines({ cause: 'c', fix: 'gh auth login', fixHint: 'press {refresh-key}', notes: ['n'] }))
      .toBe('  ✗ c\n    Run: gh auth login\n    n')
  })
})
