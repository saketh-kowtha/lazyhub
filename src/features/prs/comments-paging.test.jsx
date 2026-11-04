import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PRComments } from './comments.jsx'
import { useGh } from '../../hooks/useGh.js'
import { listPRTimelinePage } from '../../executor.js'
import { timelinePage } from '../../test/timeline.js'
import { sendInput } from '../../test/input-bus.js'
import { cleanup, flush, renderWithProviders, waitForExpectation } from '../../test/test-helpers.jsx'

vi.mock('ink', async () => {
  const React = await import('react')
  return { ...await vi.importActual('ink'), useInput: (await import('../../test/input-bus.js')).mockUseInput(React) }
})
vi.mock('../../hooks/useGh.js', () => ({ useGh: vi.fn() }))
vi.mock('../../executor.js', async (original) => ({ ...await original(), listPRTimelinePage: vi.fn() }))

afterEach(() => { cleanup(); vi.restoreAllMocks() })

const convo = (id) => ({ id, kind: 'conversation', body: `Conv ${id}`, user: { login: `u${id}` }, createdAt: '2026-01-01T00:00:00Z' })
const range = (from, to) => Array.from({ length: to - from + 1 }, (_, i) => convo(from + i))

describe('PR conversation comments and paging (#507)', () => {
  it('shows conversation comments, not only review threads', async () => {
    const thread = { id: 9, body: 'Inline note', path: 'a.js', line: 3, user: { login: 'rev' }, threadId: 'T1', threadResolved: false }
    const data = timelinePage([thread], [convo(1)])
    useGh.mockImplementation(() => ({ data, loading: false, error: null, refetch: vi.fn() }))
    const view = renderWithProviders(<PRComments prNumber={5} repo="o/r" onBack={() => {}} />)
    await waitForExpectation(() => expect(view.lastFrame()).toContain('Conv 1'))
    expect(view.lastFrame()).toContain('Inline note')
    expect(view.lastFrame()).toContain('conversation 1 of 1')
  })

  it('renders only the visible window of 350 comments and loads the next page by cursor', async () => {
    const data = timelinePage([], range(1, 50), { conversationPage: { total: 350, hasNextPage: true, endCursor: 'C50' } })
    useGh.mockImplementation(() => ({ data, loading: false, error: null, refetch: vi.fn() }))
    listPRTimelinePage.mockResolvedValue({
      comments: [], conversation: range(51, 100), threads: { total: 0, hasNextPage: false, endCursor: null },
      conversationPage: { total: 350, hasNextPage: true, endCursor: 'C100' },
    })
    const view = renderWithProviders(<PRComments prNumber={5} repo="o/r" onBack={() => {}} />)
    await waitForExpectation(() => expect(view.lastFrame()).toContain('Conv 1'))
    // Never silent: the header says how much is loaded, and nothing past the window is rendered.
    expect(view.lastFrame()).toContain('conversation 50 of 350')
    expect(view.lastFrame()).not.toContain('Conv 30')
    expect(listPRTimelinePage).not.toHaveBeenCalled()
    await flush(20)
    await sendInput('G')
    await waitForExpectation(() => expect(listPRTimelinePage).toHaveBeenCalledTimes(1))
    expect(listPRTimelinePage).toHaveBeenCalledWith('o/r', 5, expect.objectContaining({
      conversation: true, conversationAfter: 'C50', threads: false,
    }))
    await waitForExpectation(() => expect(view.lastFrame()).toContain('conversation 100 of 350'))
  })

  it('filters to conversation comments with f', async () => {
    const thread = { id: 9, body: 'Inline note', path: 'a.js', line: 3, user: { login: 'rev' }, threadId: 'T1', threadResolved: false }
    const data = timelinePage([thread], [convo(1)])
    useGh.mockImplementation(() => ({ data, loading: false, error: null, refetch: vi.fn() }))
    const view = renderWithProviders(<PRComments prNumber={5} repo="o/r" onBack={() => {}} />)
    await waitForExpectation(() => expect(view.lastFrame()).toContain('Inline note'))
    await flush(20)
    for (let i = 0; i < 3; i++) await sendInput('f')
    await waitForExpectation(() => expect(view.lastFrame()).toContain('filter: conversation'))
    expect(view.lastFrame()).not.toContain('Inline note')
    expect(view.lastFrame()).toContain('Conv 1')
  })
})
