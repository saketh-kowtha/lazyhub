// FLASH = 0 for the PR list and PR detail (#597, lane V4a): rows already on screen are never replaced by a
// skeleton, a "refreshing…" row, an empty state or a full-body error while data is revalidated, invalidated,
// refreshed by hand, re-keyed (filter) or fails to revalidate. Runs the real useGh / query client.
import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PRList } from './list.jsx'
import { PRDetail } from './detail.jsx'
import { resetGhMemoryCache } from '../../hooks/useGh.js'
import { resetCacheState } from '../../cache.js'
import { notifyWrite } from '../../data/invalidation.js'
import { saveState } from '../../config.js'
import { listPRsPage, getRepoInfo, getPRPreview, getPR, getPRChecks, getBranchProtection, getPRRow } from '../../executor.js'
import { sendInput } from '../../test/input-bus.js'
import { cleanup, flush, renderWithProviders, waitForExpectation } from '../../test/test-helpers.jsx'

vi.mock('ink', async () => {
  const React = await import('react')
  return { ...await vi.importActual('ink'), useInput: (await import('../../test/input-bus.js')).mockUseInput(React) }
})
vi.mock('../../executor.js', async (original) => ({
  ...await original(),
  listPRsPage: vi.fn(), getRepoInfo: vi.fn(), getPRPreview: vi.fn(), getPR: vi.fn(), getPRChecks: vi.fn(), getBranchProtection: vi.fn(), getPRRow: vi.fn(),
}))
vi.mock('./diff/prefetch.js', () => ({ usePrefetchPRDiff: () => {} }))

// useGh keys on the function's name; vi.fn() mocks all share one, so give each its real name.
for (const [fn, name] of [[listPRsPage, 'listPRsPage'], [getRepoInfo, 'getRepoInfo'], [getPRPreview, 'getPRPreview'], [getPR, 'getPR'], [getPRChecks, 'getPRChecks'], [getBranchProtection, 'getBranchProtection'], [getPRRow, 'getPRRow']]) {
  Object.defineProperty(fn, 'name', { value: name })
}

const mk = (number, state = 'OPEN', extra = {}) => ({
  number, title: `Row title ${number}`, state, updatedAt: '2026-11-01T00:00:00Z', headRefName: `b${number}`, baseRefName: 'main',
  author: { login: 'alice' }, labels: [], assignees: [], reviewRequests: [], isDraft: false, mergeable: 'MERGEABLE', url: `https://x/${number}`, ...extra,
})
const page = (items) => ({ items, hasNextPage: false, endCursor: null, totalCount: items.length })
const MARK = /Row title \d|Full title/

/** Frames after the first one holding data that no longer hold any row: each is a flash. */
function flashes(frames) {
  const first = frames.findIndex(f => MARK.test(f))
  if (first === -1) return ['no data frame ever']
  return frames.slice(first).filter(f => !MARK.test(f))
}
const refreshingFrames = (frames) => frames.filter(f => /refreshing/i.test(f))
const defer = () => { let resolve, reject; const promise = new Promise((res, rej) => { resolve = res; reject = rej }); return { promise, resolve, reject } }

beforeEach(() => {
  resetGhMemoryCache()
  resetCacheState()
  saveState({ prFilters: {} })
  getRepoInfo.mockResolvedValue({})
  getPRPreview.mockResolvedValue({})
  getPRChecks.mockResolvedValue([])
  getBranchProtection.mockResolvedValue(null)
})
afterEach(() => { cleanup(); vi.clearAllMocks() })

describe('PR list: no flash (FLASH = 0)', () => {
  async function mountList() {
    listPRsPage.mockResolvedValueOnce(page([mk(1), mk(2)]))
    const view = renderWithProviders(
      <PRList repo="o/r" listHeight={10} innerWidth={80} onSelectPR={() => {}} onOpenDiff={() => {}} />,
      { appContext: { paneStateMap: new Map() } },
    )
    await waitForExpectation(() => expect(view.lastFrame()).toContain('Row title 2'))
    await flush(20)
    return view
  }

  it('keeps rows through a forced invalidate whose revalidate is slow', async () => {
    const view = await mountList()
    const d = defer()
    listPRsPage.mockReturnValueOnce(d.promise)
    notifyWrite('o/r')
    await flush(250) // past the 150 ms skeleton delay
    expect(view.lastFrame()).toContain('Row title 2')
    d.resolve(page([mk(1), mk(2, 'OPEN', { title: 'Row title 2 changed' })]))
    await waitForExpectation(() => expect(view.lastFrame()).toContain('changed'))
    expect(flashes(view.frames)).toEqual([])
    expect(refreshingFrames(view.frames)).toEqual([])
  })

  it('keeps rows through a manual refresh', async () => {
    const view = await mountList()
    const d = defer()
    listPRsPage.mockReturnValueOnce(d.promise)
    await sendInput('r')
    await flush(250)
    expect(view.lastFrame()).toContain('Row title 1')
    d.resolve(page([mk(1), mk(2), mk(3)]))
    await waitForExpectation(() => expect(view.lastFrame()).toContain('Row title 3'))
    expect(flashes(view.frames)).toEqual([])
    expect(refreshingFrames(view.frames)).toEqual([])
  })

  it('keeps rows and shows one retry notice when a revalidate fails', async () => {
    const view = await mountList()
    listPRsPage.mockRejectedValueOnce(Object.assign(new Error('gh: HTTP 502'), { stderr: 'HTTP 502' }))
    notifyWrite('o/r')
    await waitForExpectation(() => expect(view.lastFrame()).toMatch(/retry/))
    expect(view.lastFrame()).toContain('Row title 1')
    expect(view.lastFrame()).toContain('Row title 2')
    expect(flashes(view.frames)).toEqual([])
  })

  it('keeps the previous rows while a new filter loads, then swaps them in place', async () => {
    const view = await mountList()
    const d = defer()
    listPRsPage.mockReturnValueOnce(d.promise)
    await sendInput('C') // add "closed": a new query key with nothing cached
    await flush(250)
    expect(view.lastFrame()).toContain('Row title 1')
    d.resolve(page([mk(1), mk(2), mk(9, 'CLOSED')]))
    await waitForExpectation(() => expect(view.lastFrame()).toContain('Row title 9'))
    expect(flashes(view.frames)).toEqual([])
    expect(refreshingFrames(view.frames)).toEqual([])
  })
})

describe('PR detail: no flash (FLASH = 0)', () => {
  const full = (extra = {}) => ({ ...mk(7), title: 'Full title', body: 'The description', reviews: [], files: [], statusCheckRollup: [], ...extra })
  async function mountDetail() {
    getPR.mockResolvedValueOnce(full())
    const view = renderWithProviders(<PRDetail prNumber={7} repo="o/r" onBack={() => {}} onOpenDiff={() => {}} />)
    await waitForExpectation(() => expect(view.lastFrame()).toContain('Full title'))
    await flush(20)
    return view
  }

  it('keeps the PR through an invalidate with a slow revalidate', async () => {
    const view = await mountDetail()
    const d = defer()
    getPR.mockReturnValueOnce(d.promise)
    notifyWrite('o/r')
    await flush(250)
    expect(view.lastFrame()).toContain('Full title')
    d.resolve(full({ title: 'Full title v2' }))
    await waitForExpectation(() => expect(view.lastFrame()).toContain('Full title v2'))
    expect(flashes(view.frames)).toEqual([])
    expect(refreshingFrames(view.frames)).toEqual([])
  })

  it('keeps the PR through a manual refresh', async () => {
    const view = await mountDetail()
    const d = defer()
    getPR.mockReturnValueOnce(d.promise)
    await sendInput('r')
    await flush(250)
    expect(view.lastFrame()).toContain('Full title')
    d.resolve(full({ title: 'Full title v3' }))
    await waitForExpectation(() => expect(view.lastFrame()).toContain('Full title v3'))
    expect(flashes(view.frames)).toEqual([])
    expect(refreshingFrames(view.frames)).toEqual([])
  })

  it('keeps the PR and shows a retry notice in the state line when a revalidate fails', async () => {
    const view = await mountDetail()
    getPR.mockRejectedValueOnce(Object.assign(new Error('gh: HTTP 502'), { stderr: 'HTTP 502' }))
    notifyWrite('o/r')
    await waitForExpectation(() => expect(view.lastFrame()).toMatch(/retry/))
    expect(view.lastFrame()).toContain('Full title')
    expect(flashes(view.frames)).toEqual([])
  })
})
