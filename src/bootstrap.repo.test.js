/**
 * bootstrap.repo.test.js — repository precedence and onboarding persistence (#290).
 * config.js is mocked so nothing touches the real ~/.config/lazyhub.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('execa', () => ({ execa: vi.fn() }))
vi.mock('./config.js', () => ({
  writeDefaultConfig: vi.fn(),
  loadSavedRepo: vi.fn(() => null),
  saveDefaultRepo: vi.fn(),
}))

import { execa } from 'execa'
import { loadSavedRepo, saveDefaultRepo } from './config.js'
import { bootstrap } from './bootstrap.js'
import { classifyGh } from './daemon/protocol.js'

/**
 * gh works; the current directory has this remote.
 *
 * @param {string|null} remote  owner/name, or null when not a repository
 */
function stubEnv(remote) {
  execa.mockImplementation(async (bin, args) => {
    if (bin === 'git') return remote ? { exitCode: 0, stdout: `https://github.com/${remote}.git` } : { exitCode: 128, stdout: '', stderr: 'not a git repo' }
    if (args[0] === 'repo') return { exitCode: 1, stdout: '', stderr: 'not a repo' }
    return { exitCode: 0, stdout: 'ok\n', stderr: '' }
  })
}

let prev
beforeEach(() => {
  vi.clearAllMocks()
  prev = { host: process.env.GH_HOST, repo: process.env.GHUI_REPO, token: process.env.GITHUB_TOKEN }
  delete process.env.GH_HOST
  delete process.env.GITHUB_TOKEN
})
afterEach(() => {
  for (const [k, v] of [['GH_HOST', prev.host], ['GHUI_REPO', prev.repo], ['GITHUB_TOKEN', prev.token]]) {
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
})

describe('bootstrap repository precedence and persistence', () => {
  it('the repo detected from the current directory beats the saved one', async () => {
    stubEnv('cwd/repo')
    loadSavedRepo.mockReturnValue('saved/repo')
    await bootstrap(vi.fn())
    expect(process.env.GHUI_REPO).toBe('cwd/repo')
    expect(saveDefaultRepo).not.toHaveBeenCalled()
  })

  it('the saved repo is used when the current directory is not a repository', async () => {
    stubEnv(null)
    loadSavedRepo.mockReturnValue('saved/repo')
    await bootstrap(vi.fn())
    expect(process.env.GHUI_REPO).toBe('saved/repo')
  })

  it('a repo chosen in onboarding is used for this launch and persisted', async () => {
    stubEnv('cwd/repo')
    loadSavedRepo.mockReturnValue('old/saved')
    await bootstrap(vi.fn(), { repo: 'picked/repo' })
    expect(process.env.GHUI_REPO).toBe('picked/repo')
    expect(saveDefaultRepo).toHaveBeenCalledExactlyOnceWith('picked/repo')
  })
})

describe('bootstrap --repo override (#466)', () => {
  it('beats the repo detected from the current directory and the saved one, and is not persisted', async () => {
    stubEnv('cwd/repo')
    loadSavedRepo.mockReturnValue('saved/repo')
    await bootstrap(vi.fn(), { repoOverride: 'flag/repo' })
    expect(process.env.GHUI_REPO).toBe('flag/repo')
    expect(saveDefaultRepo).not.toHaveBeenCalled()
  })

  it('names the repo for a bare #N reference', async () => {
    stubEnv('cwd/repo')
    execa.mockImplementation(async (bin, args) => ({ exitCode: 0, stdout: bin === 'gh' && String(args[1]).startsWith('repos/') ? 'false' : 'ok\n', stderr: '' }))
    await bootstrap(vi.fn(), { repoOverride: 'flag/repo', open: { repo: null, number: 7, kind: 'issue', host: null } })
    expect(process.env.GHUI_REPO).toBe('flag/repo')
    delete process.env.GHUI_ISSUE
  })
})

describe('bootstrap opening a PR/issue by reference (#315)', () => {
  const OPEN_ENV = ['GHUI_PR', 'GHUI_ISSUE', 'GHUI_VIEW']
  let saved
  beforeEach(() => {
    saved = Object.fromEntries(OPEN_ENV.map(k => [k, process.env[k]]))
    for (const k of OPEN_ENV) delete process.env[k]
  })
  afterEach(() => {
    for (const k of OPEN_ENV) {
      if (saved[k] === undefined) delete process.env[k]
      else process.env[k] = saved[k]
    }
  })

  const ghCalls = () => execa.mock.calls.filter(([bin]) => bin === 'gh').map(([, args]) => args)
  const isResolve = args => args[0] === 'api' && String(args[1]).startsWith('repos/')
  const stubKind = answer => execa.mockImplementation(async (bin, args) => ({
    exitCode: 0, stdout: bin === 'gh' && isResolve(args) ? answer : 'ok\n', stderr: '',
  }))

  it('resolves owner/repo#N with one read-only call and opens the PR detail', async () => {
    stubKind('true')
    await bootstrap(vi.fn(), { open: { repo: 'o/r', number: 7, kind: null, host: null } })
    expect(process.env.GHUI_REPO).toBe('o/r')
    expect(process.env.GHUI_PR).toBe('7')
    expect(process.env.GHUI_VIEW).toBe('detail')
    const resolves = ghCalls().filter(isResolve)
    expect(resolves.map(a => a[1])).toEqual(['repos/o/r/issues/7'])
    expect(classifyGh(resolves[0])).toBe('read')
    for (const args of ghCalls()) expect(classifyGh(args)).not.toBe('write')
  })

  it('opens an issue when the number is not a PR', async () => {
    stubKind('false')
    await bootstrap(vi.fn(), { open: { repo: 'o/r', number: 9, kind: null, host: null } })
    expect(process.env.GHUI_ISSUE).toBe('9')
    expect(process.env.GHUI_PR).toBeUndefined()
  })

  it('a URL names kind and host: no resolve call, GH_HOST set to the allowed host', async () => {
    stubEnv('cwd/repo')
    await bootstrap(vi.fn(), { open: { repo: 'o/r', number: 3, kind: 'issue', host: 'ghe.example.com' } })
    expect(process.env.GH_HOST).toBe('ghe.example.com')
    expect(process.env.GHUI_ISSUE).toBe('3')
    expect(ghCalls().some(isResolve)).toBe(false)
  })

  it('#N uses the current-directory repo, not the saved one', async () => {
    stubEnv('cwd/repo')
    loadSavedRepo.mockReturnValue('saved/repo')
    await bootstrap(vi.fn(), { open: { repo: null, number: 5, kind: 'pr', host: null } })
    expect(process.env.GHUI_REPO).toBe('cwd/repo')
  })

  it('#N outside a repository exits 2 with guidance instead of guessing', async () => {
    stubEnv(null)
    loadSavedRepo.mockReturnValue('saved/repo')
    const exit = vi.spyOn(process, 'exit').mockImplementation(code => { throw new Error(`exit ${code}`) })
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    await expect(bootstrap(vi.fn(), { open: { repo: null, number: 5, kind: null, host: null } })).rejects.toThrow('exit 2')
    expect(err.mock.calls.flat().join('\n')).toMatch(/owner\/repo#5/)
    exit.mockRestore(); err.mockRestore()
  })
})
