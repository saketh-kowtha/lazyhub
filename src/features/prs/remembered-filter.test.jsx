import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PRList } from './list.jsx'
import { useGh } from '../../hooks/useGh.js'
import { listPRsPage } from '../../executor.js'
import { loadState, saveState } from '../../config.js'
import { rememberedPRFilter, rememberPRFilter } from './remembered-filter.js'
import { sendInput } from '../../test/input-bus.js'
import { cleanup, flush, renderWithProviders } from '../../test/test-helpers.jsx'

vi.mock('ink', async () => {
  const React = await import('react')
  const actual = await vi.importActual('ink')
  return { ...actual, useInput: (await import('../../test/input-bus.js')).mockUseInput(React) }
})
vi.mock('../../hooks/useGh.js', () => ({ useGh: vi.fn() }))
vi.mock('../../executor.js', async () => ({
  ...(await vi.importActual('../../executor.js')),
  listPRsPage: vi.fn(), getPRRow: vi.fn(), getPRPreview: vi.fn(), getRepoInfo: vi.fn(),
}))

const ROW = { number: 5, title: 'Fix', state: 'OPEN', author: { login: 'a' }, labels: [], reviewRequests: [], assignees: [], checkSummary: { total: 2, failing: 1, pending: 0 }, mergeable: 'MERGEABLE', url: 'https://example.test/5', updatedAt: '2026-01-01T00:00:00Z' }
const gh = (data) => ({ data, loading: false, error: null, refetch: vi.fn(), isStale: false })

beforeEach(() => {
  saveState({ prFilters: {}, prScope: 'all' })
  useGh.mockImplementation((fn) => (fn === listPRsPage
    ? gh({ items: [ROW], hasNextPage: false, endCursor: null, totalCount: 1 })
    : gh(null)))
})
afterEach(() => cleanup())

describe('remembered PR list filter (#314)', () => {
  it('stores states per repository and ignores unknown values', () => {
    rememberPRFilter('o/a', ['merged', 'open', 'bogus'])
    rememberPRFilter('o/b', ['closed'])
    expect(rememberedPRFilter('o/a')).toEqual(['merged', 'open'])
    expect(rememberedPRFilter('o/b')).toEqual(['closed'])
    expect(rememberedPRFilter('o/none')).toBeNull()
    expect(loadState().prFilters['o/a']).toEqual(['merged', 'open'])
  })

  it('pressing M in the list remembers the filter and the next mount pre-selects it', async () => {
    const first = renderWithProviders(<PRList repo="o/a" listHeight={10} innerWidth={80} onSelectPR={() => {}} onOpenDiff={() => {}} />)
    await flush(20)
    await sendInput('M')
    await flush(20)
    expect(rememberedPRFilter('o/a')?.sort()).toEqual(['merged', 'open'])
    first.unmount?.()
    cleanup()
    const seen = []
    useGh.mockImplementation((fn, args) => {
      if (fn === listPRsPage) seen.push(args[1].states)
      return fn === listPRsPage ? gh({ items: [ROW], hasNextPage: false, endCursor: null, totalCount: 1 }) : gh(null)
    })
    renderWithProviders(<PRList repo="o/a" listHeight={10} innerWidth={80} onSelectPR={() => {}} onOpenDiff={() => {}} />)
    await flush(20)
    expect(seen.at(-1)).toEqual(['merged', 'open'])
  })
})

describe('Enter hands the opener its smart target (#314)', () => {
  it('by default Enter opens the plain detail, even on a failing CI row', async () => {
    const onSelectPR = vi.fn()
    renderWithProviders(<PRList repo="o/a" listHeight={10} innerWidth={80} onSelectPR={onSelectPR} onOpenDiff={() => {}} />)
    await flush(20)
    await sendInput('', { return: true })
    await flush(20)
    expect(onSelectPR).toHaveBeenCalledWith(expect.objectContaining({ number: 5 }), expect.objectContaining({ target: 'conversation' }))
  })

  it('smartEnter = true: failing CI row -> checks-log with a reason', async () => {
    saveState({ smartEnter: true })
    const onSelectPR = vi.fn()
    renderWithProviders(<PRList repo="o/a" listHeight={10} innerWidth={80} onSelectPR={onSelectPR} onOpenDiff={() => {}} />)
    await flush(20)
    await sendInput('', { return: true })
    await flush(20)
    expect(onSelectPR).toHaveBeenCalledWith(expect.objectContaining({ number: 5 }), expect.objectContaining({ target: 'checks-log', reason: expect.stringMatching(/CI failing/) }))
    saveState({ smartEnter: false })
  })

  it('smartEnter = false in [state] keeps the plain open', async () => {
    saveState({ smartEnter: false })
    const onSelectPR = vi.fn()
    renderWithProviders(<PRList repo="o/a" listHeight={10} innerWidth={80} onSelectPR={onSelectPR} onOpenDiff={() => {}} />)
    await flush(20)
    await sendInput('', { return: true })
    await flush(20)
    expect(onSelectPR).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ target: 'conversation' }))
  })
})
