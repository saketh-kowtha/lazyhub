import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { IssueDetail } from './detail.jsx'
import { useGh } from '../../hooks/useGh.js'
import { getIssueHeader, listIssueTimelinePage, addIssueComment, editIssueComment, deleteIssueComment } from '../../executor.js'
import { sendInput } from '../../test/input-bus.js'
import { cleanup, flush, renderWithProviders, waitForExpectation } from '../../test/test-helpers.jsx'

vi.mock('ink', async () => {
  const React = await import('react')
  return { ...await vi.importActual('ink'), useInput: (await import('../../test/input-bus.js')).mockUseInput(React) }
})
vi.mock('../../hooks/useGh.js', () => ({ useGh: vi.fn() }))
vi.mock('../../services/platform.js', () => ({ openUrl: vi.fn(), copyToClipboard: vi.fn(), editTextInEditor: vi.fn() }))
vi.mock('../../executor.js', async () => ({
  ...await vi.importActual('../../executor/classify.js'),
  collaboratorsTruncated: () => false,
  COLLAB_MAX_ROWS: 1000,
  getIssueHeader: vi.fn(), listIssueTimelinePage: vi.fn(), listLabels: vi.fn(), listCollaborators: vi.fn(),
  editIssueMembers: vi.fn(), addIssueComment: vi.fn(), editIssueComment: vi.fn(), deleteIssueComment: vi.fn(),
}))

const issue = {
  body: 'Description text', number: 11, title: 'Issue title', state: 'OPEN', updatedAt: '2026-06-06T10:00:00Z', url: 'https://x/issues/11',
  author: { login: 'author' }, labels: [], assignees: [], milestone: null,
}
const comment = (n, over = {}) => ({
  key: `IC_${n}`, kind: 'comment', id: n, author: 'alice', authorAssociation: 'NONE', body: `comment ${n}`, url: `https://x/c/${n}`,
  createdAt: '2026-06-06T10:00:00Z', lastEditedAt: null, isMinimized: false, minimizedReason: null,
  viewerCanUpdate: false, viewerCanDelete: false, reactions: [], ...over,
})
const labeled = { key: 'L1', kind: 'event', type: 'labeled', actor: 'bob', createdAt: '2026-06-06T10:00:00Z', label: 'bug', color: 'f00' }
const closedByPR = { key: 'X1', kind: 'event', type: 'closed', actor: 'bob', createdAt: '2026-06-06T10:00:00Z', stateReason: 'COMPLETED', closer: { type: 'pr', number: 9, title: 'Fix it', url: 'u' } }
const pageInfo = (total, hasNextPage = false, endCursor = 'c1') => ({ total, hasNextPage, endCursor, stalled: false })

let first
const refetchHeader = vi.fn()
const refetchFirst = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
  first = { items: [comment(1, { authorAssociation: 'MEMBER', reactions: [{ content: 'THUMBS_UP', label: '+1', count: 2 }] }), labeled, comment(3, { author: 'me', viewerCanUpdate: true, viewerCanDelete: true })], page: pageInfo(3), viewer: 'me' }
  useGh.mockImplementation((fn) => {
    if (fn === getIssueHeader) return { data: issue, loading: false, error: null, refetch: refetchHeader }
    if (fn === listIssueTimelinePage) return { data: first, loading: false, error: null, refetch: refetchFirst }
    return { data: [], loading: false, error: null, refetch: vi.fn() }
  })
  listIssueTimelinePage.mockResolvedValue({ items: [], page: pageInfo(3), viewer: 'me' })
})
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks() })

async function open() {
  let view
  await act(async () => { view = renderWithProviders(<IssueDetail repo="owner/repo" issueNumber={11} onBack={() => {}} />) })
  await waitForExpectation(() => expect(view.lastFrame()).toContain('comment 3'))
  await flush(20)
  return view
}
const down = async n => { for (let i = 0; i < n; i++) { await sendInput('j'); await flush(5) } }

describe('issue timeline (#565)', () => {
  it('shows comments and events in order with the count, badge, reactions and the closing PR', async () => {
    first.items.push(closedByPR)
    first.page = pageInfo(4)
    const view = await open()
    const frame = view.lastFrame()
    expect(frame.indexOf('comment 1')).toBeLessThan(frame.indexOf('added the bug label'))
    expect(frame.indexOf('added the bug label')).toBeLessThan(frame.indexOf('comment 3'))
    expect(frame).toContain('member')
    expect(frame).toContain('+1 2')
    expect(frame).toContain('4 of 4 timeline items')
    await sendInput('G')
    await waitForExpectation(() => expect(view.lastFrame()).toContain('closed this as completed via #9 Fix it'))
  })

  it('marks edited and hidden comments with their reason and sanitizes every string', async () => {
    first.items = [comment(1, { author: 'al&amp;ice', lastEditedAt: '2026-06-07T00:00:00Z', body: 'x&amp;y' }), comment(2, { isMinimized: true, minimizedReason: 'SPAM', body: 'secret spam body' })]
    first.page = pageInfo(2)
    let view
    await act(async () => { view = renderWithProviders(<IssueDetail repo="owner/repo" issueNumber={11} onBack={() => {}} />) })
    await waitForExpectation(() => expect(view.lastFrame()).toContain('x&y'))
    const frame = view.lastFrame()
    expect(frame).toContain('@al&ice')
    expect(frame).toContain('(edited)')
    expect(frame).toContain('hidden: spam')
    expect(frame).not.toContain('secret spam body')
    expect(frame).not.toContain('&amp;')
  })

  it('quote-replies to the selected comment with > lines and a link', async () => {
    addIssueComment.mockResolvedValue(undefined)
    const view = await open()
    await down(1) // description -> comment 1
    await sendInput('Q')
    await waitForExpectation(() => expect(view.lastFrame()).toContain('Reply:'))
    expect(view.lastFrame()).toContain('@alice wrote ([link](https://x/c/1))')
    expect(view.lastFrame()).toContain('> comment 1')
    await sendInput('thanks')
    await sendInput('', { return: true })
    await waitForExpectation(() => expect(addIssueComment).toHaveBeenCalledOnce())
    expect(addIssueComment.mock.calls[0][2]).toBe('@alice wrote ([link](https://x/c/1)):\n\n> comment 1\n\nthanks')
  })

  it('edits only your own comment through the executor', async () => {
    editIssueComment.mockResolvedValue({})
    const view = await open()
    await down(1)
    await sendInput('e')
    await waitForExpectation(() => expect(view.lastFrame()).toContain('only edit your own'))
    await down(2) // event, then my comment
    await sendInput('e')
    await waitForExpectation(() => expect(view.lastFrame()).toContain('Edit comment:'))
    await sendInput(' more')
    await sendInput('', { return: true })
    await waitForExpectation(() => expect(editIssueComment).toHaveBeenCalledWith('owner/repo', 3, 'comment 3 more'))
    await waitForExpectation(() => expect(view.lastFrame()).toContain('Comment updated'))
  })

  it('delete asks first, defaults to No, and only y deletes', async () => {
    deleteIssueComment.mockResolvedValue({})
    const view = await open()
    await down(3)
    await sendInput('x', { ctrl: true })
    await waitForExpectation(() => expect(view.lastFrame()).toContain('Delete your comment?'))
    await sendInput('', { return: true })
    await waitForExpectation(() => expect(view.lastFrame()).not.toContain('Delete your comment?'))
    expect(deleteIssueComment).not.toHaveBeenCalled()
    await sendInput('x', { ctrl: true })
    await waitForExpectation(() => expect(view.lastFrame()).toContain('Delete your comment?'))
    await sendInput('y')
    await waitForExpectation(() => expect(deleteIssueComment).toHaveBeenCalledWith('owner/repo', 3))
    await waitForExpectation(() => expect(view.lastFrame()).toContain('Comment deleted'))
    expect(view.lastFrame()).not.toContain('comment 3')
  })

  it('refuses to delete someone else\'s comment', async () => {
    const view = await open()
    await down(1)
    await sendInput('x', { ctrl: true })
    await waitForExpectation(() => expect(view.lastFrame()).toContain('only delete your own'))
    expect(deleteIssueComment).not.toHaveBeenCalled()
  })

  it('pages by cursor near the end and never refetches the first page', async () => {
    first.page = pageInfo(5, true, 'cur1')
    listIssueTimelinePage.mockResolvedValue({ items: [comment(4), comment(5)], page: pageInfo(5, false, 'cur2'), viewer: 'me' })
    const view = await open()
    await waitForExpectation(() => expect(listIssueTimelinePage).toHaveBeenCalledTimes(1))
    expect(listIssueTimelinePage).toHaveBeenCalledWith('owner/repo', 11, { after: 'cur1' })
    await waitForExpectation(() => expect(view.lastFrame()).toContain('5 of 5 timeline items'))
    await flush(30)
    expect(listIssueTimelinePage).toHaveBeenCalledTimes(1)
    expect(refetchFirst).not.toHaveBeenCalled()
  })
})

describe('issue timeline live updates (#565)', () => {
  it('revalidates only the first page on the interval, never while a compose box is open', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    await open()
    await act(async () => { vi.advanceTimersByTime(31_000) })
    expect(refetchFirst).toHaveBeenCalledTimes(1)
    expect(listIssueTimelinePage).not.toHaveBeenCalled()
    await sendInput('c')
    await flush(20)
    await act(async () => { vi.advanceTimersByTime(31_000) })
    expect(refetchFirst).toHaveBeenCalledTimes(1)
  })

  it('announces new comments with a marker instead of inserting them, and n loads them', async () => {
    const view = await open()
    await sendInput('G')
    await flush(20)
    const before = view.lastFrame()
    first = { ...first, page: pageInfo(5) }
    await act(async () => { view.rerender(<IssueDetail repo="owner/repo" issueNumber={11} onBack={() => {}} />) })
    await waitForExpectation(() => expect(view.lastFrame()).toContain('2 new comments'))
    expect(view.lastFrame()).not.toContain('comment 4')
    expect(before).toContain('comment 3')
    listIssueTimelinePage.mockResolvedValue({ items: [comment(4), comment(5)], page: pageInfo(5, false, 'c9'), viewer: 'me' })
    await sendInput('n')
    await waitForExpectation(() => expect(view.lastFrame()).toContain('5 of 5 timeline items'))
    expect(listIssueTimelinePage).toHaveBeenCalledWith('owner/repo', 11, { after: 'c1' })
    expect(view.lastFrame()).not.toContain('new comment')
  })
})
