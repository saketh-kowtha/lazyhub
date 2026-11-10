/**
 * V2a acceptance (#597, decision doc 3.1): ACT-GH, the gh calls one write action costs, is exactly the
 * mutation plus its declared targeted refetches. The views run for real (real useGh, real executor,
 * real query client); only the gh process is faked, and its call log is the measurement.
 */

import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { execa } from 'execa'
import { NotificationList } from '../../features/notifications/index.jsx'
import { ActionList } from '../../features/actions/index.jsx'
import { BranchList } from '../../features/branches/index.jsx'
import { IssueList } from '../../features/issues/list.jsx'
import { listNotifications, listRuns, listBranches, listOpenPRBranches, listIssuesPage } from '../../executor.js'
import { queryClient } from '../queryClient.js'
import { ghQueryKey } from '../ghKeys.js'
import { resetGhMemoryCache } from '../../hooks/useGh.js'
import { resetCacheState } from '../../cache.js'
import { loadConfig } from '../../config.js'
import { resetUndeclaredWrites, undeclaredWrites } from '../invalidation.js'
import { sendInput } from '../../test/input-bus.js'
import { cleanup, flush, renderWithProviders, waitForExpectation } from '../../test/test-helpers.jsx'

vi.mock('ink', async () => {
  const React = await import('react')
  return { ...await vi.importActual('ink'), useInput: (await import('../../test/input-bus.js')).mockUseInput(React) }
})
vi.mock('execa', () => ({ execa: vi.fn() }))

const REPO = 'o/r'
const notif = id => ({ id, unread: true, reason: 'mention', updatedAt: '2026-06-06T10:00:00Z', repository: { name: 'repo' }, subject: { title: `Thread ${id}`, type: 'Issue' } })
const run = id => ({ databaseId: id, workflowName: `Workflow ${id}`, headBranch: 'main', status: 'completed', conclusion: 'failure', createdAt: '2026-06-06T10:00:00Z' })
const issue = n => ({ number: n, title: `Issue ${n}`, state: 'OPEN', updatedAt: '2026-06-06T10:00:00Z', author: { login: 'a' }, labels: [], assignees: [], milestone: null, url: `https://github.com/o/r/issues/${n}` })

const issuesCfg = loadConfig().issues
const keys = {
  notifications: () => ghQueryKey(listNotifications, []),
  runs: () => ghQueryKey(listRuns, [REPO, {}]),
  branches: () => ghQueryKey(listBranches, [REPO]),
  prHeads: () => ghQueryKey(listOpenPRBranches, [REPO]),
  issues: () => ghQueryKey(listIssuesPage, [REPO, { state: issuesCfg.defaultFilter, limit: issuesCfg.pageSize, sort: 'default' }]),
}

/** Every gh invocation, as a single string. Reads and writes alike. */
let calls
/** @type {null | ((args: string[]) => any)} */
let reply
let gate

function ghReply(args) {
  const a = args.join(' ')
  if (reply) { const r = reply(args); if (r !== undefined) return r }
  if (a.startsWith('issue view')) return { number: 11, title: 'Issue 11', state: 'CLOSED', url: 'u', updatedAt: 'x', body: '', author: { login: 'a' }, labels: [], assignees: [], milestone: null }
  return ''
}

beforeEach(() => {
  vi.clearAllMocks()
  resetGhMemoryCache(); resetCacheState(); resetUndeclaredWrites()
  calls = []; reply = null; gate = null
  execa.mockImplementation(async (_cmd, args) => {
    if (args[0] === 'remote') return { exitCode: 0, stdout: '' }
    calls.push(args.join(' '))
    if (gate && /--method|rerun|cancel|close/.test(args.join(' '))) await gate
    const out = ghReply(args)
    return { exitCode: 0, stdout: typeof out === 'string' ? out : JSON.stringify(out), stderr: '' }
  })
  // Fresh caches for every view that is NOT on screen: a write must leave them fresh.
  queryClient.setQueryData(keys.runs(), [run(1)])
  queryClient.setQueryData(keys.branches(), [{ name: 'main' }, { name: 'dev' }])
  queryClient.setQueryData(keys.prHeads(), { heads: [], truncated: false })
})
afterEach(() => { cleanup() })

const stamp = key => queryClient.get(JSON.stringify(key))?.timestamp
const writes = () => calls.filter(c => /--method|rerun|cancel|issue close|issue create/.test(c))

async function mount(ui, text) {
  const view = renderWithProviders(ui)
  await waitForExpectation(() => expect(view.lastFrame()).toContain(text))
  await flush(20)
  expect(calls).toEqual([]) // seeded and fresh: the mount costs no gh call
  return view
}

describe('notifications: mark read (ACT-GH = 1)', () => {
  it('costs exactly the mutation, patches the row at once, and leaves Actions and Branches fresh', async () => {
    queryClient.setQueryData(keys.notifications(), Object.assign([notif('1'), notif('2')], { truncated: false, partialError: null }))
    let release
    gate = new Promise(r => { release = r })
    const view = await mount(<NotificationList repo={REPO} onNavigateTo={() => {}} />, 'Thread 1')
    const runsBefore = stamp(keys.runs())
    const branchesBefore = stamp(keys.branches())
    await sendInput('u')
    // Optimistic: the row is gone while the write is still in flight.
    await waitForExpectation(() => expect(view.lastFrame()).not.toContain('Thread 1'))
    expect(view.lastFrame()).toContain('Thread 2')
    expect(calls).toHaveLength(1)
    release()
    await waitForExpectation(() => expect(view.lastFrame()).toContain('Marked as read'))
    await flush(60)
    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatch(/^api notifications\/threads\/1 --method PATCH/)
    expect(stamp(keys.runs())).toBe(runsBefore)
    expect(stamp(keys.branches())).toBe(branchesBefore)
    expect(stamp(keys.notifications())).toBeGreaterThan(0)
    expect(undeclaredWrites()).toEqual([])
  })

  it('rolls the patch back and says so when the write fails', async () => {
    queryClient.setQueryData(keys.notifications(), Object.assign([notif('1'), notif('2')], { truncated: false, partialError: null }))
    execa.mockImplementation(async (_cmd, args) => {
      if (args[0] === 'remote') return { exitCode: 0, stdout: '' }
      calls.push(args.join(' '))
      return args.includes('--method') ? { exitCode: 1, stdout: '', stderr: 'HTTP 403' } : { exitCode: 0, stdout: '', stderr: '' }
    })
    const view = await mount(<NotificationList repo={REPO} onNavigateTo={() => {}} />, 'Thread 1')
    await sendInput('u')
    await waitForExpectation(() => expect(view.lastFrame()).toMatch(/Failed:.*reverted/))
    await waitForExpectation(() => expect(view.lastFrame()).toContain('Thread 1'))
    expect(view.lastFrame()).toContain('Thread 2')
    expect(calls).toHaveLength(1)
    expect(stamp(keys.runs())).toBeGreaterThan(0)
  })

  it('mark-all empties the list at once and refetches nothing', async () => {
    queryClient.setQueryData(keys.notifications(), Object.assign([notif('1'), notif('2')], { truncated: false, partialError: null }))
    const view = await mount(<NotificationList repo={REPO} onNavigateTo={() => {}} />, 'Thread 1')
    await sendInput('U')
    await waitForExpectation(() => expect(view.lastFrame()).toContain('Mark all notifications as read'))
    await sendInput('y')
    await waitForExpectation(() => expect(view.lastFrame()).toContain('All marked as read'))
    await flush(60)
    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatch(/^api notifications --method PUT/)
    expect(view.lastFrame()).not.toContain('Thread 1')
  })

  it('opening a notification marks it read through the same declaration (1 call, no repo-wide invalidation)', async () => {
    queryClient.setQueryData(keys.notifications(), Object.assign([notif('1'), notif('2')], { truncated: false, partialError: null }))
    const onNavigateTo = vi.fn()
    await mount(<NotificationList repo={REPO} onNavigateTo={onNavigateTo} />, 'Thread 1')
    await sendInput('', { return: true })
    await flush(80)
    expect(onNavigateTo).toHaveBeenCalledWith(expect.objectContaining({ id: '1' }))
    expect(calls).toHaveLength(1)
    expect(undeclaredWrites()).toEqual([])
    expect(stamp(keys.runs())).toBeGreaterThan(0)
  })
})

describe('actions: re-run and cancel (ACT-GH = mutation + 1 run-list read)', () => {
  it('re-run patches the row to queued, then reads the run list once', async () => {
    queryClient.setQueryData(keys.runs(), [run(1), run(2)])
    reply = args => (args[0] === 'run' && args[1] === 'list' ? [{ ...run(1), status: 'queued', conclusion: '' }, run(2)] : undefined)
    let release
    gate = new Promise(r => { release = r })
    const view = await mount(<ActionList repo={REPO} />, 'Workflow 1')
    const branchesBefore = stamp(keys.branches())
    expect(view.lastFrame()).toContain('✗')
    await sendInput('r', { ctrl: true })
    await waitForExpectation(() => expect(view.lastFrame()).toContain('Re-run failed jobs'))
    await sendInput('y')
    await waitForExpectation(() => expect(queryClient.getQueryData(keys.runs())[0].status).toBe('queued'))
    expect(calls).toHaveLength(1)
    release()
    await waitForExpectation(() => expect(view.lastFrame()).toContain('Re-run triggered'))
    await waitForExpectation(() => expect(calls).toHaveLength(2))
    await flush(60)
    expect(calls).toHaveLength(2)
    expect(calls[0]).toMatch(/^run rerun 1 /)
    expect(calls[1]).toMatch(/^run list /)
    expect(stamp(keys.branches())).toBe(branchesBefore)
    expect(undeclaredWrites()).toEqual([])
  })

  it('a failed cancel puts the row back', async () => {
    queryClient.setQueryData(keys.runs(), [{ ...run(1), status: 'in_progress', conclusion: null }])
    execa.mockImplementation(async (_cmd, args) => {
      if (args[0] === 'remote') return { exitCode: 0, stdout: '' }
      calls.push(args.join(' '))
      return args[1] === 'cancel' ? { exitCode: 1, stdout: '', stderr: 'HTTP 409' } : { exitCode: 0, stdout: '[]', stderr: '' }
    })
    const view = await mount(<ActionList repo={REPO} />, 'Workflow 1')
    await sendInput('X')
    await waitForExpectation(() => expect(view.lastFrame()).toContain('Cancel run'))
    await sendInput('y')
    await waitForExpectation(() => expect(view.lastFrame()).toMatch(/Failed:.*reverted/))
    expect(queryClient.getQueryData(keys.runs())[0].status).toBe('in_progress')
    expect(calls).toHaveLength(1)
  })
})

describe('branches: delete (ACT-GH = 1, no refetch)', () => {
  it('removes the row at once and refetches nothing', async () => {
    const view = await mount(<BranchList repo={REPO} listHeight={10} />, 'dev')
    const runsBefore = stamp(keys.runs())
    await sendInput('j')
    await sendInput('x', { ctrl: true })
    await waitForExpectation(() => expect(view.lastFrame()).toContain('Delete remote branch'))
    for (const ch of 'dev') await sendInput(ch)
    await sendInput('', { leftArrow: true })
    await sendInput('', { return: true })
    await waitForExpectation(() => expect(view.lastFrame()).toContain('Deleted dev'))
    await flush(60)
    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatch(/^api repos\/o\/r\/git\/refs\/heads\/dev --method DELETE/)
    expect(queryClient.getQueryData(keys.branches()).map(b => b.name)).toEqual(['main'])
    expect(stamp(keys.runs())).toBe(runsBefore)
    expect(stamp(keys.branches())).toBeGreaterThan(0)
    expect(undeclaredWrites()).toEqual([])
  })
})

describe('issues: close (ACT-GH = mutation + 1 issue read)', () => {
  it('marks the cached row closed, then reads just that issue', async () => {
    queryClient.setQueryData(keys.issues(), { items: [issue(11), issue(12)], hasNextPage: false, endCursor: null, totalCount: 2 })
    const view = await mount(<IssueList repo={REPO} onSelectIssue={() => {}} />, 'Issue 11')
    const runsBefore = stamp(keys.runs())
    await sendInput('X')
    await waitForExpectation(() => expect(view.lastFrame()).toContain('Close issue #11'))
    await sendInput('y')
    await waitForExpectation(() => expect(view.lastFrame()).toContain('Closed #11'))
    await waitForExpectation(() => expect(calls).toHaveLength(2))
    await flush(60)
    expect(calls).toHaveLength(2)
    expect(calls[0]).toMatch(/^issue close 11 /)
    expect(calls[1]).toMatch(/^issue view 11 /)
    expect(stamp(keys.runs())).toBe(runsBefore)
    expect(stamp(keys.issues())).toBeGreaterThan(0)
    expect(undeclaredWrites()).toEqual([])
  })
})
