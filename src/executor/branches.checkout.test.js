import { describe, expect, it, vi, beforeEach } from 'vitest'
import { execa } from 'execa'
import { findLocalCheckout, remoteMatchesRepo } from './branches.js'

vi.mock('execa', () => ({ execa: vi.fn() }))

describe('remoteMatchesRepo (#471)', () => {
  it.each([
    ['git@github.com:Owner/Repo.git', 'owner/repo'],
    ['https://github.com/owner/repo', 'owner/repo'],
    ['https://user@ghe.corp/owner/repo.git/', 'ghe.corp/owner/repo'],
    ['ssh://git@github.com/owner/repo.git', 'owner/repo'],
  ])('%s matches %s', (url, repo) => expect(remoteMatchesRepo(url, repo)).toBe(true))

  it.each([
    ['git@github.com:owner/other.git', 'owner/repo'],
    ['https://github.com/owner/repo-extra', 'owner/repo'],
    ['', 'owner/repo'],
  ])('%s does not match %s', (url, repo) => expect(remoteMatchesRepo(url, repo)).toBe(false))
})

describe('findLocalCheckout (#471)', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns the launch directory when a remote is the viewed repo', async () => {
    execa.mockResolvedValue({ stdout: 'origin\tgit@github.com:o/r.git (fetch)\norigin\tgit@github.com:o/r.git (push)' })
    expect(await findLocalCheckout('o/r')).toBe(process.cwd())
  })

  it('returns null for an unrelated clone, a non-repo, or a git failure', async () => {
    execa.mockResolvedValue({ stdout: 'origin\tgit@github.com:x/y.git (fetch)' })
    expect(await findLocalCheckout('o/r')).toBeNull()
    execa.mockResolvedValue({ stdout: '', exitCode: 128 })
    expect(await findLocalCheckout('o/r')).toBeNull()
    execa.mockRejectedValue(new Error('spawn git ENOENT'))
    expect(await findLocalCheckout('o/r')).toBeNull()
  })
})
