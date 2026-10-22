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
