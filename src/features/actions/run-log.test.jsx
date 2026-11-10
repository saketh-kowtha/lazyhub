import React from 'react'
import { rmSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, flush, renderWithProviders, waitForExpectation } from '../../test/test-helpers.jsx'
import { resetGhMemoryCache } from '../../hooks/useGh.js'

// Hermetic disk cache: set before cache.js is first imported.
vi.hoisted(() => { process.env.LAZYHUB_CACHE_DIR = `${process.env.TMPDIR || '/tmp'}/lazyhub-run-log-${process.pid}` })

vi.mock('ink', async () => ({
  ...await vi.importActual('ink'),
  useInput: (await import('../../test/input-bus.js')).mockUseInput(await import('react')),
}))
vi.mock('../../executor.js', () => ({
  getRunLogs: vi.fn(),
  classifyGhFailure: () => ({ tone: 'warn', cause: 'failed', notes: [], fix: null, fixHint: null }),
  failureGlyph: () => '!',
}))

vi.mock('../../executor/ci-logs.js', () => ({ getFailedLog: vi.fn() }))

const { getRunLogs } = await import('../../executor.js')
const { getFailedLog } = await import('../../executor/ci-logs.js')
const { RunLogDialog } = await import('./RunLogDialog.jsx')
const { runLogKey, runLogFreshness } = await import('./run-log.js')

// Run logs keyed by run id + attempt (V4b, #597).
const done = { databaseId: 501, workflowName: 'CI', headBranch: 'main', status: 'completed', conclusion: 'success', updatedAt: '2026-06-06T10:05:00Z' }
const failed = { ...done, databaseId: 502, conclusion: 'failure' }
// Each test uses its own run: the disk-cache mirror outlives resetGhMemoryCache().
const transient = { ...failed, databaseId: 504 }
const running = { ...done, databaseId: 503, status: 'in_progress', conclusion: null }
const open = (run, isFailed = false) => renderWithProviders(<RunLogDialog repo="o/r" run={run} failed={isFailed} onClose={() => {}} />)

beforeEach(() => {
  vi.clearAllMocks()
  rmSync(process.env.LAZYHUB_CACHE_DIR, { recursive: true, force: true })
  resetGhMemoryCache()
  getRunLogs.mockResolvedValue('build\tstep\t2026-06-06T10:00:00.000Z compile ok')
  getFailedLog.mockResolvedValue({ state: 'ok', text: 'job\tstep\t2026-06-06T10:00:00.000Z Error: boom', detail: '' })
})
afterEach(() => cleanup())

describe('run logs keyed by run id + attempt (#597, V4b)', () => {
  it('reopening the log of a completed run makes 0 gh calls', async () => {
    const first = open(done)
    await waitForExpectation(() => expect(first.lastFrame()).toContain('compile ok'))
    expect(getRunLogs).toHaveBeenCalledTimes(1)
    first.unmount()
    getRunLogs.mockClear()
    const second = open(done)
    // From the cache: the very first frame already shows the log.
    expect(second.lastFrame()).toContain('compile ok')
    await flush(20)
    expect(getRunLogs).not.toHaveBeenCalled()
  })

  it('a failed run keeps its excerpt too, and reopens with 0 gh calls', async () => {
    const first = open(failed, true)
    await waitForExpectation(() => expect(first.lastFrame()).toContain('Failure excerpt'))
    first.unmount()
    vi.clearAllMocks()
    const second = open(failed, true)
    expect(second.lastFrame()).toContain('Failure excerpt')
    await flush(20)
    expect(getRunLogs).not.toHaveBeenCalled()
    expect(getFailedLog).not.toHaveBeenCalled()
  })

  it('a transient excerpt outcome is not kept as if it were final', async () => {
    getFailedLog.mockResolvedValue({ state: 'rate_limit', text: '', detail: 'GitHub API rate limit exceeded' })
    const first = open(transient, true)
    await waitForExpectation(() => expect(first.lastFrame()).toContain('rate_limit'))
    first.unmount()
    getFailedLog.mockClear()
    getFailedLog.mockResolvedValue({ state: 'ok', text: 'job\tstep\t2026-06-06T10:00:00.000Z Error: boom', detail: '' })
    open(transient, true)
    await waitForExpectation(() => expect(getFailedLog).toHaveBeenCalledTimes(1))
  })

  it('a run still going is read again on every open', async () => {
    const first = open(running)
    await waitForExpectation(() => expect(first.lastFrame()).toContain('compile ok'))
    first.unmount()
    getRunLogs.mockClear()
    getRunLogs.mockResolvedValue('build\tstep\t2026-06-06T10:00:00.000Z more output')
    const second = open(running)
    // The earlier text is on screen at once; the new text replaces it without a blank frame.
    expect(second.lastFrame()).toContain('compile ok')
    await waitForExpectation(() => expect(second.lastFrame()).toContain('more output'))
    expect(getRunLogs).toHaveBeenCalledTimes(1)
  })

  it('names the attempt in the key and asks gh for it after the first attempt', async () => {
    expect(runLogKey({ ...done, attempt: 2 })).toEqual([501, '2026-06-06T10:05:00Z', 2])
    expect(runLogFreshness(done)).toEqual({ freshness: 'immutable' })
    expect(runLogFreshness(running)).toEqual({ ttl: 0 })
    const view = open({ ...done, attempt: 2 })
    await waitForExpectation(() => expect(view.lastFrame()).toContain('compile ok'))
    expect(getRunLogs).toHaveBeenCalledWith('o/r', 501, 2)
  })

  it('a re-run (new updatedAt) is a new key', async () => {
    const first = open(done)
    await waitForExpectation(() => expect(first.lastFrame()).toContain('compile ok'))
    first.unmount()
    getRunLogs.mockClear()
    open({ ...done, updatedAt: '2026-06-06T11:00:00Z' })
    await waitForExpectation(() => expect(getRunLogs).toHaveBeenCalledTimes(1))
  })
})
