import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { IssueList } from './list.jsx'
import { IssueDetail } from './detail.jsx'
import { useGh } from '../../hooks/useGh.js'
import { getIssue, listIssues, listLabels, listCollaborators, addLabels, removeLabels, addIssueAssignees, removeIssueAssignees, addIssueComment } from '../../executor.js'
import { sendInput } from '../../test/input-bus.js'
import { cleanup, flush, renderWithProviders, waitForExpectation } from '../../test/test-helpers.jsx'

vi.mock('ink', async () => {
  const React = await import('react')
  return { ...await vi.importActual('ink'), useInput: (await import('../../test/input-bus.js')).mockUseInput(React) }
})
vi.mock('../../hooks/useGh.js', () => ({ useGh: vi.fn() }))
vi.mock('../../executor.js', () => ({
  getIssue: vi.fn(), listIssues: vi.fn(), listLabels: vi.fn(), listCollaborators: vi.fn(),
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

beforeEach(() => {
  vi.clearAllMocks()
  useGh.mockImplementation(fn => ({
    data: fn === listIssues ? [issue] : fn === getIssue ? issue
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
