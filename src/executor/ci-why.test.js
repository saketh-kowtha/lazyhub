import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('execa', () => ({ execa: vi.fn() }))
vi.mock('../daemon/lifecycle.js', () => ({ requestDaemon: vi.fn() }))
vi.mock('../daemon/audit.js', () => ({ writeAuditEntry: vi.fn(), hashArgs: vi.fn(() => 'h') }))
vi.mock('../cache.js', () => ({ invalidateRepoCache: vi.fn() }))

import { execa } from 'execa'
import { classifyGh } from '../daemon/protocol.js'
import { listPRChangedPaths, getBaseCheckHistory, FILE_MAX_PAGES } from './ci-why.js'

const ok = v => ({ exitCode: 0, stdout: JSON.stringify(v), stderr: '' })
const SHA = 'a'.repeat(40)

beforeEach(() => {
  vi.resetAllMocks()
  delete process.env.LAZYHUB_DAEMON_SOCKET
})

describe('listPRChangedPaths', () => {
  it('reads read-only REST pages and keeps previous paths', async () => {
    execa.mockResolvedValue(ok([{ path: 'a.js', previousPath: 'old.js', status: 'renamed' }]))
    const r = await listPRChangedPaths('o/r', 7)
    expect(r).toEqual({ files: [{ path: 'a.js', previousPath: 'old.js', status: 'renamed' }], truncated: false, error: null })
    const args = execa.mock.calls[0][1]
    expect(args.slice(0, 2)).toEqual(['api', 'repos/o/r/pulls/7/files?per_page=100&page=1'])
    expect(classifyGh(args)).toBe('read')
  })

  it('stops at the page ceiling and says truncated', async () => {
    execa.mockResolvedValue(ok(Array.from({ length: 100 }, (_, i) => ({ path: `f${i}`, status: 'added' }))))
    const r = await listPRChangedPaths('o/r', 7)
    expect(r.truncated).toBe(true)
    expect(execa).toHaveBeenCalledTimes(FILE_MAX_PAGES)
  })

  it('keeps pages already read when a later call fails', async () => {
    execa.mockResolvedValueOnce(ok(Array.from({ length: 100 }, (_, i) => ({ path: `f${i}`, status: 'added' }))))
    execa.mockResolvedValueOnce({ exitCode: 1, stdout: '', stderr: 'HTTP 502' })
    const r = await listPRChangedPaths('o/r', 7)
    expect(r.files).toHaveLength(100)
    expect(r.error).toBeTruthy()
  })
})

describe('getBaseCheckHistory', () => {
  it('uses one commits call plus one check-runs call per commit, bounded by limit', async () => {
    execa.mockResolvedValueOnce(ok([SHA, 'b'.repeat(40)]))
    execa.mockResolvedValueOnce(ok({ total: 1, runs: [{ name: 'test', conclusion: 'failure' }] }))
    execa.mockResolvedValueOnce(ok({ total: 1, runs: [{ name: 'test', conclusion: 'success' }] }))
    const r = await getBaseCheckHistory('o/r', 'main', 'test', { limit: 2 })
    expect(r.samples.map(s => s.outcome)).toEqual(['failure', 'success'])
    expect(execa).toHaveBeenCalledTimes(3)
    expect(execa.mock.calls[0][1][1]).toContain('commits?sha=main&per_page=2')
  })

  it('caps an absurd limit', async () => {
    execa.mockResolvedValue(ok([]))
    await getBaseCheckHistory('o/r', 'main', 't', { limit: 500 })
    expect(execa.mock.calls[0][1][1]).toContain('per_page=10')
  })

  it('marks partial when the check list is longer than one page and the check is not on it', async () => {
    execa.mockResolvedValueOnce(ok([SHA]))
    execa.mockResolvedValueOnce(ok({ total: 250, runs: [{ name: 'other', conclusion: 'success' }] }))
    const r = await getBaseCheckHistory('o/r', 'main', 'test')
    expect(r.partial).toBe(true)
    expect(r.samples[0].outcome).toBe('missing')
  })

  it('degrades on rate limit and refuses a non-hex sha', async () => {
    execa.mockResolvedValueOnce({ exitCode: 1, stdout: '', stderr: 'API rate limit exceeded' })
    expect((await getBaseCheckHistory('o/r', 'main', 't')).state).toBe('rate_limit')
    execa.mockResolvedValueOnce(ok(['--web']))
    const r = await getBaseCheckHistory('o/r', 'main', 't')
    expect(r.samples).toEqual([])
    expect((await getBaseCheckHistory('o/r', '', 't')).state).toBe('unavailable')
  })
})
