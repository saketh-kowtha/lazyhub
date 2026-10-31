/**
 * keystroke-budgets.e2e.test.jsx -- top tasks held to keystroke budgets (#312).
 *
 * Each flow drives the real App (real PR list, detail, diff and comments views)
 * with the minimum keys, counts the keys a user presses (typed text is reported
 * separately, as in docs/mockups/keymap-canonical.md section 5) and fails when
 * the count exceeds the budget or the task's end state is not reached.
 *
 * The PR list stands in for the review queue (#177, not built yet): per the
 * maintainer decision, the queue is read-only and "approve" is measured
 * queue -> PR detail, i.e. Enter, a, confirm.
 */

import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Text } from 'ink'
import { sendInput } from './test/input-bus.js'
import { App } from './app.jsx'
import { useGh } from './hooks/useGh.js'
import * as executor from './executor.js'
import { disarmPrefix } from './config/keymap.js'
import { renderWithProviders, flush, cleanup, waitForExpectation } from './test/test-helpers.jsx'
import { timelinePage } from './test/timeline.js'

const exitSpy = vi.hoisted(() => vi.fn())
const execaSpy = vi.hoisted(() => vi.fn(() => Object.assign(Promise.resolve({}), { stdin: { end: () => {} } })))

vi.mock('ink', async () => {
  const React = await import('react')
  const actual = await vi.importActual('ink')
  return {
    ...actual,
    useApp: () => ({ exit: exitSpy }),
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
    loadConfig: () => ({ ...base, panes: ['prs', 'issues', 'branches', 'actions', 'notifications'], defaultPane: 'prs' }),
  }
})

const layoutState = vi.hoisted(() => ({ cols: 120 }))
vi.mock('./hooks/useLayout.js', () => ({
  useLayout: () => ({
    cols: layoutState.cols, rows: 30, sidebarWidth: 18, previewWidth: 40, borderStyle: 'round',
    compactFooter: false, showSidebar: false, showPreview: false, listHeight: 12,
  }),
}))
vi.mock('./ipc.js', () => ({ emitIPC: () => {}, startIPC: () => '/tmp/lazyhub.sock' }))
vi.mock('./editor.js', () => ({ openInEditor: vi.fn(), editorLabel: 'Editor' }))
vi.mock('./ai/index.js', () => ({ AIError: class AIError extends Error {}, getAICodeReview: vi.fn() }))
vi.mock('./components/Sidebar.jsx', () => ({ Sidebar: () => <Text>SIDEBAR</Text> }))
vi.mock('./components/TabStrip.jsx', () => ({ TabStrip: () => <Text>TABS</Text> }))
vi.mock('./components/Toaster.jsx', () => ({ Toaster: () => null }))
vi.mock('./components/StatusBar.jsx', () => ({ StatusBar: () => null }))
vi.mock('./features/tabs/view.jsx', () => ({ TabView: () => <Text>TAB VIEW</Text> }))

vi.mock('./executor.js', () => {
  const fns = [
    'listPRs', 'getPR', 'getRepoInfo', 'getPRChecks', 'getBranchProtection', 'getPRDiffStats', 'getPRDiff',
    'listPRComments', 'listPRTimelinePage', 'resolveThread', 'replyToComment', 'editPRComment', 'deletePRComment', 'addPRLineComment',
    'reviewPR', 'mergePR', 'closePR', 'checkoutBranch', 'enableAutoMerge', 'disableAutoMerge', 'markPRReady',
    'convertPRToDraft', 'editPRBase', 'requestReviewers', 'removeReviewers', 'addPRAssignees', 'removePRAssignees',
    'addLabels', 'removeLabels', 'listLabels', 'listCollaborators', 'rerunCheckRun', 'getCheckRunAnnotations',
    'getCurrentBranch', 'createPR', 'listBranches', 'listRuns', 'rerunRun',
  ]
  return Object.fromEntries(fns.map(name => [name, vi.fn()]))
})

const PR = {
  number: 412,
  title: 'Retry in webhook sender',
  body: 'Adds retries.',
  state: 'OPEN',
  isDraft: false,
  mergeable: 'MERGEABLE',
  mergeStateStatus: 'CLEAN',
  baseRefName: 'main',
  headRefName: 'feature/retry',
  headRefOid: '1234567890123456789012345678901234567890',
  url: 'https://example.test/pr/412',
  files: [{ path: 'src/send.js' }],
  labels: [],
  assignees: [],
  reviews: [],
  reviewRequests: [],
  author: { login: 'alice' },
  autoMergeRequest: null,
  statusCheckRollup: [{ id: 9001, name: 'CI / test', conclusion: 'FAILURE', url: 'https://example.test/check/1' }],
}
const RUN = { databaseId: 77, workflowName: 'CI', headBranch: 'main', status: 'completed', conclusion: 'failure', displayTitle: 'CI run', event: 'push', createdAt: '2026-06-06T10:00:00Z', updatedAt: '2026-06-06T10:00:00Z' }
const DIFF = [
  'diff --git a/src/send.js b/src/send.js',
  '--- a/src/send.js',
  '+++ b/src/send.js',
  '@@ -1,2 +1,3 @@',
  ' const a = 1',
  '+const b = 2',
  '+const c = 3',
].join('\n')
const COMMENTS = [{
  id: 'c1', body: 'Please clarify this', path: 'src/send.js', line: 2, createdAt: '2026-06-06T10:00:00Z',
  user: { login: 'bob' }, threadId: 'PRRT_1',
}]

function ghResult(data) {
  return { data, loading: false, error: null, refetch: vi.fn(), mutate: vi.fn(), isStale: false }
}

const key = (input, flags = {}, label = input) => ({ input, key: flags, label, counted: true })
const text = (value) => ({ text: value })
const ENTER = key('', { return: true }, 'Enter')
const CTRL_G = key('g', { ctrl: true }, 'Ctrl+G')

async function press(steps) {
  let count = 0
  for (const step of steps) {
    if (step.text) {
      for (const ch of step.text) await sendInput(ch)
    } else {
      await sendInput(step.input, step.key)
      count += 1
    }
    await flush(15)
  }
  return count
}

// Budgets mirror docs/mockups/keymap-canonical.md section 5, measured from the
// PR list (the queue stand-in) with the first row selected. Typed text is free.
const TASKS = [
  {
    name: 'approve a review-requested PR (queue -> detail)',
    budget: 3,
    steps: [ENTER, key('a'), CTRL_G],
    done: () => expect(executor.reviewPR).toHaveBeenCalledWith('owner/repo', 412, 'approve', ''),
  },
  {
    name: 'open the log of a failing check',
    budget: 3,
    steps: [ENTER, key('c'), ENTER],
    done: () => expect(executor.getCheckRunAnnotations).toHaveBeenCalledWith('owner/repo', 9001),
  },
  {
    name: 'merge a ready PR',
    budget: 4,
    steps: [key('m'), ENTER, ENTER, key('y')],
    done: () => expect(executor.mergePR).toHaveBeenCalledWith('owner/repo', 412, 'merge', ''),
  },
  {
    name: 'read the diff of a requested review',
    budget: 2,
    steps: [key('d')],
    done: (view) => expect(view.lastFrame()).toContain('const b = 2'),
  },
  {
    name: 'request changes with a comment',
    budget: 3,
    steps: [key('x'), text('please fix'), CTRL_G],
    done: () => expect(executor.reviewPR).toHaveBeenCalledWith('owner/repo', 412, 'request-changes', 'please fix'),
  },
  {
    name: 'comment on a diff line (3 + two j to reach the line)',
    budget: 5,
    steps: [key('d'), key('j'), key('j'), key('c'), text('nit'), CTRL_G],
    done: () => expect(executor.addPRLineComment).toHaveBeenCalledWith('owner/repo', 412, expect.objectContaining({ body: 'nit' })),
  },
  {
    name: 'resolve a review thread',
    budget: 3,
    steps: [ENTER, key('v'), key('z')],
    done: () => expect(executor.resolveThread).toHaveBeenCalledWith('PRRT_1'),
  },
  {
    name: 'check out a PR branch',
    budget: 2,
    steps: [key('b'), key('y')],
    done: () => expect(executor.checkoutBranch).toHaveBeenCalled(),
  },
  {
    name: 'open the PR in the browser',
    budget: 1,
    steps: [key('o')],
    done: () => expect(execaSpy).toHaveBeenCalledWith(expect.any(String), ['https://example.test/pr/412']),
  },
]

describe('keystroke budgets', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useGh.mockImplementation((fn) => {
      if (fn === executor.listPRs) return ghResult([PR])
      if (fn === executor.getPR) return ghResult(PR)
      if (fn === executor.getRepoInfo) return ghResult({ squashMergeAllowed: true, viewerPermission: 'WRITE' })
      if (fn === executor.getPRChecks) return ghResult(PR.statusCheckRollup)
      if (fn === executor.getBranchProtection) return ghResult({ requiredReviews: 1 })
      if (fn === executor.getPRDiffStats) return ghResult({ additions: 2, deletions: 0, changedFiles: 1 })
      if (fn === executor.getPRDiff) return ghResult(DIFF)
      if (fn === executor.listPRComments) return ghResult(COMMENTS)
      if (fn === executor.listPRTimelinePage) return ghResult(timelinePage(COMMENTS))
      if (fn === executor.listRuns) return ghResult([RUN])
      return ghResult(null)
    })
    executor.reviewPR.mockResolvedValue(undefined)
    executor.mergePR.mockResolvedValue(undefined)
    executor.resolveThread.mockResolvedValue(undefined)
    executor.checkoutBranch.mockResolvedValue(undefined)
    executor.addPRLineComment.mockResolvedValue(undefined)
    executor.getCheckRunAnnotations.mockResolvedValue([{ level: 'failure', title: 'test', path: 'a.js', line: 1, message: 'boom' }])
  })

  afterEach(() => {
    disarmPrefix()
    cleanup()
  })

  for (const cols of [80, 120]) for (const task of TASKS) {
    it(`${task.name}: at most ${task.budget} keys at ${cols} columns`, async () => {
      layoutState.cols = cols
      const view = renderWithProviders(<App repo="owner/repo" />)
      await waitForExpectation(() => expect(view.lastFrame()).toContain('Retry in webhook sender'))
      await flush(30)

      const count = await press(task.steps)

      await waitForExpectation(() => task.done(view))
      expect(count).toBeLessThanOrEqual(task.budget)
    })
  }
})

// Every write-classified key shows a confirmation (or the review form) first,
// and backing out performs no write. The palette path is covered in
// components/CommandPalette.confirm.test.jsx.
const CTRL_R = key('r', { ctrl: true }, 'Ctrl+R')
const ESC = key('', { escape: true }, 'Esc')
const WRITE_KEYS = [
  { name: 'merge (m)', steps: [key('m'), ENTER, ENTER], cancel: key('n'), write: () => executor.mergePR },
  { name: 'approve (a)', steps: [key('a'), text('lgtm')], cancel: ESC, write: () => executor.reviewPR },
  { name: 'request changes (x)', steps: [key('x'), text('no')], cancel: ESC, write: () => executor.reviewPR },
  { name: 'checkout (b)', steps: [key('b')], cancel: key('n'), write: () => executor.checkoutBranch },
  { name: 'close PR in the list (X)', steps: [key('X')], cancel: key('n'), write: () => executor.closePR },
  { name: 'close PR in detail (X)', steps: [ENTER, key('X')], cancel: key('n'), write: () => executor.closePR },
  { name: 'auto-merge in the list (m picker)', steps: [key('m'), key('j'), key('j'), key('j'), ENTER], cancel: key('n'), write: () => executor.enableAutoMerge, confirmText: 'Enable auto-merge' },
  { name: 'auto-merge in detail (m picker)', steps: [ENTER, key('m'), key('j'), key('j'), key('j'), ENTER], cancel: key('n'), write: () => executor.enableAutoMerge, confirmText: 'Enable auto-merge' },
  { name: 're-run a check (Ctrl+R)', steps: [ENTER, key('c'), CTRL_R], cancel: key('n'), write: () => executor.rerunCheckRun, confirmText: 'Re-run check' },
  { name: 're-run a workflow (Ctrl+R)', steps: [key('g'), key('a'), CTRL_R], cancel: key('n'), write: () => executor.rerunRun, confirmText: 'Re-run failed jobs' },
]

describe('write keys confirm first and cancel does nothing', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    layoutState.cols = 120
    useGh.mockImplementation((fn) => {
      if (fn === executor.listPRs) return ghResult([PR])
      if (fn === executor.getPR) return ghResult(PR)
      if (fn === executor.getRepoInfo) return ghResult({ squashMergeAllowed: true, viewerPermission: 'WRITE' })
      if (fn === executor.getPRChecks) return ghResult(PR.statusCheckRollup)
      if (fn === executor.getBranchProtection) return ghResult({ requiredReviews: 1 })
      if (fn === executor.listPRComments) return ghResult(COMMENTS)
      if (fn === executor.listPRTimelinePage) return ghResult(timelinePage(COMMENTS))
      if (fn === executor.listRuns) return ghResult([RUN])
      return ghResult(null)
    })
    for (const fn of ['reviewPR', 'mergePR', 'closePR', 'checkoutBranch', 'enableAutoMerge', 'rerunCheckRun', 'rerunRun']) {
      executor[fn].mockResolvedValue(undefined)
    }
  })
  afterEach(() => { disarmPrefix(); cleanup() })

  for (const w of WRITE_KEYS) {
    it(`${w.name}: nothing is written on cancel`, async () => {
      const view = renderWithProviders(<App repo="owner/repo" />)
      await waitForExpectation(() => expect(view.lastFrame()).toContain('Retry in webhook sender'))
      await flush(30)
      await press(w.steps)
      if (w.confirmText) await waitForExpectation(() => expect(view.lastFrame()).toContain(w.confirmText))
      expect(w.write()).not.toHaveBeenCalled()
      await press([w.cancel])
      await flush(30)
      expect(w.write()).not.toHaveBeenCalled()
    })
  }

  it('M in the PR list is the merged filter and never opens auto-merge', async () => {
    const view = renderWithProviders(<App repo="owner/repo" />)
    await waitForExpectation(() => expect(view.lastFrame()).toContain('Retry in webhook sender'))
    await flush(30)
    await press([key('M')])
    await flush(30)
    expect(view.lastFrame()).not.toContain('auto-merge on PR')
    expect(executor.enableAutoMerge).not.toHaveBeenCalled()
  })

  it('shows a pending status and ignores a repeat merge until the first settles (#453)', async () => {
    let release
    executor.mergePR.mockImplementation(() => new Promise(resolve => { release = resolve }))
    const view = renderWithProviders(<App repo="owner/repo" />)
    await waitForExpectation(() => expect(view.lastFrame()).toContain('Retry in webhook sender'))
    await flush(30)
    await press([key('m'), ENTER, ENTER, key('y')])
    await waitForExpectation(() => expect(view.lastFrame()).toContain('Merging #'))
    await press([key('m'), ENTER, ENTER, key('y')])
    await flush(30)
    expect(executor.mergePR).toHaveBeenCalledTimes(1)
    release()
    await waitForExpectation(() => expect(view.lastFrame()).toContain('Merged PR #'))
    await press([key('m'), ENTER, ENTER, key('y')])
    await waitForExpectation(() => expect(executor.mergePR).toHaveBeenCalledTimes(2))
    release()
  })

  it('auto-merge writes only after yes', async () => {
    const view = renderWithProviders(<App repo="owner/repo" />)
    await waitForExpectation(() => expect(view.lastFrame()).toContain('Retry in webhook sender'))
    await flush(30)
    await press([key('m'), key('j'), key('j'), key('j'), ENTER, key('y')])
    await waitForExpectation(() => expect(executor.enableAutoMerge).toHaveBeenCalledTimes(1))
  })
})
