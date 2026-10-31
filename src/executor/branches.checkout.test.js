import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { execa } from 'execa'
import { findLocalCheckout, remoteMatchesRepo, clearLocalCheckoutCache, checkoutRemoteBranch } from './branches.js'

vi.mock('execa', () => ({ execa: vi.fn() }))

const ghHost = process.env.GH_HOST
afterEach(() => { if (ghHost === undefined) delete process.env.GH_HOST; else process.env.GH_HOST = ghHost })

describe('remoteMatchesRepo (#471)', () => {
  beforeEach(() => { delete process.env.GH_HOST })

  it.each([
    ['git@github.com:Owner/Repo.git', 'owner/repo'],
    ['https://github.com/owner/repo', 'owner/repo'],
    ['https://user@ghe.corp/owner/repo.git/', 'ghe.corp/owner/repo'],
    ['ssh://git@github.com/owner/repo.git', 'owner/repo'],
    ['ssh://git@ghe.corp:2222/owner/repo.git', 'ghe.corp/owner/repo'],
  ])('%s matches %s', (url, repo) => expect(remoteMatchesRepo(url, repo)).toBe(true))

  it.each([
    ['git@github.com:owner/other.git', 'owner/repo'],
    ['https://github.com/owner/repo-extra', 'owner/repo'],
    ['', 'owner/repo'],
    // Same owner/name on another host is a different repository.
    ['git@github.com:owner/repo.git', 'ghe.corp/owner/repo'],
    ['https://ghe.corp/owner/repo.git', 'owner/repo'],
  ])('%s does not match %s', (url, repo) => expect(remoteMatchesRepo(url, repo)).toBe(false))

  it('uses GH_HOST for a repo without a host', () => {
    process.env.GH_HOST = 'ghe.corp'
    expect(remoteMatchesRepo('git@ghe.corp:owner/repo.git', 'owner/repo')).toBe(true)
    expect(remoteMatchesRepo('git@github.com:owner/repo.git', 'owner/repo')).toBe(false)
  })
})

describe('findLocalCheckout (#471)', () => {
  beforeEach(() => { vi.clearAllMocks(); clearLocalCheckoutCache(); delete process.env.GH_HOST })

  it('returns the launch directory and the matching remote', async () => {
    execa.mockResolvedValue({ stdout: 'origin\tgit@github.com:o/r.git (fetch)\norigin\tgit@github.com:o/r.git (push)' })
    expect(await findLocalCheckout('o/r')).toEqual({ dir: process.cwd(), remote: 'origin' })
  })

  it('names the non-origin remote in a fork clone', async () => {
    execa.mockResolvedValue({ stdout: 'origin\tgit@github.com:me/r.git (fetch)\nupstream\tgit@github.com:o/r.git (fetch)' })
    expect(await findLocalCheckout('o/r')).toEqual({ dir: process.cwd(), remote: 'upstream' })
  })

  it('returns null for an unrelated clone, a non-repo, or a git failure', async () => {
    execa.mockResolvedValue({ stdout: 'origin\tgit@github.com:x/y.git (fetch)' })
    expect(await findLocalCheckout('o/r')).toBeNull()
    clearLocalCheckoutCache()
    execa.mockResolvedValue({ stdout: '', exitCode: 128 })
    expect(await findLocalCheckout('o/r')).toBeNull()
    clearLocalCheckoutCache()
    execa.mockRejectedValue(new Error('spawn git ENOENT'))
    expect(await findLocalCheckout('o/r')).toBeNull()
  })

  it('runs git remote -v once per repo and directory', async () => {
    execa.mockResolvedValue({ stdout: 'origin\tgit@github.com:o/r.git (fetch)' })
    await findLocalCheckout('o/r')
    await findLocalCheckout('o/r')
    expect(execa).toHaveBeenCalledOnce()
    await findLocalCheckout('o/other')
    expect(execa).toHaveBeenCalledTimes(2)
  })
})

describe('checkoutRemoteBranch (#471)', () => {
  beforeEach(() => vi.clearAllMocks())
  const calls = () => execa.mock.calls.map(([, args]) => args.join(' '))

  it('plain checkout for origin', async () => {
    execa.mockResolvedValue({ stdout: '', exitCode: 0 })
    await checkoutRemoteBranch({ dir: '/w', remote: 'origin' }, 'dev')
    expect(calls()).toEqual(['checkout dev'])
  })

  it('fetches from the matching remote and tracks it when the branch is not local', async () => {
    execa.mockImplementation(async (_cmd, args) => ({ stdout: '', exitCode: args[0] === 'rev-parse' ? 1 : 0 }))
    await checkoutRemoteBranch({ dir: '/w', remote: 'upstream' }, 'dev')
    expect(calls()).toEqual(['fetch upstream dev', 'rev-parse --verify --quiet refs/heads/dev', 'checkout -b dev --track upstream/dev'])
    for (const [, , opts] of execa.mock.calls) expect(opts.cwd).toBe('/w')
  })
})
