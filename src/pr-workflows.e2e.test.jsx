import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { __sendInput } from 'ink'
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
import { renderWithProviders, flush, cleanup } from './test/test-helpers.jsx'

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

    await flush(60)
    expect(onOpenDiff).toHaveBeenCalledWith(expect.objectContaining({ number: 42 }))
    expect(onViewComments).toHaveBeenCalled()
    expect(onOpenConflict).toHaveBeenCalled()
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

    await flush(30)
    expect(onOpenActions).toHaveBeenCalledWith('feature/parser')
  })

  it('supports auto-merge, check rerun mode, and closing from PR detail', async () => {
    const view = renderWithProviders(
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
          { input: 'M' },
          { wait: 20 },
          { input: 'c' },
          { wait: 20 },
          { input: 'R' },
          { wait: 20 },
          { key: { escape: true } },
          { wait: 20 },
          { input: 'X' },
          { wait: 20 },
          { key: { leftArrow: true } },
          { key: { return: true } },
        ]} />
      </>
    )

    await flush(180)
    expect(enableAutoMerge).toHaveBeenCalledWith('owner/repo', 42, 'squash')
    expect(rerunCheckRun).toHaveBeenCalledWith('owner/repo', 9001)
    expect(closePR).toHaveBeenCalledWith('owner/repo', 42)
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
          { wait: 20 },
          { input: 'r' },
          { wait: 20 },
          { key: { escape: true } },
          { wait: 20 },
          { input: 'v' },
          { wait: 20 },
          { input: 'A' },
        ]} />
      </>
    )

    await flush(160)
    expect(view.lastFrame()).toContain('AI REVIEW 2 findings')
    expect(onViewComments).toHaveBeenCalled()
    expect(getAICodeReview).toHaveBeenCalledWith(expect.objectContaining({
      prTitle: 'Stabilize parser',
    }))
  })
})
