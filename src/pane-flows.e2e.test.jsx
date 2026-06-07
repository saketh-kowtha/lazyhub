import React from 'react'
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { __sendInput } from 'ink'
import { execa } from 'execa'
import { useGh } from './hooks/useGh.js'
import {
  listIssues,
  closeIssue,
  listBranches,
  listPRs,
  deleteBranch,
  listRuns,
  getRunLogs,
  cancelRun,
  listNotifications,
  markNotificationRead,
  markAllNotificationsRead,
  listPRComments,
  resolveThread,
} from './executor.js'
import { IssueList } from './features/issues/list.jsx'
import { BranchList } from './features/branches/index.jsx'
import { ActionList } from './features/actions/index.jsx'
import { NotificationList } from './features/notifications/index.jsx'
import { PRComments } from './features/prs/comments.jsx'
import {
  renderWithProviders,
  flush,
  cleanup,
} from './test/test-helpers.jsx'

const inputHandlers = vi.hoisted(() => new Set())

vi.mock('ink', async () => {
  const React = await import('react')
  const actual = await vi.importActual('ink')
  return {
    ...actual,
    useInput: (handler) => {
      React.useEffect(() => {
        inputHandlers.add(handler)
        return () => inputHandlers.delete(handler)
      }, [handler])
    },
    __sendInput: (input, key = {}) => {
      for (const handler of [...inputHandlers]) handler(input, key)
    },
  }
})

vi.mock('execa', () => ({
  execa: vi.fn(),
}))

vi.mock('./hooks/useGh.js', () => ({
  useGh: vi.fn(),
}))

vi.mock('./executor.js', () => ({
  listIssues: vi.fn(),
  closeIssue: vi.fn(),
  createIssue: vi.fn(),
  listLabels: vi.fn(),
  listCollaborators: vi.fn(),
  addLabels: vi.fn(),
  removeLabels: vi.fn(),
  addIssueAssignees: vi.fn(),
  removeIssueAssignees: vi.fn(),
  listBranches: vi.fn(),
  deleteBranch: vi.fn(),
  listPRs: vi.fn(),
  listRuns: vi.fn(),
  getRunLogs: vi.fn(),
  rerunRun: vi.fn(),
  cancelRun: vi.fn(),
  listNotifications: vi.fn(),
  markNotificationRead: vi.fn(),
  markAllNotificationsRead: vi.fn(),
  listPRComments: vi.fn(),
  resolveThread: vi.fn(),
  replyToComment: vi.fn(),
  editPRComment: vi.fn(),
  deletePRComment: vi.fn(),
}))

function ghResult(data, extra = {}) {
  return { data, loading: false, error: null, refetch: vi.fn(), ...extra }
}

function InputDriver({ events }) {
  React.useEffect(() => {
    let alive = true
    ;(async () => {
      for (const event of events) {
        if (!alive) return
        if (event.wait) {
          await new Promise(resolve => setTimeout(resolve, event.wait))
          continue
        }
        __sendInput(event.input || '', event.key || {})
        await new Promise(resolve => setTimeout(resolve, 0))
      }
    })()
    return () => { alive = false }
  }, [events])

  return null
}

describe('Pane E2E user flows', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    execa.mockResolvedValue({ stdout: 'main', exitCode: 0 })

    useGh.mockImplementation((fn) => {
      if (fn === listIssues) {
        return ghResult([
          {
            number: 11,
            title: 'Crash on startup',
            state: 'OPEN',
            updatedAt: '2026-06-06T10:00:00Z',
            author: { login: 'alice' },
            labels: [],
            assignees: [],
            url: 'https://example.test/issues/11',
          },
        ])
      }

      if (fn === listBranches) {
        return ghResult([
          { name: 'feature-1', protected: false, aheadBy: 1, behindBy: 0 },
          { name: 'main', protected: true, aheadBy: 0, behindBy: 0 },
        ])
      }

      if (fn === listPRs) {
        return ghResult([
          { number: 91, state: 'OPEN', headRefName: 'feature-1' },
        ])
      }

      if (fn === listRuns) {
        return ghResult([
          {
            databaseId: 301,
            workflowName: 'CI',
            headBranch: 'feature-1',
            status: 'completed',
            conclusion: 'failure',
            createdAt: '2026-06-06T10:00:00Z',
          },
        ])
      }

      if (fn === listNotifications) {
        return ghResult([
          {
            id: 'notif-1',
            unread: true,
            reason: 'mention',
            updatedAt: '2026-06-06T10:00:00Z',
            repository: { name: 'lazyhub' },
            subject: { type: 'PullRequest', title: 'Review requested' },
          },
        ])
      }

      if (fn === listPRComments) {
        return ghResult([
          {
            id: 'c1',
            body: 'Please rename this',
            path: 'src/app.jsx',
            line: 42,
            createdAt: '2026-06-06T10:00:00Z',
            user: { login: 'reviewer' },
            threadId: 'PRRT_thread_1',
            threadResolved: false,
          },
          {
            id: 'c2',
            body: 'Will do',
            inReplyToId: 'c1',
            path: 'src/app.jsx',
            line: 42,
            createdAt: '2026-06-06T11:00:00Z',
            user: { login: 'author' },
            threadId: 'PRRT_thread_1',
            threadResolved: false,
          },
        ])
      }

      return ghResult(null)
    })
  })

  afterEach(() => {
    cleanup()
  })

  it('lets a user open and close an issue from the list', async () => {
    closeIssue.mockResolvedValue(undefined)
    const onSelectIssue = vi.fn()
    const view = renderWithProviders(
      <>
        <IssueList repo="owner/repo" onSelectIssue={onSelectIssue} />
        <InputDriver events={[{ key: { return: true } }]} />
      </>
    )

    await flush(20)
    expect(onSelectIssue).toHaveBeenCalledWith(expect.objectContaining({ number: 11 }))

    const closeView = renderWithProviders(
      <>
        <IssueList repo="owner/repo" onSelectIssue={onSelectIssue} />
        <InputDriver events={[
          { input: 'x' },
          { wait: 20 },
          { key: { leftArrow: true } },
          { key: { return: true } },
        ]} />
      </>
    )

    await flush(20)
    expect(closeView.lastFrame()).toContain('Close issue #11')
    await flush(60)
    expect(closeIssue).toHaveBeenCalledWith('owner/repo', 11)
  })

  it('protects the current branch from pointless checkout and requires typed confirmation for deletion', async () => {
    deleteBranch.mockResolvedValue(undefined)

    const currentView = renderWithProviders(
      <>
        <BranchList repo="owner/repo" />
        <InputDriver events={[{ input: 'j' }, { wait: 20 }, { key: { return: true } }]} />
      </>
    )

    await flush(60)
    expect(currentView.lastFrame()).toContain('Already on "main"')
    currentView.unmount()

    const deleteView = renderWithProviders(
      <>
        <BranchList repo="owner/repo" />
        <InputDriver events={[
          { input: 'D' },
          { wait: 100 },
          { input: 'feature-1' },
          { wait: 100 },
          { key: { leftArrow: true } },
          { wait: 60 },
          { key: { return: true } },
        ]} />
      </>
    )

    await flush(320)
    expect(deleteBranch).toHaveBeenCalledWith('owner/repo', 'feature-1')
  })

  it('opens workflow logs and allows cancelling a run', async () => {
    getRunLogs.mockResolvedValue([
      '2026-06-06T10:00:00.000Z boot',
      '##[group]Build',
      'compile',
      '##[endgroup]',
    ].join('\n'))
    cancelRun.mockResolvedValue(undefined)

    const logView = renderWithProviders(
      <>
        <ActionList repo="owner/repo" />
        <InputDriver events={[{ input: 'l' }]} />
      </>
    )

    await flush(20)
    expect(getRunLogs).toHaveBeenCalledWith('owner/repo', 301)
    expect(logView.lastFrame()).toContain('=== Build ===')
    expect(logView.lastFrame()).not.toContain('##[endgroup]')
    logView.unmount()

    const cancelView = renderWithProviders(
      <>
        <ActionList repo="owner/repo" />
        <InputDriver events={[
          { input: 'X' },
          { wait: 20 },
          { key: { leftArrow: true } },
          { key: { return: true } },
        ]} />
      </>
    )

    await flush(80)
    expect(cancelRun).toHaveBeenCalledWith('owner/repo', 301)
  })

  it('routes notifications from the user list and supports mark-all confirmation', async () => {
    markNotificationRead.mockResolvedValue(undefined)
    markAllNotificationsRead.mockResolvedValue(undefined)
    const onNavigateTo = vi.fn()

    const openView = renderWithProviders(
      <>
        <NotificationList repo="owner/repo" onNavigateTo={onNavigateTo} />
        <InputDriver events={[{ key: { return: true } }]} />
      </>
    )
    await flush(20)
    expect(markNotificationRead).toHaveBeenCalledWith('notif-1')
    expect(onNavigateTo).toHaveBeenCalledWith(expect.objectContaining({ id: 'notif-1' }))
    openView.unmount()

    const markAllView = renderWithProviders(
      <>
        <NotificationList repo="owner/repo" onNavigateTo={onNavigateTo} />
        <InputDriver events={[
          { input: 'M' },
          { wait: 60 },
          { key: { leftArrow: true } },
          { wait: 40 },
          { key: { return: true } },
        ]} />
      </>
    )
    await flush(160)
    expect(markAllNotificationsRead).toHaveBeenCalled()
    markAllView.unmount()
  })

  it('supports PR comment filter, jump-to-diff, and resolve thread flows', async () => {
    resolveThread.mockResolvedValue(undefined)
    const onJumpToDiff = vi.fn()
    const filterView = renderWithProviders(
      <>
        <PRComments repo="owner/repo" prNumber={55} onBack={() => {}} onJumpToDiff={onJumpToDiff} />
        <InputDriver events={[{ input: 'f' }]} />
      </>
    )

    await flush(20)
    expect(filterView.lastFrame()).toContain('filter: open')

    const jumpView = renderWithProviders(
      <>
        <PRComments repo="owner/repo" prNumber={55} onBack={() => {}} onJumpToDiff={onJumpToDiff} />
        <InputDriver events={[{ input: 'J' }]} />
      </>
    )
    await flush(20)
    expect(onJumpToDiff).toHaveBeenCalledWith(42)

    const resolveView = renderWithProviders(
      <>
        <PRComments repo="owner/repo" prNumber={55} onBack={() => {}} onJumpToDiff={onJumpToDiff} />
        <InputDriver events={[{ input: 'R' }]} />
      </>
    )
    await flush(20)
    expect(resolveThread).toHaveBeenCalledWith('PRRT_thread_1')
  })
})
