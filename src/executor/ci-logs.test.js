import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('execa', () => ({ execa: vi.fn() }))
vi.mock('../daemon/lifecycle.js', () => ({ requestDaemon: vi.fn() }))
vi.mock('../daemon/audit.js', () => ({ writeAuditEntry: vi.fn(), hashArgs: vi.fn(() => 'h') }))
vi.mock('../cache.js', () => ({ invalidateRepoCache: vi.fn() }))

import { execa } from 'execa'
import { classifyGh } from '../daemon/protocol.js'
import { getFailedLog, classifyLogError, MAX_LOG_BYTES } from './ci-logs.js'

const fail = stderr => ({ exitCode: 1, stdout: '', stderr })

beforeEach(() => {
  vi.resetAllMocks()
  delete process.env.LAZYHUB_DAEMON_SOCKET
  execa.mockResolvedValue({ exitCode: 0, stdout: 'job\tstep\tError: x', stderr: '' })
})

describe('getFailedLog', () => {
  it('reads one job through runGh with array args, raw text and a capped buffer', async () => {
    const r = await getFailedLog('o/r', { jobId: 77 })
    expect(r).toEqual({ state: 'ok', text: 'job\tstep\tError: x', detail: '' })
    const [bin, args, opts] = execa.mock.calls[0]
    expect(bin).toBe('gh')
    expect(args).toEqual(['run', 'view', '--job', '77', '--repo', 'o/r', '--log-failed'])
    expect(opts.maxBuffer).toBe(MAX_LOG_BYTES)
    expect(classifyGh(args)).toBe('read')
  })

  it('reads a whole run when given a run id', async () => {
    await getFailedLog('o/r', { runId: '12' })
    expect(execa.mock.calls[0][1]).toEqual(['run', 'view', '12', '--repo', 'o/r', '--log-failed'])
  })

  it('refuses non-numeric ids (no flag or path injection) without spawning gh', async () => {
    for (const ref of [{ jobId: '1; rm -rf' }, { runId: '--web' }, { jobId: '../x' }, {}, { jobId: 1, runId: 2 }]) {
      expect((await getFailedLog('o/r', ref)).state).toBe('unavailable')
    }
    expect(execa).not.toHaveBeenCalled()
  })

  it('empty stdout is the empty state', async () => {
    execa.mockResolvedValue({ exitCode: 0, stdout: '', stderr: '' })
    expect((await getFailedLog('o/r', { jobId: 1 })).state).toBe('empty')
  })

  it.each([
    ['run 9 is still in progress; logs will be available when it is complete', 'pending'],
    ['failed to get run log: log not found', 'expired'],
    ['HTTP 410: Gone', 'expired'],
    ['API rate limit exceeded for user', 'rate_limit'],
    ['dial tcp: lookup api.github.com: no such host', 'unavailable'],
  ])('maps gh failure %j to %s', async (stderr, state) => {
    execa.mockResolvedValue(fail(stderr))
    expect((await getFailedLog('o/r', { jobId: 1 })).state).toBe(state)
  })

  it('maps a maxBuffer overflow to too_large', async () => {
    execa.mockRejectedValue(Object.assign(new Error('maxBuffer exceeded'), { exitCode: 1 }))
    expect((await getFailedLog('o/r', { jobId: 1 })).state).toBe('too_large')
  })

  it('classifyLogError tolerates garbage', () => {
    expect(classifyLogError(undefined).state).toBe('unavailable')
  })
})
