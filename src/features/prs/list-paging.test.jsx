import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PRList } from './list.jsx'
import { saveState } from '../../config.js'
import { useGh } from '../../hooks/useGh.js'
import { listPRsPage, getPRRow, getPRPreview, reviewPR, closePR } from '../../executor.js'
import { sendInput } from '../../test/input-bus.js'
import { cleanup, flush, renderWithProviders, waitForExpectation } from '../../test/test-helpers.jsx'

// A narrow terminal keeps the preview panel out of the paging tests; the dismissal test widens it.
const term = vi.hoisted(() => ({ columns: 60 }))
vi.mock('ink', async () => {
  const React = await import('react')
  return {
    ...await vi.importActual('ink'),
    useInput: (await import('../../test/input-bus.js')).mockUseInput(React),
    useStdout: () => ({ stdout: { columns: term.columns, rows: 24 } }),
  }
})
vi.mock('../../hooks/useGh.js', () => ({ useGh: vi.fn() }))
vi.mock('../../executor.js', async (original) => ({
  ...await original(), listPRsPage: vi.fn(), getPRRow: vi.fn(), reviewPR: vi.fn(), closePR: vi.fn(),
}))

const mk = (number, over = {}) => ({
  number, title: `PR number ${number}`, state: 'OPEN', updatedAt: '2026-06-06T10:00:00Z',
  author: { login: 'a' }, headRefName: `b${number}`, ...over,
})
const rows = (from, to) => Array.from({ length: to - from + 1 }, (_, i) => mk(from + i))

let refetchFirst
let firstCursor
let previewResult
let previewOpts
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r }); return { promise, resolve } }
beforeEach(() => {
  saveState({ prFilters: {} }) // the remembered filter (#314) must not leak between tests
  term.columns = 60
  vi.clearAllMocks(); listPRsPage.mockReset(); getPRRow.mockReset(); reviewPR.mockReset(); closePR.mockReset()
  listPRsPage.mockResolvedValue({ items: [], hasNextPage: false, endCursor: null, totalCount: 0 })
  refetchFirst = vi.fn()
  firstCursor = 'c1'
  previewResult = { data: {}, error: null }
  previewOpts = []
  useGh.mockImplementation((fn, deps, opts) => {
    if (fn === getPRPreview) { previewOpts.push(opts); return { ...previewResult, loading: false, refetch: vi.fn() } }
    if (fn === listPRsPage) {
      return { data: { items: rows(1, 30).map(r => ({ ...r, state: (deps[1]?.states?.[0] || 'open').toUpperCase() })), hasNextPage: true, endCursor: firstCursor, totalCount: 75 }, loading: false, error: null, refetch: refetchFirst }
    }
    return { data: {}, loading: false, error: null, refetch: vi.fn() }
  })
})
afterEach(() => { cleanup() })

const mount = (innerWidth = 80) => renderWithProviders(
  <PRList repo="o/r" listHeight={10} innerWidth={innerWidth} onSelectPR={() => {}} onOpenDiff={() => {}} />,
  { appContext: { paneStateMap: new Map() } },
)

describe('PR list cursor paging (#508)', () => {
  it('appends the next page by cursor, without refetching page 1, and shows N of M', async () => {
    listPRsPage.mockResolvedValueOnce({ items: rows(31, 60), hasNextPage: true, endCursor: 'c2', totalCount: 75 })
    const view = mount()
    await waitForExpectation(() => expect(view.lastFrame()).toContain('30 of 75'))
    await flush(20)
    await sendInput('G')
    await waitForExpectation(() => expect(listPRsPage).toHaveBeenCalledTimes(1))
    expect(listPRsPage.mock.calls[0][1]).toMatchObject({ after: 'c1', states: ['open'] })
    await waitForExpectation(() => expect(view.lastFrame()).toContain('60 of 75'))
    expect(refetchFirst).not.toHaveBeenCalled()
    // The next page continues from the new cursor; page 1 is never requested again.
    listPRsPage.mockResolvedValueOnce({ items: rows(61, 75), hasNextPage: false, endCursor: null, totalCount: 75 })
    await sendInput('G')
    await waitForExpectation(() => expect(listPRsPage).toHaveBeenCalledTimes(2))
    expect(listPRsPage.mock.calls[1][1]).toMatchObject({ after: 'c2' })
    await waitForExpectation(() => expect(view.lastFrame()).toContain('75 of 75'))
  })

  it('retries only the failed page on r and keeps the loaded rows', async () => {
    listPRsPage.mockRejectedValueOnce(new Error('HTTP 502'))
    const view = mount()
    await flush(20)
    await sendInput('G')
    await waitForExpectation(() => expect(view.lastFrame()).toContain('Could not load more PRs; showing 30 of 75'))
    listPRsPage.mockResolvedValueOnce({ items: rows(31, 40), hasNextPage: false, endCursor: null, totalCount: 40 })
    await sendInput('r')
    await waitForExpectation(() => expect(view.lastFrame()).toContain('40 of 40'))
    expect(listPRsPage.mock.calls[1][1]).toMatchObject({ after: 'c1' })
    expect(refetchFirst).not.toHaveBeenCalled()
  })

  it('starts over from page 1 when the filter changes', async () => {
    listPRsPage.mockResolvedValueOnce({ items: rows(31, 60), hasNextPage: true, endCursor: 'c2', totalCount: 75 })
    const view = mount()
    await flush(20)
    await sendInput('G')
    await waitForExpectation(() => expect(view.lastFrame()).toContain('60 of 75'))
    await sendInput('f') // open -> closed
    await waitForExpectation(() => expect(useGh.mock.calls.filter(c => c[0] === listPRsPage).at(-1)[1][1]).toMatchObject({ states: ['closed'] }))
    await waitForExpectation(() => expect(view.lastFrame()).toContain('30 of 75')) // loaded pages dropped
  })
})

describe('PR list writes patch the row (#439)', () => {
  it('shows the new review state after approve without resetting the pages', async () => {
    reviewPR.mockResolvedValue(null)
    getPRRow.mockResolvedValue(mk(1, { reviewDecision: 'APPROVED', title: 'PR number 1 patched' }))
    const view = mount()
    await flush(20)
    await sendInput('a')
    await waitForExpectation(() => expect(view.lastFrame()).toContain('Approve PR #1'))
    await flush(20)
    await sendInput('g', { ctrl: true })
    // Approve asks before submitting (#468).
    await waitForExpectation(() => expect(view.lastFrame()).toContain('Approve PR #1?'))
    await flush(20)
    await sendInput('y')
    await waitForExpectation(() => expect(reviewPR).toHaveBeenCalledWith('o/r', 1, 'approve', ''))
    await waitForExpectation(() => expect(getPRRow).toHaveBeenCalledWith('o/r', 1))
    await waitForExpectation(() => expect(view.lastFrame()).toContain('PR number 1 patched'))
    expect(refetchFirst).not.toHaveBeenCalled()
    expect(listPRsPage).not.toHaveBeenCalled()
  })
})

describe('PR list preview dismissal (#461)', () => {
  it('stays dismissed while the cursor moves, and p brings it back', async () => {
    term.columns = 170
    const view = mount(170)
    await waitForExpectation(() => expect(view.lastFrame()).toContain('loading…'))
    await flush(20)
    await sendInput('', { escape: true })
    await waitForExpectation(() => expect(view.lastFrame()).not.toContain('loading…'))
    await sendInput('j')
    await sendInput('j')
    await flush(30)
    expect(view.lastFrame()).not.toContain('loading…')
    await sendInput('p')
    await waitForExpectation(() => expect(view.lastFrame()).toContain('loading…'))
  })
})

describe('PR list paging races (#508)', () => {
  it('fetches a cursor page once however fast the cursor moves', async () => {
    const page = deferred()
    listPRsPage.mockReturnValue(page.promise)
    const view = mount()
    await flush(20)
    await sendInput('G')
    for (const key of ['k', 'j', 'G', 'k', 'G', 'j']) await sendInput(key)
    await flush(30)
    expect(listPRsPage).toHaveBeenCalledTimes(1)
    page.resolve({ items: rows(31, 60), hasNextPage: false, endCursor: null, totalCount: 75 })
    await waitForExpectation(() => expect(view.lastFrame()).toContain('60 of 75'))
  })

  it('drops a stale response after the filter went open -> closed -> merged -> open', async () => {
    const stale = deferred()
    listPRsPage.mockReturnValueOnce(stale.promise)
    const view = mount()
    await flush(20)
    await sendInput('G')
    await waitForExpectation(() => expect(listPRsPage).toHaveBeenCalledTimes(1))
    for (let i = 0; i < 3; i++) { await sendInput('f'); await flush(20) }
    // Back on the filter the request was made for: its key matches again, but the request is stale.
    await waitForExpectation(() => expect(useGh.mock.calls.filter(c => c[0] === listPRsPage).at(-1)[1][1]).toMatchObject({ states: ['open'] }))
    stale.resolve({ items: rows(31, 60), hasNextPage: false, endCursor: null, totalCount: 75 })
    await flush(40)
    expect(view.lastFrame()).toContain('30 of 75')
    expect(view.lastFrame()).not.toContain('60 of 75')
  })

  it('drops appended pages when the first page is revalidated into a different page 1', async () => {
    listPRsPage.mockResolvedValueOnce({ items: rows(31, 60), hasNextPage: true, endCursor: 'c2', totalCount: 75 })
    const view = mount()
    await flush(20)
    await sendInput('G')
    await waitForExpectation(() => expect(view.lastFrame()).toContain('60 of 75'))
    firstCursor = 'c9' // a revalidation delivered a new page 1: the old c2 cursor hangs off the old one
    listPRsPage.mockResolvedValueOnce({ items: rows(31, 40), hasNextPage: false, endCursor: null, totalCount: 75 })
    await sendInput('k')
    await waitForExpectation(() => expect(listPRsPage).toHaveBeenCalledTimes(2))
    expect(listPRsPage.mock.calls[1][1]).toMatchObject({ after: 'c9' })
  })
})

describe('PR list row refresh after a write (#508)', () => {
  const approve = async (view) => {
    await flush(20)
    await sendInput('a')
    await waitForExpectation(() => expect(view.lastFrame()).toContain('Approve PR #1'))
    await flush(20)
    await sendInput('g', { ctrl: true })
    // Approve asks before submitting (#468).
    await waitForExpectation(() => expect(view.lastFrame()).toContain('Approve PR #1?'))
    await flush(20)
    await sendInput('y')
  }

  it('keeps the old row and says so when the re-read fails; it never resets the pages', async () => {
    reviewPR.mockResolvedValue(null)
    getPRRow.mockRejectedValue(new Error('HTTP 502'))
    const view = mount()
    await approve(view)
    await waitForExpectation(() => expect(view.lastFrame()).toContain('Could not refresh #1: HTTP 502'))
    expect(view.lastFrame()).toContain('PR number 1')
    expect(refetchFirst).not.toHaveBeenCalled()
  })

  it('lowers the total when a close takes the PR out of the filter', async () => {
    closePR.mockResolvedValue(null)
    getPRRow.mockResolvedValue(mk(1, { state: 'CLOSED' }))
    const view = mount()
    await waitForExpectation(() => expect(view.lastFrame()).toContain('30 of 75'))
    await flush(20)
    await sendInput('X')
    await waitForExpectation(() => expect(view.lastFrame()).toContain('Close PR #1'))
    await flush(20)
    await sendInput('y')
    await waitForExpectation(() => expect(view.lastFrame()).toContain('29 of 74'))
    expect(view.lastFrame()).not.toContain('PR number 1 ')
    expect(refetchFirst).not.toHaveBeenCalled()
  })
})

describe('PR list preview fetch (#508)', () => {
  const lastEnabled = () => previewOpts.at(-1)?.enabled

  it('makes no preview call while the panel is hidden: too narrow, or dismissed', async () => {
    const narrow = mount(80)
    await flush(300)
    expect(previewOpts.length).toBeGreaterThan(0)
    expect(previewOpts.every(o => o.enabled === false)).toBe(true)
    cleanup()

    previewOpts = []
    term.columns = 170
    const wide = mount(170)
    await waitForExpectation(() => expect(lastEnabled()).toBe(true))
    await flush(20)
    await sendInput('', { escape: true })
    await waitForExpectation(() => expect(lastEnabled()).toBe(false))
    expect(wide.lastFrame()).not.toContain('unresolved')
  })

  it('shows "preview unavailable", not "loading…" forever, when the preview fetch fails', async () => {
    previewResult = { data: null, error: new Error('HTTP 500') }
    term.columns = 170
    const view = mount(170)
    await waitForExpectation(() => expect(view.lastFrame()).toContain('preview unavailable'))
    expect(view.lastFrame()).not.toContain('loading…')
  })
})

describe('PR list "/" searches GitHub (#508)', () => {
  it('sends the typed query to GitHub with cursor pages, resets the list, and shows N of M for it', async () => {
    const view = mount()
    await waitForExpectation(() => expect(view.lastFrame()).toContain('30 of 75'))
    await flush(20)
    await sendInput('/')
    await waitForExpectation(() => expect(view.lastFrame()).toContain('Search pull requests'))
    for (const ch of 'author:bob flaky') await sendInput(ch)
    await sendInput('', { return: true })
    await waitForExpectation(() => {
      const calls = useGh.mock.calls.filter(c => c[0] === listPRsPage)
      expect(calls.at(-1)[1][1]).toMatchObject({ search: 'author:bob flaky' })
    })
    await waitForExpectation(() => expect(view.lastFrame()).toContain('/ author:bob flaky'))
    // The next cursor page of the SAME query is requested by cursor, not from page 1.
    listPRsPage.mockResolvedValueOnce({ items: rows(31, 60), hasNextPage: false, endCursor: null, totalCount: 60 })
    await flush(20)
    await sendInput('G')
    await waitForExpectation(() => expect(listPRsPage).toHaveBeenCalledTimes(1))
    expect(listPRsPage.mock.calls[0][1]).toMatchObject({ after: 'c1', search: 'author:bob flaky' })
  })

  it('refuses a query that would leave this repository, with the reason, and keeps the dialog open', async () => {
    const view = mount()
    await flush(20)
    await sendInput('/')
    for (const ch of 'repo:other/x') await sendInput(ch)
    await sendInput('', { return: true })
    await waitForExpectation(() => expect(view.lastFrame()).toMatch(/repo:/i))
    expect(view.lastFrame()).toContain('Search pull requests')
    expect(useGh.mock.calls.filter(c => c[0] === listPRsPage).every(c => !c[1][1].search)).toBe(true)
  })

  it('an empty query clears the search', async () => {
    const view = mount()
    await flush(20)
    await sendInput('/')
    for (const ch of 'foo') await sendInput(ch)
    await sendInput('', { return: true })
    await waitForExpectation(() => expect(view.lastFrame()).toContain('/ foo'))
    await sendInput('/')
    for (let i = 0; i < 3; i++) await sendInput('', { backspace: true })
    await sendInput('', { return: true })
    await waitForExpectation(() => expect(view.lastFrame()).not.toContain('/ foo'))
  })
})
