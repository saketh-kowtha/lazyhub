import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { IssueList } from './list.jsx'
import { IssueDetail } from './detail.jsx'
import { useGh } from '../../hooks/useGh.js'
import { getIssueHeader, listIssueTimelinePage, getIssueRow, closeIssue, createIssue, listIssuesPage, listLabels, listCollaborators, editIssueMembers, addIssueComment } from '../../executor.js'
import * as platform from '../../services/platform.js'
import { sendInput } from '../../test/input-bus.js'
import { liveScope } from '../../keyscope.js'
import { cleanup, flush, renderWithProviders, waitForExpectation } from '../../test/test-helpers.jsx'

vi.mock('ink', async () => {
  const React = await import('react')
  return { ...await vi.importActual('ink'), useInput: (await import('../../test/input-bus.js')).mockUseInput(React) }
})
vi.mock('../../hooks/useGh.js', () => ({ useGh: vi.fn() }))
vi.mock('../../services/platform.js', () => ({ openUrl: vi.fn(), copyToClipboard: vi.fn() }))
vi.mock('../../executor.js', async () => ({
  ...await vi.importActual('../../executor/classify.js'),
  collaboratorsTruncated: (await vi.importActual('../../executor/issues.js')).collaboratorsTruncated,
  COLLAB_MAX_ROWS: (await vi.importActual('../../executor/issues.js')).COLLAB_MAX_ROWS,
  getIssueHeader: vi.fn(), listIssueTimelinePage: vi.fn(), getIssueRow: vi.fn(), listIssuesPage: vi.fn(), listLabels: vi.fn(), listCollaborators: vi.fn(),
  closeIssue: vi.fn(), createIssue: vi.fn(), editIssueMembers: vi.fn(), addIssueComment: vi.fn(),
}))

async function renderIssue(ui, options) {
  let view
  await act(async () => { view = renderWithProviders(ui, options) })
  return view
}

const issue = {
  body: '# body&amp;safe\n\n- next&amp;safe',
  number: 11, title: 'Issue title', state: 'OPEN', updatedAt: '2026-06-06T10:00:00Z',
  author: { login: 'author&amp;safe' }, labels: [{ name: 'bug&amp;safe', color: 'ff0000' }],
  assignees: [{ login: 'assignee&amp;safe' }], milestone: { title: 'release&amp;safe' },
}
const timeline = {
  items: [{
    key: 'IC_1', kind: 'comment', id: 1, author: 'reviewer&amp;safe', authorAssociation: 'MEMBER', body: 'Comment body',
    createdAt: '2026-06-06T10:00:00Z', lastEditedAt: null, isMinimized: false, minimizedReason: null,
    viewerCanUpdate: false, viewerCanDelete: false, reactions: [], url: 'https://x/c/1',
  }],
  page: { total: 1, hasNextPage: false, endCursor: 'c1', stalled: false },
  viewer: 'me',
}
const refetch = vi.fn()
const page = (items, extra = {}) => ({ items, hasNextPage: false, endCursor: null, totalCount: items.length, ...extra })

beforeEach(() => {
  vi.clearAllMocks()
  useGh.mockImplementation(fn => ({
    data: fn === listIssuesPage ? page([issue]) : fn === getIssueHeader ? issue : fn === listIssueTimelinePage ? timeline
      : fn === listLabels ? [{ name: 'bug&amp;safe', color: 'ff0000' }, { name: 'new&amp;safe', color: '00ff00' }]
        : fn === listCollaborators ? [{ login: 'assignee&amp;safe' }, { login: 'new&amp;safe' }] : null,
    loading: false, error: null, refetch,
  }))
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })

describe('issue API text sanitization', () => {
  it('sanitizes label names in list rows', async () => {
    const view = await renderIssue(<IssueList repo="owner/repo" onSelectIssue={() => {}} />)
    await waitForExpectation(() => expect(view.lastFrame()).toContain('[bug&safe]'))
    expect(view.lastFrame()).not.toContain('&amp;')
  })

  it('sanitizes detail metadata and comment authors', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    const view = await renderIssue(<IssueDetail repo="owner/repo" issueNumber={11} onBack={() => {}} />)
    await waitForExpectation(() => expect(view.lastFrame()).toContain('reviewer&safe'))
    for (const text of ['author&safe', '@assignee&safe', 'release&safe', 'bug&safe', 'BODY&SAFE', 'next&safe']) {
      expect(view.lastFrame()).toContain(text)
    }
    expect(view.lastFrame()).not.toContain('&amp;')
    expect(errors).not.toHaveBeenCalled()
  })

  it.each([
    ['labels', 'l', 'bug&safe'],
    ['assignees', 'A', 'assignee&safe'],
  ])('sanitizes %s dialog display text', async (_dialog, key, expected) => {
    const view = await renderIssue(<IssueDetail repo="owner/repo" issueNumber={11} onBack={() => {}} />)
    await waitForExpectation(() => expect(view.lastFrame()).toContain('Issue title'))
    await flush(20)
    await sendInput(key)
    await waitForExpectation(() => expect(view.lastFrame()).toContain('Filter:'))
    expect(view.lastFrame()).toContain(expected)
    expect(view.lastFrame()).not.toContain('&amp;')
  })
})

describe('shared issue editor contracts', () => {
  it('opens assignees on the first key without a timer delay', async () => {
    const view = await renderIssue(<IssueList repo="owner/repo" onSelectIssue={() => {}} />)
    await sendInput('A')
    await waitForExpectation(() => expect(view.lastFrame()).toContain('Filter:'))
    expect(view.lastFrame()).toContain('assignee&safe')
  })

  it.each([
    ['list', 'labels', 'l', 'label', 'bug&amp;safe'],
    ['detail', 'labels', 'l', 'label', 'bug&amp;safe'],
    ['list', 'assignees', 'A', 'assignee', 'assignee&amp;safe'],
    ['detail', 'assignees', 'A', 'assignee', 'assignee&amp;safe'],
  ])('diffs %s %s with raw API identifiers in ONE edit call and closes the dialog', async (pane, _kind, key, kind, current) => {
    const view = await renderIssue(pane === 'list'
      ? <IssueList repo="owner/repo" onSelectIssue={() => {}} />
      : <IssueDetail repo="owner/repo" issueNumber={11} onBack={() => {}} />,
    )
    await waitForExpectation(() => expect(view.lastFrame()).toContain('Issue title'))
    await flush(20)
    await sendInput(key)
    await waitForExpectation(() => expect(view.lastFrame()).toContain('Filter:'))
    expect(liveScope()).toBe('dialog')
    await sendInput(' ')
    await sendInput('', { downArrow: true })
    await sendInput(' ')
    await sendInput('', { return: true })
    await waitForExpectation(() => {
      expect(editIssueMembers).toHaveBeenCalledExactlyOnceWith('owner/repo', 11, kind, { add: ['new&amp;safe'], remove: [current] })
      expect(view.lastFrame()).toContain('Issue title')
      expect(liveScope()).not.toBe('dialog')
      expect(refetch).toHaveBeenCalled()
    })
  })

  it.each([
    ['list', 'labels', 'l'],
    ['detail', 'labels', 'l'],
    ['list', 'assignees', 'A'],
    ['detail', 'assignees', 'A'],
  ])('shows an error when a %s %s update fails instead of closing silently', async (pane, kind, key) => {
    editIssueMembers.mockRejectedValue(new Error('403 forbidden'))
    const view = await renderIssue(pane === 'list'
      ? <IssueList repo="owner/repo" onSelectIssue={() => {}} />
      : <IssueDetail repo="owner/repo" issueNumber={11} onBack={() => {}} />)
    await waitForExpectation(() => expect(view.lastFrame()).toContain('Issue title'))
    await flush(20)
    await sendInput(key)
    await waitForExpectation(() => expect(view.lastFrame()).toContain('Filter:'))
    await sendInput('', { downArrow: true })
    await sendInput(' ')
    await sendInput('', { return: true })
    await waitForExpectation(() => expect(view.lastFrame()).toContain(`Updating ${kind} failed: 403 forbidden`))
  })

  it('keeps a label on the issue that the fetched list does not contain instead of stripping it (#513)', async () => {
    useGh.mockImplementation(fn => ({
      data: fn === listIssuesPage ? page([issue]) : fn === listLabels ? [{ name: 'new&amp;safe', color: '00ff00' }] : null,
      loading: false, error: null, refetch,
    }))
    const view = await renderIssue(<IssueList repo="owner/repo" onSelectIssue={() => {}} />)
    await waitForExpectation(() => expect(view.lastFrame()).toContain('Issue title'))
    await flush(20)
    await sendInput('l')
    await waitForExpectation(() => expect(view.lastFrame()).toContain('Filter:'))
    expect(view.lastFrame()).toContain('bug&safe')
    await sendInput(' ')
    await sendInput('', { return: true })
    await waitForExpectation(() => expect(editIssueMembers).toHaveBeenCalledExactlyOnceWith('owner/repo', 11, 'label', { add: ['new&amp;safe'], remove: [] }))
  })

  it('says when the collaborator list stopped at its ceiling (D16)', async () => {
    const many = Array.from({ length: 5000 }, (_, i) => ({ login: `user${i}` }))
    useGh.mockImplementation(fn => ({
      data: fn === listIssuesPage ? page([issue]) : fn === listCollaborators ? many : null,
      loading: false, error: null, refetch,
    }))
    const view = await renderIssue(<IssueList repo="owner/repo" onSelectIssue={() => {}} />)
    await waitForExpectation(() => expect(view.lastFrame()).toContain('Issue title'))
    await flush(20)
    await sendInput('A')
    await waitForExpectation(() => expect(view.lastFrame()).toContain('showing first 5,000 collaborators'))
  })

  it('lets Esc close a picker that is still loading (#513)', async () => {
    useGh.mockImplementation(fn => ({
      data: fn === listIssuesPage ? page([issue]) : null,
      loading: fn === listLabels, error: null, refetch,
    }))
    const view = await renderIssue(<IssueList repo="owner/repo" onSelectIssue={() => {}} />)
    await waitForExpectation(() => expect(view.lastFrame()).toContain('Issue title'))
    await flush(20)
    await sendInput('l')
    await waitForExpectation(() => expect(view.lastFrame()).toContain('Loading labels'))
    await sendInput('', { escape: true })
    await waitForExpectation(() => expect(view.lastFrame()).not.toContain('Loading labels'))
    expect(view.lastFrame()).toContain('Issue title')
  })

  it('shows why options failed to load and retries with r (#513)', async () => {
    const retry = vi.fn()
    const err = Object.assign(new Error('gh: HTTP 401: Bad credentials'), { stderr: 'HTTP 401: Bad credentials' })
    useGh.mockImplementation(fn => ({
      data: fn === listIssuesPage ? page([issue]) : null,
      loading: false, error: fn === listCollaborators ? err : null, refetch: fn === listCollaborators ? retry : refetch,
    }))
    const view = await renderIssue(<IssueList repo="owner/repo" onSelectIssue={() => {}} />)
    await waitForExpectation(() => expect(view.lastFrame()).toContain('Issue title'))
    await flush(20)
    await sendInput('A')
    await waitForExpectation(() => expect(view.lastFrame()).toMatch(/retry/i))
    await sendInput('r')
    expect(retry).toHaveBeenCalled()
    await sendInput('', { escape: true })
    await waitForExpectation(() => expect(view.lastFrame()).not.toMatch(/retry/i))
  })

  it('keeps reply typing out of action handlers and submits through the issue executor', async () => {
    addIssueComment.mockResolvedValue(undefined)
    const view = await renderIssue(<IssueDetail repo="owner/repo" issueNumber={11} onBack={() => {}} />)
    await waitForExpectation(() => expect(view.lastFrame()).toContain('Issue title'))
    await flush(20)
    await sendInput('c')
    await waitForExpectation(() => expect(view.lastFrame()).toContain('Reply:'))
    await sendInput('lAr')
    expect(view.lastFrame()).not.toContain('Filter:')
    expect(refetch).not.toHaveBeenCalled()
    await sendInput('', { return: true })
    await waitForExpectation(() => expect(addIssueComment).toHaveBeenCalledWith('owner/repo', 11, 'lAr'))
  })

  it('keeps the typed text when a second reply is ignored while one is sending (#453)', async () => {
    let release
    addIssueComment.mockReturnValue(new Promise(r => { release = r }))
    const view = await renderIssue(<IssueDetail repo="owner/repo" issueNumber={11} onBack={() => {}} />)
    await waitForExpectation(() => expect(view.lastFrame()).toContain('Issue title'))
    await flush(20)
    await sendInput('c')
    await waitForExpectation(() => expect(view.lastFrame()).toContain('Reply:'))
    await sendInput('first')
    await sendInput('', { return: true })
    await waitForExpectation(() => expect(view.lastFrame()).toContain('Sending reply'))
    await flush(20)
    await sendInput('c')
    await waitForExpectation(() => expect(view.lastFrame()).toContain('Reply:'))
    await sendInput('second')
    await sendInput('', { return: true })
    await waitForExpectation(() => expect(view.lastFrame()).toContain('still in progress'))
    expect(view.lastFrame()).toContain('second')
    expect(addIssueComment).toHaveBeenCalledTimes(1)
    release()
  })

  it('shows a pending status while a reply is being sent (#453)', async () => {
    let release
    addIssueComment.mockReturnValue(new Promise(r => { release = r }))
    const view = await renderIssue(<IssueDetail repo="owner/repo" issueNumber={11} onBack={() => {}} />)
    await waitForExpectation(() => expect(view.lastFrame()).toContain('Issue title'))
    await flush(20)
    await sendInput('c')
    await waitForExpectation(() => expect(view.lastFrame()).toContain('Reply:'))
    await sendInput('hi')
    await sendInput('', { return: true })
    await waitForExpectation(() => expect(view.lastFrame()).toContain('Sending reply'))
    release()
    await waitForExpectation(() => expect(view.lastFrame()).toContain('Reply sent'))
  })
})

describe('issue detail empty reply', () => {
  it.each([['empty', ''], ['whitespace-only', '   ']])('does not post an %s reply and keeps the reply box open', async (_name, text) => {
    addIssueComment.mockResolvedValue(undefined)
    const view = await renderIssue(<IssueDetail repo="owner/repo" issueNumber={11} onBack={() => {}} />)
    await waitForExpectation(() => expect(view.lastFrame()).toContain('Issue title'))
    await flush(20)
    await sendInput('c')
    await waitForExpectation(() => expect(view.lastFrame()).toContain('Reply:'))
    if (text) await sendInput(text)
    await sendInput('', { return: true })
    await flush(20)
    expect(addIssueComment).not.toHaveBeenCalled()
    expect(view.lastFrame()).toContain('Reply:')
    expect(view.lastFrame()).toContain('Reply cannot be empty')
  })
})

describe('issue list cursor after the list shrinks', () => {
  it('keeps a valid selection when a refetch returns fewer issues', async () => {
    const second = { ...issue, number: 12, title: 'Second issue' }
    useGh.mockImplementation(fn => {
      const [data, setData] = React.useState(fn === listIssuesPage ? page([issue, second]) : null)
      return { data, loading: false, error: null, refetch: () => setData(fn === listIssuesPage ? page([issue]) : null) }
    })
    const onSelectIssue = vi.fn()
    const view = renderWithProviders(<IssueList repo="owner/repo" onSelectIssue={onSelectIssue} />)
    await waitForExpectation(() => expect(view.lastFrame()).toContain('Second issue'))
    await flush(20)
    await sendInput('G')
    await sendInput('r')
    await waitForExpectation(() => expect(view.lastFrame()).not.toContain('Second issue'))
    await flush(20)
    await sendInput('', { return: true })
    expect(onSelectIssue).toHaveBeenCalledWith(expect.objectContaining({ number: 11 }))
  })
})

describe('issue list load-more (#506)', () => {
  const mk = (n) => ({ ...issue, number: n, title: `Issue number ${n}` })
  const mountWith = (first) => {
    useGh.mockImplementation(fn => ({
      data: fn === listIssuesPage ? first : null, loading: false, error: null, refetch,
    }))
    return renderWithProviders(<IssueList repo="owner/repo" onSelectIssue={vi.fn()} />)
  }

  it('fetches the next page by cursor once, appends it and shows N of M', async () => {
    listIssuesPage.mockResolvedValue(page([mk(4), mk(5)], { totalCount: 5 }))
    const view = mountWith(page([mk(1), mk(2), mk(3)], { hasNextPage: true, endCursor: 'c1', totalCount: 5 }))
    await waitForExpectation(() => expect(view.lastFrame()).toContain('Issue number 5'))
    expect(listIssuesPage).toHaveBeenCalledTimes(1)
    expect(listIssuesPage).toHaveBeenCalledWith('owner/repo', expect.objectContaining({ after: 'c1' }))
    expect(view.lastFrame()).toContain('Issue number 1')
    expect(view.lastFrame()).toContain('5 of 5')
  })

  it('says the host caps results instead of silently truncating', async () => {
    const view = mountWith(page([mk(1), mk(2)], { totalCount: 1400 }))
    await waitForExpectation(() => expect(view.lastFrame()).toContain('2 of 1400 (GitHub search returns at most 1000)'))
    expect(listIssuesPage).not.toHaveBeenCalled()
  })

  it('reports a failed page without retry looping', async () => {
    listIssuesPage.mockRejectedValue(new Error('boom'))
    const view = mountWith(page([mk(1)], { hasNextPage: true, endCursor: 'c1', totalCount: 9 }))
    await waitForExpectation(() => expect(view.lastFrame()).toContain('Could not load more issues; showing 1 of 9'))
    await flush(30)
    expect(listIssuesPage).toHaveBeenCalledTimes(1)
  })

  it('r after a failed page retries that cursor and keeps the loaded pages', async () => {
    listIssuesPage.mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce(page([mk(4)], { totalCount: 4 }))
    const view = mountWith(page([mk(1), mk(2), mk(3)], { hasNextPage: true, endCursor: 'c1', totalCount: 4 }))
    await waitForExpectation(() => expect(view.lastFrame()).toContain('Could not load more issues'))
    await flush(30)
    await sendInput('r')
    await waitForExpectation(() => expect(view.lastFrame()).toContain('Issue number 4'))
    expect(listIssuesPage).toHaveBeenLastCalledWith('owner/repo', expect.objectContaining({ after: 'c1' }))
    expect(refetch).not.toHaveBeenCalled()
    expect(view.lastFrame()).toContain('Issue number 1')
  })

  it('closing an issue patches that row instead of reloading from page 1', async () => {
    listIssuesPage.mockResolvedValue(page([mk(4), mk(5)], { totalCount: 5 }))
    closeIssue.mockResolvedValue(undefined)
    getIssueRow.mockResolvedValue({ ...mk(5), state: 'CLOSED' })
    const view = mountWith(page([mk(1), mk(2), mk(3)], { hasNextPage: true, endCursor: 'c1', totalCount: 5 }))
    await waitForExpectation(() => expect(view.lastFrame()).toContain('Issue number 5'))
    await flush(30)
    await sendInput('G')
    await flush(20)
    await sendInput('X')
    await waitForExpectation(() => expect(view.lastFrame()).toContain('Close issue #5'))
    await flush(20)
    await sendInput('y')
    await waitForExpectation(() => expect(getIssueRow).toHaveBeenCalledWith('owner/repo', 5))
    await waitForExpectation(() => expect(view.lastFrame()).not.toContain('Issue number 5'))
    expect(view.lastFrame()).toContain('Issue number 4')
    expect(refetch).not.toHaveBeenCalled()
    expect(listIssuesPage).toHaveBeenCalledTimes(1)
  })

  it('shows a pending status for close and ignores a second close while it runs (#453)', async () => {
    let release
    closeIssue.mockReturnValue(new Promise(r => { release = r }))
    getIssueRow.mockResolvedValue({ ...mk(1), state: 'CLOSED' })
    const view = mountWith(page([mk(1), mk(2)], { totalCount: 2 }))
    await waitForExpectation(() => expect(view.lastFrame()).toContain('Issue number 1'))
    await flush(30)
    await sendInput('X')
    await waitForExpectation(() => expect(view.lastFrame()).toContain('Close issue #1'))
    await flush(20)
    await sendInput('y')
    await waitForExpectation(() => expect(view.lastFrame()).toContain('Closing #1'))
    await flush(20)
    await sendInput('X')
    await waitForExpectation(() => expect(view.lastFrame()).toContain('Close issue #1'))
    await flush(20)
    await sendInput('y')
    await waitForExpectation(() => expect(view.lastFrame()).toContain('still in progress'))
    expect(closeIssue).toHaveBeenCalledTimes(1)
    release()
    await waitForExpectation(() => expect(view.lastFrame()).toContain('Closed #1'))
  })
})

describe('issue list opens the browser and clipboard through the platform service (#470)', () => {
  const withUrl = { ...issue, url: 'https://github.com/owner/repo/issues/11' }

  it('o and y call the mockable service, never a process directly', async () => {
    useGh.mockImplementation(fn => ({ data: fn === listIssuesPage ? page([withUrl]) : null, loading: false, error: null, refetch }))
    platform.openUrl.mockResolvedValue(true)
    platform.copyToClipboard.mockResolvedValue(true)
    const view = await renderIssue(<IssueList repo="owner/repo" onSelectIssue={() => {}} />)
    await waitForExpectation(() => expect(view.lastFrame()).toContain('Issue title'))
    await sendInput('o')
    await waitForExpectation(() => expect(platform.openUrl).toHaveBeenCalledWith(withUrl.url))
    await sendInput('y')
    await waitForExpectation(() => expect(platform.copyToClipboard).toHaveBeenCalledWith(withUrl.url))
    await waitForExpectation(() => expect(view.lastFrame()).toContain('Copied'))
  })

  it('shows a failure when the clipboard tool is missing', async () => {
    useGh.mockImplementation(fn => ({ data: fn === listIssuesPage ? page([withUrl]) : null, loading: false, error: null, refetch }))
    platform.copyToClipboard.mockResolvedValue(false)
    const view = await renderIssue(<IssueList repo="owner/repo" onSelectIssue={() => {}} />)
    await waitForExpectation(() => expect(view.lastFrame()).toContain('Issue title'))
    await sendInput('y')
    await waitForExpectation(() => expect(view.lastFrame()).toContain('Copy failed'))
  })
})

describe('new issue form (#468)', () => {
  it('does not submit without a title and says why', async () => {
    const view = await renderIssue(<IssueList repo="owner/repo" onSelectIssue={() => {}} />)
    await waitForExpectation(() => expect(view.lastFrame()).toContain('Issue title'))
    await flush(20)
    await sendInput('n')
    await waitForExpectation(() => expect(view.lastFrame()).toContain('New Issue'))
    await flush(20)
    await sendInput('g', { ctrl: true }) // Ctrl+G submits from any field
    await waitForExpectation(() => expect(view.lastFrame()).toContain('a title is required'))
    expect(createIssue).not.toHaveBeenCalled()
  })
})
