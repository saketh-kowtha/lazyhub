import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Text } from 'ink'
import { InputDriver } from './test/input-driver.jsx'
import { sendInput } from './test/input-bus.js'
import { armPrefix, disarmPrefix } from './config/keymap.js'
import { useActiveScope } from './keyscope.js'
import { useGh } from './hooks/useGh.js'
import {
  getPR,
  getRepoInfo,
  getPRChecks,
  getBranchProtection,
  enableAutoMerge,
  closePR,
  rerunCheckRun,
  getPRDiffStats,
  getPRDiff,
  listPRComments,
  getPR as getPRMeta,
} from './executor.js'
import { getAICodeReview } from './ai/index.js'
import { PRDetail } from './features/prs/detail.jsx'
import { PRDiff } from './features/prs/diff.jsx'
import { renderWithProviders, flush, cleanup, waitForExpectation } from './test/test-helpers.jsx'


vi.mock('ink', async () => {
  const React = await import('react')
  const actual = await vi.importActual('ink')
  return {
    ...actual,
    useInput: (await import('./test/input-bus.js')).mockUseInput(React),
  }
})

vi.mock('./hooks/useGh.js', () => ({
  useGh: vi.fn(),
}))

vi.mock('./executor.js', () => ({
  getPR: vi.fn(),
  getRepoInfo: vi.fn(),
  getPRChecks: vi.fn(),
  getBranchProtection: vi.fn(),
  enableAutoMerge: vi.fn(),
  disableAutoMerge: vi.fn(),
  mergePR: vi.fn(),
  closePR: vi.fn(),
  markPRReady: vi.fn(),
  convertPRToDraft: vi.fn(),
  editPRBase: vi.fn(),
  requestReviewers: vi.fn(),
  removeReviewers: vi.fn(),
  reviewPR: vi.fn(),
  addPRAssignees: vi.fn(),
  removePRAssignees: vi.fn(),
  addLabels: vi.fn(),
  removeLabels: vi.fn(),
  listLabels: vi.fn(),
  listCollaborators: vi.fn(),
  rerunCheckRun: vi.fn(),
  getCheckRunAnnotations: vi.fn(),
  getPRDiffStats: vi.fn(),
  getPRDiff: vi.fn(),
  listPRComments: vi.fn(),
  addPRLineComment: vi.fn(),
  replyToComment: vi.fn(),
  editPRComment: vi.fn(),
  deletePRComment: vi.fn(),
}))

vi.mock('./editor.js', () => ({
  openInEditor: vi.fn(),
  editorLabel: 'Editor',
}))

vi.mock('./ai/index.js', () => ({
  AIError: class AIError extends Error {},
  getAICodeReview: vi.fn(),
}))

vi.mock('./components/AIReviewPane.jsx', async () => {
  const { Text } = await import('ink')
  return {
    AIReviewPane: ({ summary }) => React.createElement(Text, null, `AI REVIEW ${summary}`),
  }
})

function ghResult(data, extra = {}) {
  return { data, loading: false, error: null, refetch: vi.fn(), mutate: vi.fn(), ...extra }
}


describe('PR detail and diff E2E flows', () => {
  let currentPR
  let currentRepoInfo
  let currentChecks
  let currentProtection
  let currentDiffStats
  let currentDiffText
  let currentComments

  beforeEach(() => {
    vi.clearAllMocks()

    currentPR = {
      number: 42,
      title: 'Stabilize parser',
      body: 'Improve parser reliability',
      state: 'OPEN',
      isDraft: false,
      mergeable: 'MERGEABLE',
      mergeStateStatus: 'CLEAN',
      baseRefName: 'main',
      headRefName: 'feature/parser',
      headRefOid: '1234567890123456789012345678901234567890',
      url: 'https://example.test/pr/42',
      files: [{ path: 'src/app.jsx' }],
      labels: [],
      assignees: [],
      reviews: [],
      reviewRequests: [],
      statusCheckRollup: [
        { id: 9001, name: 'CI / test', conclusion: 'FAILURE', url: 'https://example.test/check/1' },
        { id: 9002, name: 'CI / lint', conclusion: 'SUCCESS', url: 'https://example.test/check/2' },
      ],
      author: { login: 'alice' },
      autoMergeRequest: null,
    }
    currentRepoInfo = { squashMergeAllowed: true, viewerPermission: 'WRITE' }
    currentChecks = [
      { id: 9001, name: 'CI / test', conclusion: 'FAILURE', url: 'https://example.test/check/1' },
      { id: 9002, name: 'CI / lint', conclusion: 'SUCCESS', url: 'https://example.test/check/2' },
    ]
    currentProtection = { requiredReviews: 1, requireStatusChecks: true, requiredChecks: ['CI / test'] }
    currentDiffStats = { additions: 20, deletions: 5, changedFiles: 2 }
    currentDiffText = [
      'diff --git a/src/app.jsx b/src/app.jsx',
      '--- a/src/app.jsx',
      '+++ b/src/app.jsx',
      '@@ -1,2 +1,2 @@',
      '-old line',
      '+new line',
      'diff --git a/src/utils.js b/src/utils.js',
      '--- a/src/utils.js',
      '+++ b/src/utils.js',
      '@@ -10,2 +10,2 @@',
      '-before',
      '+after',
    ].join('\n')
    currentComments = [
      {
        id: 'root-1',
        body: 'Please clarify this change',
        path: 'src/app.jsx',
        line: 1,
        createdAt: '2026-06-06T10:00:00Z',
        user: { login: 'reviewer' },
        threadId: 'PRRT_1',
      },
    ]

    useGh.mockImplementation((fn) => {
      if (fn === getPR) return ghResult(currentPR)
      if (fn === getRepoInfo) return ghResult(currentRepoInfo)
      if (fn === getPRChecks) return ghResult(currentChecks)
      if (fn === getBranchProtection) return ghResult(currentProtection)
      if (fn === getPRDiffStats) return ghResult(currentDiffStats)
      if (fn === getPRDiff) return ghResult(currentDiffText)
      if (fn === listPRComments) return ghResult(currentComments, { mutate: vi.fn(), refetch: vi.fn() })
      if (fn === getPRMeta) return ghResult(currentPR)
      return ghResult(null)
    })

    enableAutoMerge.mockResolvedValue(undefined)
    closePR.mockResolvedValue(undefined)
    rerunCheckRun.mockResolvedValue(undefined)
    getAICodeReview.mockResolvedValue({
      summary: '2 findings',
      suggestions: [{ file: 'src/app.jsx', line: 1, comment: 'Consider renaming this variable.' }],
    })
  })

  afterEach(() => {
    cleanup()
  })

  it('routes PR detail to diff, comments, conflict resolver, and branch actions', async () => {
    const onOpenDiff = vi.fn()
    const onViewComments = vi.fn()
    const onOpenConflict = vi.fn()
    const onOpenActions = vi.fn()

    currentPR.mergeable = 'CONFLICTING'
    const conflictView = renderWithProviders(
      <>
        <PRDetail
          repo="owner/repo"
          prNumber={42}
          onBack={() => {}}
          onOpenDiff={onOpenDiff}
          onViewComments={onViewComments}
          onOpenConflict={onOpenConflict}
          onOpenActions={onOpenActions}
        />
        <InputDriver events={[{ input: 'd' }, { input: 'v' }, { input: 'C' }]} />
      </>
    )

    await waitForExpectation(() => {
      expect(onOpenDiff).toHaveBeenCalledWith(expect.objectContaining({ number: 42 }))
      expect(onViewComments).toHaveBeenCalled()
      expect(onOpenConflict).toHaveBeenCalled()
    })
    conflictView.unmount()

    currentPR.mergeable = 'MERGEABLE'
    renderWithProviders(
      <>
        <PRDetail
          repo="owner/repo"
          prNumber={42}
          onBack={() => {}}
          onOpenDiff={onOpenDiff}
          onViewComments={onViewComments}
          onOpenConflict={onOpenConflict}
          onOpenActions={onOpenActions}
        />
        <InputDriver events={[{ input: 'C' }]} />
      </>
    )

    await waitForExpectation(() => expect(onOpenActions).toHaveBeenCalledWith('feature/parser'))
  })

  it('supports auto-merge, check rerun mode, and closing from PR detail', async () => {
    const actionView = renderWithProviders(
      <>
        <PRDetail
          repo="owner/repo"
          prNumber={42}
          onBack={() => {}}
          onOpenDiff={() => {}}
          onViewComments={() => {}}
          onOpenConflict={() => {}}
          onOpenActions={() => {}}
        />
        <InputDriver events={[
          { input: 'm' },
          { input: 'j' },
          { input: 'j' },
          { input: 'j' },
          { input: '', key: { return: true } },
          { input: 'y' },
          { input: 'c' },
          { input: 'r', key: { ctrl: true } },
          { input: 'y' },
        ]} />
      </>
    )

    await waitForExpectation(() => {
      expect(enableAutoMerge).toHaveBeenCalledWith('owner/repo', 42, 'squash')
      expect(rerunCheckRun).toHaveBeenCalledWith('owner/repo', 9001)
    })
    actionView.unmount()

    const closeView = renderWithProviders(
      <>
        <PRDetail
          repo="owner/repo"
          prNumber={42}
          onBack={() => {}}
          onOpenDiff={() => {}}
          onViewComments={() => {}}
          onOpenConflict={() => {}}
          onOpenActions={() => {}}
        />
        <InputDriver events={[
          { input: 'X' },
          { key: { leftArrow: true } },
          { key: { return: true } },
        ]} />
      </>
    )

    await waitForExpectation(() => {
      expect(closePR).toHaveBeenCalledWith('owner/repo', 42)
    }, { timeout: 1500 })
    expect(closeView.lastFrame()).not.toContain('Close PR #42')
    closeView.unmount()
  })

  it('supports comment handoff, inline reply entry, and AI review from PR diff', async () => {
    const onBack = vi.fn()
    const onViewComments = vi.fn()

    const view = renderWithProviders(
      <>
        <PRDiff
          repo="owner/repo"
          prNumber={42}
          onBack={onBack}
          onViewComments={onViewComments}
        />
        <InputDriver events={[
          { input: 'j' },
          { input: 'c' },
          { key: { escape: true } },
          { input: 'v' },
          { input: 'A' },
        ]} />
      </>
    )

    await flush(260)
    expect(view.lastFrame()).toContain('AI REVIEW 2 findings')
    expect(onViewComments).toHaveBeenCalled()
    expect(getAICodeReview).toHaveBeenCalledWith(expect.objectContaining({
      prTitle: 'Stabilize parser',
    }))
  })
})

describe('registry dispatch safety in PR detail', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useGh.mockImplementation((fn) => ghResult(fn === getPR
      ? { number: 42, title: 'Stabilize parser', body: '', state: 'OPEN', isDraft: false, mergeable: 'MERGEABLE', labels: [], assignees: [], reviews: [], reviewRequests: [], statusCheckRollup: [], author: { login: 'alice' }, files: [] }
      : null))
  })
  afterEach(() => { disarmPrefix(); cleanup() })

  function ScopeProbe() {
    return <Text>{`SCOPE ${useActiveScope()}`}</Text>
  }

  it('typed characters in the body search never trigger actions', async () => {
    const view = renderWithProviders(
      <>
        <PRDetail repo="owner/repo" prNumber={42} onBack={() => {}} onOpenDiff={() => {}} />
        <ScopeProbe />
      </>
    )
    await flush(20)
    expect(view.lastFrame()).toContain('SCOPE view')

    await sendInput('/')
    await waitForExpectation(() => expect(view.lastFrame()).toContain('SCOPE input'))
    for (const ch of ['g', 'p', 'a', 'm', 'x']) await sendInput(ch)
    expect(view.lastFrame()).toContain('gpamx')
    expect(view.lastFrame()).not.toMatch(/Approve|Merge pull|Request changes/i)

    await sendInput('', { escape: true })
    await waitForExpectation(() => expect(view.lastFrame()).toContain('SCOPE view'))
  })

  it('an armed g prefix keeps its continuation keys away from the view', async () => {
    const view = renderWithProviders(
      <PRDetail repo="owner/repo" prNumber={42} onBack={() => {}} onOpenDiff={() => {}} />
    )
    await flush(20)

    armPrefix('g', ['a', 'p'])
    await sendInput('a')
    expect(view.lastFrame()).not.toMatch(/Approve/)

    disarmPrefix()
    await sendInput('a')
    await waitForExpectation(() => expect(view.lastFrame()).toMatch(/Approve/))
  })
})
