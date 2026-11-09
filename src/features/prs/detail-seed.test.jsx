import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PRDetail } from './detail.jsx'
import { seedPRDetail } from './list.jsx'
import { resetGhMemoryCache } from '../../hooks/useGh.js'
import { resetCacheState } from '../../cache.js'
import { notifyWrite } from '../../data/invalidation.js'
import { getPR, getRepoInfo, getPRChecks, getBranchProtection } from '../../executor.js'
import { sendInput } from '../../test/input-bus.js'
import { cleanup, flush, renderWithProviders, waitForExpectation } from '../../test/test-helpers.jsx'

vi.mock('ink', async () => {
  const React = await import('react')
  return { ...await vi.importActual('ink'), useInput: (await import('../../test/input-bus.js')).mockUseInput(React) }
})
vi.mock('../../executor.js', async (original) => ({
  ...await original(), getPR: vi.fn(), getRepoInfo: vi.fn(), getPRChecks: vi.fn(), getBranchProtection: vi.fn(),
}))

function defer() {
  let resolve
  const promise = new Promise(r => { resolve = r })
  return { promise, resolve }
}

const row = {
  number: 7, title: 'Row title', state: 'OPEN', author: { login: 'alice' }, labels: [], assignees: [],
  reviewRequests: [], isDraft: false, headRefName: 'feat', baseRefName: 'release', mergeable: 'MERGEABLE',
  autoMergeRequest: null, url: 'https://x/7', updatedAt: '2026-11-01T00:00:00Z',
}
const full = { ...row, title: 'Full title', body: 'The description', reviews: [], files: [], statusCheckRollup: [] }

// useGh keys on the function's name; vi.fn() mocks all share one, so give each its real name.
for (const [fn, name] of [[getPR, 'getPR'], [getRepoInfo, 'getRepoInfo'], [getPRChecks, 'getPRChecks'], [getBranchProtection, 'getBranchProtection']]) {
  Object.defineProperty(fn, 'name', { value: name })
}

let pending
beforeEach(() => {
  resetGhMemoryCache()
  resetCacheState()
  pending = { pr: defer(), checks: defer(), protection: defer(), info: defer() }
  getPR.mockReturnValue(pending.pr.promise)
  getPRChecks.mockReturnValue(pending.checks.promise)
  getBranchProtection.mockReturnValue(pending.protection.promise)
  getRepoInfo.mockReturnValue(pending.info.promise)
})
afterEach(() => { cleanup(); vi.clearAllMocks() })

describe('PR detail seeded from the list row (#481, #452)', () => {
  it('renders the row on the first frame and starts getPR, checks and protection together', async () => {
    seedPRDetail('o/r', row)
    const onOpenDiff = vi.fn()
    const view = renderWithProviders(<PRDetail prNumber={7} repo="o/r" baseRefName="release" onBack={() => {}} onOpenDiff={onOpenDiff} />)
    // No skeleton: the header and the "still loading" row are there before any request returns.
    expect(view.lastFrame()).toContain('Row title')
    expect(view.lastFrame()).toContain('Loading description')
    await flush(20)
    // One parallel round trip: all four requests were issued before any of them returned.
    expect(getPR).toHaveBeenCalledTimes(1)
    expect(getPRChecks).toHaveBeenCalledTimes(1)
    expect(getBranchProtection).toHaveBeenCalledWith('o/r', 'release')
    expect(getRepoInfo).toHaveBeenCalledTimes(1)

    // A key that needs the full PR waits instead of acting on the partial one.
    await flush(20)
    await sendInput('d')
    expect(onOpenDiff).not.toHaveBeenCalled()
    expect(view.lastFrame()).toContain('Loading PR details')

    pending.pr.resolve(full)
    await waitForExpectation(() => expect(view.lastFrame()).toContain('Full title'))
    expect(view.lastFrame()).toContain('The description')
    expect(view.lastFrame()).not.toContain('Loading description')
    await sendInput('d')
    expect(onOpenDiff).toHaveBeenCalledTimes(1)
  })

  it('without a seed it shows the skeleton, as before', async () => {
    const view = renderWithProviders(<PRDetail prNumber={7} repo="o/r" onBack={() => {}} />)
    expect(view.lastFrame()).not.toContain('Row title')
  })

  it('a write while the detail is open refreshes it without r', async () => {
    getPR.mockResolvedValueOnce(full)
    getPRChecks.mockResolvedValue([])
    getBranchProtection.mockResolvedValue(null)
    getRepoInfo.mockResolvedValue(null)
    const view = renderWithProviders(<PRDetail prNumber={7} repo="o/r" baseRefName="release" onBack={() => {}} />)
    await waitForExpectation(() => expect(view.lastFrame()).toContain('Full title'))
    getPR.mockResolvedValueOnce({ ...full, title: 'After approve' })
    notifyWrite('o/r') // e.g. reviewPR finished
    await waitForExpectation(() => expect(view.lastFrame()).toContain('After approve'))
    expect(getPR).toHaveBeenCalledTimes(2)
  })
})
