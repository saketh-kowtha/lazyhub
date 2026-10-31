/**
 * focus-repository.test.jsx -- a dashboard section with filter.repo opens its
 * items in that repository, not the launch repository (#493).
 */

import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Text } from 'ink'
import { sendInput } from './test/input-bus.js'
import { App } from './app.jsx'
import { useGh } from './hooks/useGh.js'
import * as executor from './executor.js'
import { disarmPrefix } from './config/keymap.js'
import { resetTabSelection } from './features/tabs/view.jsx'
import { renderWithProviders, flush, cleanup, waitForExpectation } from './test/test-helpers.jsx'

const execaSpy = vi.hoisted(() => vi.fn(() => Object.assign(Promise.resolve({}), { stdin: { end: () => {} } })))
const refetchSpy = vi.hoisted(() => vi.fn())

vi.mock('ink', async () => {
  const React = await import('react')
  const actual = await vi.importActual('ink')
  return {
    ...actual,
    useApp: () => ({ exit: vi.fn() }),
    useInput: (await import('./test/input-bus.js')).mockUseInput(React),
  }
})

vi.mock('execa', () => ({ execa: execaSpy }))
vi.mock('./hooks/useGh.js', () => ({ useGh: vi.fn() }))

vi.mock('./config.js', async () => {
  const actual = await vi.importActual('./config.js')
  const base = actual.loadConfig()
  return {
    ...actual,
    loadConfig: () => ({
      ...base,
      panes: ['focus', 'prs', 'issues'],
      defaultPane: 'focus',
      customTabs: {
        focus: {
          id: 'focus',
          label: 'Focus',
          panes: [
            { kind: 'prs', title: 'Other repository', filter: { repo: 'other/project' } },
            { kind: 'issues', title: 'Other issues', filter: { repo: 'other/project' } },
          ],
        },
      },
    }),
  }
})

vi.mock('./hooks/useLayout.js', () => ({
  useLayout: () => ({
    cols: 80, rows: 40, sidebarWidth: 18, previewWidth: 40, borderStyle: 'round',
    compactFooter: false, showSidebar: false, showPreview: false, listHeight: 30,
  }),
}))
vi.mock('./ipc.js', () => ({ emitIPC: () => {}, startIPC: () => '/tmp/lazyhub.sock' }))
vi.mock('./editor.js', () => ({ openInEditor: vi.fn(), editorLabel: 'Editor' }))
vi.mock('./ai/index.js', () => ({ AIError: class AIError extends Error {}, getAICodeReview: vi.fn() }))
vi.mock('./components/TabStrip.jsx', () => ({ TabStrip: () => <Text>TABS</Text> }))
vi.mock('./components/Toaster.jsx', () => ({ Toaster: () => null }))
vi.mock('./components/StatusBar.jsx', () => ({ StatusBar: () => null }))

vi.mock('./executor.js', () => {
  const fns = [
    'listPRs', 'listIssues', 'getPR', 'getIssue', 'getRepoInfo', 'getPRChecks', 'getBranchProtection',
    'listLabels', 'listCollaborators', 'getCurrentBranch', 'listBranches', 'listRuns',
    'getPRDiff', 'getPRDiffStats', 'listPRComments', 'listPRTimelinePage', 'checkoutBranch',
  ]
  return { ...Object.fromEntries(fns.map(name => [name, vi.fn()])), classifyGhFailure: () => ({ message: 'x' }) }
})

const pr = (number, title, extra = {}) => ({
  number, title, state: 'OPEN', isDraft: false, updatedAt: '2026-06-06T10:00:00Z', url: `https://example.test/pull/${number}`,
  author: { login: 'alice' }, labels: [], assignees: [], reviews: [], reviewRequests: [], files: [], statusCheckRollup: [],
  baseRefName: 'main', headRefName: 'f', headRefOid: 'a'.repeat(40), mergeable: 'MERGEABLE', mergeStateStatus: 'CLEAN', body: `body ${number}`, ...extra,
})
const issue = (number, title) => ({
  number, title, state: 'OPEN', updatedAt: '2026-06-06T10:00:00Z', url: `https://example.test/issues/${number}`,
  author: { login: 'bob' }, labels: [], assignees: [], comments: [], body: `body ${number}`,
})
function ghResult(data) {
  return { data, loading: false, error: null, refetch: refetchSpy, mutate: vi.fn(), isStale: false }
}
const key = (input, flags = {}) => ({ input, key: flags })
const ENTER = key('', { return: true })

async function press(steps) {
  for (const step of steps) {
    await sendInput(step.input, step.key)
    await flush(15)
  }
}

let prExtra = {}
describe('dashboard repository identity (#493)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prExtra = {}
    useGh.mockImplementation((fn, deps = []) => {
      if (fn === executor.listPRs) return ghResult([pr(102, 'Remote repository PR')])
      if (fn === executor.listIssues) return ghResult([issue(302, 'Remote repository issue')])
      if (fn === executor.getPR) return ghResult(pr(deps[1], 'Loaded detail', prExtra))
      if (fn === executor.getIssue) return ghResult(issue(deps[1], 'Loaded issue'))
      if (fn === executor.getRepoInfo) return ghResult({ squashMergeAllowed: true, viewerPermission: 'WRITE' })
      if (fn === executor.getPRChecks) return ghResult([])
      if (fn === executor.getPRDiff) return ghResult('')
      if (fn === executor.listPRComments || fn === executor.listPRTimelinePage) return ghResult(fn === executor.listPRTimelinePage ? { comments: [], conversation: [], threads: { total: 0, hasNextPage: false }, conversationPage: { total: 0, hasNextPage: false } } : [])
      if (fn === executor.getBranchProtection) return ghResult({ requiredReviews: 1 })
      return ghResult(null)
    })
  })
  afterEach(() => { disarmPrefix(); resetTabSelection(); cleanup() })

  it('opens a dashboard PR in the repository configured for its section', async () => {
    const view = renderWithProviders(<App repo="owner/repo" />)
    await waitForExpectation(() => expect(view.lastFrame()).toContain('Remote repository PR'))
    await flush(30)
    await press([ENTER])
    await waitForExpectation(() => expect(useGh).toHaveBeenCalledWith(executor.getPR, ['other/project', 102]))
    expect(useGh).not.toHaveBeenCalledWith(executor.getPR, ['owner/repo', 102])
  })

  it('opens a dashboard issue in the repository configured for its section', async () => {
    const view = renderWithProviders(<App repo="owner/repo" />)
    await waitForExpectation(() => expect(view.lastFrame()).toContain('Remote repository issue'))
    await flush(30)
    await press([key(']'), ENTER])
    await waitForExpectation(() => expect(useGh).toHaveBeenCalledWith(executor.getIssue, ['other/project', 302]))
    expect(useGh).not.toHaveBeenCalledWith(executor.getIssue, ['owner/repo', 302])
  })

  async function openDetail() {
    const view = renderWithProviders(<App repo="owner/repo" />)
    await waitForExpectation(() => expect(view.lastFrame()).toContain('Remote repository PR'))
    await flush(30)
    await press([ENTER])
    await waitForExpectation(() => expect(useGh).toHaveBeenCalledWith(executor.getPR, ['other/project', 102]))
    await flush(30)
    return view
  }

  it('keeps the item repository through diff, comments and Esc back', async () => {
    await openDetail()
    await press([key('d')])
    await waitForExpectation(() => expect(useGh).toHaveBeenCalledWith(executor.getPRDiff, ['other/project', 102]))
    expect(useGh).not.toHaveBeenCalledWith(executor.getPRDiff, ['owner/repo', 102])
    await press([key('v')])
    await waitForExpectation(() => expect(useGh).toHaveBeenCalledWith(executor.listPRTimelinePage, ['other/project', 102]))
    expect(useGh).not.toHaveBeenCalledWith(executor.listPRTimelinePage, ['owner/repo', 102])
    useGh.mockClear()
    await press([key('', { escape: true }), key('', { escape: true })])
    await waitForExpectation(() => expect(useGh).toHaveBeenCalledWith(executor.getPR, ['other/project', 102]))
    expect(useGh).not.toHaveBeenCalledWith(executor.getPR, ['owner/repo', 102])
  })

  it('keeps the comments action after inspecting the diff and returning to detail (#492)', async () => {
    await openDetail()
    await press([key('d')])
    await waitForExpectation(() => expect(useGh).toHaveBeenCalledWith(executor.getPRDiff, ['other/project', 102]))
    await press([key('', { escape: true })])
    await waitForExpectation(() => expect(useGh).toHaveBeenCalledWith(executor.getPR, ['other/project', 102]))
    useGh.mockClear()
    await press([key('v')])
    await waitForExpectation(() => expect(useGh).toHaveBeenCalledWith(executor.listPRTimelinePage, ['other/project', 102]))
  })

  it('opens Actions for the item repository, not the launch repository', async () => {
    await openDetail()
    await press([key('C')])
    await waitForExpectation(() => expect(useGh).toHaveBeenCalledWith(executor.listRuns, ['other/project', { branch: 'f' }]))
    expect(useGh).not.toHaveBeenCalledWith(executor.listRuns, ['owner/repo', { branch: 'f' }])
  })

  it('does not open conflict resolution (local git) for an item of another repository', async () => {
    prExtra = { mergeable: 'CONFLICTING' }
    const view = await openDetail()
    await press([key('C')])
    await flush(30)
    expect(executor.getCurrentBranch).not.toHaveBeenCalled()
    expect(view.lastFrame()).toContain('body 102')
  })
})
