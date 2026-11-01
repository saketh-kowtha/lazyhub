import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PRList } from './list.jsx'
import { useGh } from '../../hooks/useGh.js'
import { listPRsPage, getPRRow } from '../../executor.js'
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
  ...await original(), listPRsPage: vi.fn(), getPRRow: vi.fn(),
}))

const mk = (number, over = {}) => ({
  number, title: `PR number ${number}`, state: 'OPEN', updatedAt: '2026-06-06T10:00:00Z',
  author: { login: 'a' }, headRefName: `b${number}`, ...over,
})
const rows = (from, to) => Array.from({ length: to - from + 1 }, (_, i) => mk(from + i))

let refetchFirst
beforeEach(() => {
  term.columns = 60
  vi.clearAllMocks(); listPRsPage.mockReset(); getPRRow.mockReset()
  listPRsPage.mockResolvedValue({ items: [], hasNextPage: false, endCursor: null, totalCount: 0 })
  refetchFirst = vi.fn()
  useGh.mockImplementation((fn, deps) => {
    if (fn === listPRsPage) {
      return { data: { items: rows(1, 30).map(r => ({ ...r, state: (deps[1]?.states?.[0] || 'open').toUpperCase() })), hasNextPage: true, endCursor: 'c1', totalCount: 75 }, loading: false, error: null, refetch: refetchFirst }
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

