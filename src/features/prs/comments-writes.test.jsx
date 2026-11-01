import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PRComments } from './comments.jsx'
import { resetGhMemoryCache } from '../../hooks/useGh.js'
import { listPRTimelinePage, listPRThreadReplies, resolveThread, addPRComment } from '../../executor.js'
import { sendInput } from '../../test/input-bus.js'
import { cleanup, flush, renderWithProviders, waitForExpectation } from '../../test/test-helpers.jsx'

// Real useGh on purpose: its refetch identity and cache behave as in the app.
vi.mock('ink', async () => {
  const React = await import('react')
  return { ...await vi.importActual('ink'), useInput: (await import('../../test/input-bus.js')).mockUseInput(React) }
})
vi.mock('../../executor.js', async (original) => ({
  ...await original(),
  listPRTimelinePage: vi.fn(), listPRThreadReplies: vi.fn(), resolveThread: vi.fn(), addPRComment: vi.fn(),
}))

beforeEach(() => { resetGhMemoryCache(); vi.clearAllMocks(); resolveThread.mockResolvedValue({}); addPRComment.mockResolvedValue('') })
afterEach(cleanup)

const info = (over = {}) => ({ total: 0, hasNextPage: false, endCursor: null, stalled: false, ...over })
const convo = (id) => ({ id, kind: 'conversation', body: `Conv ${id}`, user: { login: `u${id}` }, createdAt: '2026-01-01T00:00:00Z' })
const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => convo(a + i))
const review = (id, extra = {}) => ({
  id, body: `Review ${id}`, path: 'a.js', line: 1, user: { login: 'rev' }, createdAt: '2026-01-01T00:00:00Z',
  inReplyToId: null, threadId: 'T1', threadResolved: false, ...extra,
})
const page = (over = {}) => ({
  comments: [], conversation: [], partialThreads: [],
  threads: info({ total: 1 }), conversationPage: info(), ...over,
})
const defer = () => { let resolve; const promise = new Promise(r => { resolve = r }); return { promise, resolve } }

// A distinct PR per test: useGh also seeds from a disk cache that survives resetGhMemoryCache.
let nextPR = 100
async function mount() {
  const prNumber = nextPR++
  const view = renderWithProviders(<PRComments prNumber={prNumber} repo="o/r" onBack={() => {}} />)
  await waitForExpectation(() => expect(view.lastFrame()).not.toContain('Loading comments'))
  await flush(20)
  return view
}

describe('PR comments keep loaded pages across writes (#507)', () => {
  it('a resolve patches the list in place: loaded pages stay and nothing is refetched', async () => {
    listPRTimelinePage
      .mockResolvedValueOnce(page({ conversation: range(1, 3), comments: [review(900)], conversationPage: info({ total: 6, hasNextPage: true, endCursor: 'C3' }) }))
      .mockResolvedValueOnce(page({ conversation: range(4, 6), conversationPage: info({ total: 6 }), threads: info({ total: 1 }) }))
    const view = await mount()
    // The short list pulls the second conversation page by itself.
    await waitForExpectation(() => expect(view.lastFrame()).toContain('conversation 6 of 6'))
    await sendInput('G')
    await flush(20)
    await sendInput('z')
    await waitForExpectation(() => expect(resolveThread).toHaveBeenCalledWith('T1'))
    await waitForExpectation(() => expect(view.lastFrame()).toContain('Thread resolved'))
    await flush(30)
    expect(view.lastFrame()).toContain('conversation 6 of 6')
    expect(view.lastFrame()).toContain('Conv 6')
    expect(listPRTimelinePage).toHaveBeenCalledTimes(2)
  })

  it('a conversation reply appends to the loaded list without dropping pages', async () => {
    listPRTimelinePage.mockResolvedValue(page({ conversation: range(1, 2), conversationPage: info({ total: 2 }), threads: info() }))
    const view = await mount()
    await sendInput('c')
    await waitForExpectation(() => expect(view.lastFrame()).toContain('posts a new PR comment'))
    expect(view.lastFrame()).toContain('@u1')
    await sendInput('', { return: true })
    await waitForExpectation(() => expect(addPRComment).toHaveBeenCalledTimes(1))
    await flush(30)
    expect(listPRTimelinePage).toHaveBeenCalledTimes(1)
  })
})

describe('section paging and selection anchor (#507)', () => {
  it('rows inserted above the selection never move it to another comment', async () => {
    const second = defer()
    listPRTimelinePage
      .mockResolvedValueOnce(page({ conversation: range(1, 20), comments: [review(900)], conversationPage: info({ total: 40, hasNextPage: true, endCursor: 'C20' }) }))
      .mockReturnValueOnce(second.promise)
    const view = await mount()
    await sendInput('G') // on the review thread: below the conversation block, so no page is requested
    await flush(20)
    expect(listPRTimelinePage).toHaveBeenCalledTimes(1)
    await sendInput('k') // last conversation row: near the end of its block, asks for the next page
    await waitForExpectation(() => expect(listPRTimelinePage).toHaveBeenCalledTimes(2))
    expect(listPRTimelinePage.mock.calls[1][2]).toMatchObject({ conversation: true, threads: false, conversationAfter: 'C20' })
    await sendInput('j') // back on the review thread while the page is in flight
    second.resolve(page({ conversation: range(21, 40), conversationPage: info({ total: 40 }), threads: info({ total: 1 }) }))
    await waitForExpectation(() => expect(view.lastFrame()).toContain('conversation 40 of 40'))
    await flush(20)
    await sendInput('z') // resolve acts on the highlighted row: still the review thread, not a conversation row
    await waitForExpectation(() => expect(resolveThread).toHaveBeenCalledWith('T1'))
  })

  it('loads thread pages only near the end of the threads, not while reading the conversation', async () => {
    listPRTimelinePage
      .mockResolvedValueOnce(page({
        conversation: range(1, 20), comments: [review(900)],
        conversationPage: info({ total: 20 }), threads: info({ total: 5, hasNextPage: true, endCursor: 'T1' }),
      }))
      .mockResolvedValueOnce(page({ comments: [review(901, { threadId: 'T2' })], threads: info({ total: 5 }) }))
    const view = await mount()
    expect(listPRTimelinePage).toHaveBeenCalledTimes(1)
    await sendInput('G')
    await waitForExpectation(() => expect(listPRTimelinePage).toHaveBeenCalledTimes(2))
    expect(listPRTimelinePage.mock.calls[1][2]).toMatchObject({ threads: true, conversation: false, threadsAfter: 'T1' })
    await waitForExpectation(() => expect(view.lastFrame()).toContain('threads 2 of 5'))
  })
})

describe('long threads load their replies on demand (#507)', () => {
  it('shows "N more replies" and fetches them when the cursor reaches the row', async () => {
    listPRTimelinePage.mockResolvedValue(page({
      comments: [review(900), review(901, { inReplyToId: 900, body: 'Reply 901' })],
      partialThreads: [{ threadId: 'T1', total: 4, endCursor: 'R2', stalled: false }],
    }))
    listPRThreadReplies.mockResolvedValue({
      comments: [review(902, { inReplyToId: 900, body: 'Reply 902' }), review(903, { inReplyToId: 900, body: 'Reply 903' })],
      page: info({ total: 4 }),
    })
    const view = await mount()
    expect(view.lastFrame()).toContain('2 more replies')
    expect(listPRThreadReplies).not.toHaveBeenCalled()
    await sendInput('G')
    await waitForExpectation(() => expect(listPRThreadReplies).toHaveBeenCalledWith('T1', 'R2'))
    await waitForExpectation(() => expect(view.lastFrame()).toContain('Reply 903'))
    expect(view.lastFrame()).not.toContain('more replies')
  })

  it('says so when GitHub repeats a page cursor instead of looping', async () => {
    listPRTimelinePage.mockResolvedValue(page({
      conversation: range(1, 2), conversationPage: info({ total: 9, stalled: true }),
    }))
    const view = await mount()
    expect(view.lastFrame()).toContain('incomplete')
  })
})

describe('conversation rows (#507)', () => {
  it('hide the edit, delete, resolve and jump hints and prefill the author in the comment prompt', async () => {
    listPRTimelinePage.mockResolvedValue(page({ conversation: range(1, 2), conversationPage: info({ total: 2 }), threads: info() }))
    const view = await mount()
    expect(view.lastFrame()).toContain('comment on PR')
    expect(view.lastFrame()).not.toMatch(/\[e\] edit|\] delete|\[z\] resolve|\[J\] jump/)
    await sendInput('c')
    await waitForExpectation(() => expect(view.lastFrame()).toContain('(posts a new PR comment)'))
    expect(view.lastFrame()).toContain('@u1')
  })
})
