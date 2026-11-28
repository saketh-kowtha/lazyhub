// WARM-GH:reopen = 0 (#597): coming back to the PR list puts the cursor back on the row it was on, and
// that restore must not start a diff prefetch (it was the one gh call of a warm re-open). The first
// cursor move prefetches as before (#482).
import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PRList } from './list.jsx'
import { resetGhMemoryCache } from '../../hooks/useGh.js'
import { resetCacheState } from '../../cache.js'
import { saveState } from '../../config.js'
import { listPRsPage, getRepoInfo, getPRPreview } from '../../executor.js'
import { sendInput } from '../../test/input-bus.js'
import { cleanup, flush, renderWithProviders, waitForExpectation } from '../../test/test-helpers.jsx'

const prefetched = vi.hoisted(() => [])
vi.mock('ink', async () => {
  const React = await import('react')
  return { ...await vi.importActual('ink'), useInput: (await import('../../test/input-bus.js')).mockUseInput(React) }
})
vi.mock('../../executor.js', async (original) => ({
  ...await original(),
  listPRsPage: vi.fn(), getRepoInfo: vi.fn(), getPRPreview: vi.fn(),
}))
// The hook's contract: it prefetches `number` once it rests; null means nothing to prefetch.
vi.mock('./diff/prefetch.js', async () => {
  const { useEffect } = await import('react')
  return { usePrefetchPRDiff: (repo, number) => { useEffect(() => { if (number != null) prefetched.push(number) }, [repo, number]) } }
})
for (const [fn, name] of [[listPRsPage, 'listPRsPage'], [getRepoInfo, 'getRepoInfo'], [getPRPreview, 'getPRPreview']]) {
  Object.defineProperty(fn, 'name', { value: name })
}

const mk = number => ({
  number, title: `Row title ${number}`, state: 'OPEN', updatedAt: '2026-11-01T00:00:00Z', headRefName: `b${number}`, baseRefName: 'main',
  author: { login: 'alice' }, labels: [], assignees: [], reviewRequests: [], isDraft: false, mergeable: 'MERGEABLE', url: `https://x/${number}`,
})
const page = items => ({ items, hasNextPage: false, endCursor: null, totalCount: items.length })

beforeEach(() => {
  resetGhMemoryCache()
  resetCacheState()
  saveState({ prFilters: {} })
  prefetched.length = 0
  listPRsPage.mockResolvedValue(page([mk(1), mk(2), mk(3), mk(4)]))
  getRepoInfo.mockResolvedValue({})
  getPRPreview.mockResolvedValue({})
})
afterEach(() => { cleanup(); vi.clearAllMocks() })

async function mount(paneStateMap) {
  const view = renderWithProviders(
    <PRList repo="o/r" listHeight={10} innerWidth={80} onSelectPR={() => {}} onOpenDiff={() => {}} />,
    { appContext: { paneStateMap } },
  )
  await waitForExpectation(() => expect(view.lastFrame()).toContain('Row title 4'))
  await flush(30)
  return view
}

describe('PR list re-open: no prefetch for the restored row', () => {
  it('a first open prefetches the row under the cursor', async () => {
    await mount(new Map())
    expect(prefetched.at(-1)).toBe(1)
  })

  it('a warm re-open restores the cursor without prefetching it; moving the cursor prefetches again', async () => {
    const map = new Map([['prs', { cursor: 2, scrollOffset: 0 }]])
    const view = await mount(map)
    await waitForExpectation(() => expect(map.get('prs').cursor).toBe(2))
    expect(prefetched).not.toContain(3)
    expect(prefetched.filter(n => n !== 1)).toEqual([]) // at most the transient top row before the restore
    await sendInput('j')
    await waitForExpectation(() => expect(prefetched.at(-1)).toBe(4))
    await sendInput('k')
    await waitForExpectation(() => expect(prefetched.at(-1)).toBe(3)) // back on it after a move: prefetched
    expect(view.lastFrame()).toContain('Row title 3')
  })
})
