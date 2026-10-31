import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { IssueList } from './list.jsx'
import { IssueDetail } from './detail.jsx'
import { useGh } from '../../hooks/useGh.js'
import { getIssue, getIssueRow, closeIssue, listIssuesPage, listLabels, listCollaborators, addLabels, removeLabels, addIssueAssignees, removeIssueAssignees, addIssueComment } from '../../executor.js'
import { sendInput } from '../../test/input-bus.js'
import { cleanup, flush, renderWithProviders, waitForExpectation } from '../../test/test-helpers.jsx'

vi.mock('ink', async () => {
  const React = await import('react')
  return { ...await vi.importActual('ink'), useInput: (await import('../../test/input-bus.js')).mockUseInput(React) }
})
vi.mock('../../hooks/useGh.js', () => ({ useGh: vi.fn() }))
vi.mock('../../executor.js', () => ({
  getIssue: vi.fn(), getIssueRow: vi.fn(), listIssuesPage: vi.fn(), listLabels: vi.fn(), listCollaborators: vi.fn(),
  closeIssue: vi.fn(), createIssue: vi.fn(), addLabels: vi.fn(), removeLabels: vi.fn(),
  addIssueAssignees: vi.fn(), removeIssueAssignees: vi.fn(), addIssueComment: vi.fn(),
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
  comments: [{ author: { login: 'reviewer&amp;safe' }, body: 'Comment body', createdAt: '2026-06-06T10:00:00Z' }],
}
const refetch = vi.fn()
const page = (items, extra = {}) => ({ items, hasNextPage: false, endCursor: null, totalCount: items.length, ...extra })

beforeEach(() => {
  vi.clearAllMocks()
  useGh.mockImplementation(fn => ({
    data: fn === listIssuesPage ? page([issue]) : fn === getIssue ? issue
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
    ['list', 'labels', 'l', addLabels, removeLabels, 'bug&amp;safe'],
    ['detail', 'labels', 'l', addLabels, removeLabels, 'bug&amp;safe'],
    ['list', 'assignees', 'A', addIssueAssignees, removeIssueAssignees, 'assignee&amp;safe'],
    ['detail', 'assignees', 'A', addIssueAssignees, removeIssueAssignees, 'assignee&amp;safe'],
  ])('diffs %s %s with raw API identifiers and closes the dialog', async (pane, kind, key, add, remove, current) => {
    const notifyDialog = vi.fn()
    const view = await renderIssue(pane === 'list'
      ? <IssueList repo="owner/repo" onSelectIssue={() => {}} />
      : <IssueDetail repo="owner/repo" issueNumber={11} onBack={() => {}} />,
    { appContext: { notifyDialog } })
    await waitForExpectation(() => expect(view.lastFrame()).toContain('Issue title'))
    await flush(20)
    await sendInput(key)
    await waitForExpectation(() => expect(view.lastFrame()).toContain('Filter:'))
    expect(notifyDialog).toHaveBeenCalledWith(true)
    await sendInput(' ')
    await sendInput('', { downArrow: true })
    await sendInput(' ')
    await sendInput('', { return: true })
    await waitForExpectation(() => {
      const suffix = kind === 'labels' ? ['issue'] : []
      expect(add).toHaveBeenCalledWith('owner/repo', 11, ['new&amp;safe'], ...suffix)
      expect(remove).toHaveBeenCalledWith('owner/repo', 11, [current], ...suffix)
      expect(view.lastFrame()).toContain('Issue title')
      expect(notifyDialog).toHaveBeenLastCalledWith(false)
      expect(refetch).toHaveBeenCalled()
    })
  })

  it.each([
    ['list', 'labels', 'l', addLabels],
    ['detail', 'labels', 'l', addLabels],
    ['list', 'assignees', 'A', addIssueAssignees],
    ['detail', 'assignees', 'A', addIssueAssignees],
  ])('shows an error when a %s %s update fails instead of closing silently', async (pane, kind, key, add) => {
    add.mockRejectedValue(new Error('403 forbidden'))
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
})
