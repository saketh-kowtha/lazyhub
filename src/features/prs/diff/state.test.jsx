import React, { act, useEffect } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useGh } from '../../../hooks/useGh.js'
import { getPR, getRepoInfo, getPRDiffStats, getPRDiff, listPRCommentsPage, mergePR, reviewPR, replyToComment, deletePRComment } from '../../../executor.js'
import { firstActionKey } from '../../../config/actions.js'
import { sendInput } from '../../../test/input-bus.js'
import { cleanup, renderWithProviders, waitForExpectation } from '../../../test/test-helpers.jsx'
import { useDiffState } from './state.js'
import { DiffView } from './render.jsx'
import { buildTreeRows } from './tree.js'

vi.mock('ink', async () => ({
  ...await vi.importActual('ink'),
  useInput: (await import('../../../test/input-bus.js')).mockUseInput(await import('react')),
}))
vi.mock('../../../hooks/useGh.js', () => ({ useGh: vi.fn() }))
vi.mock('../../../executor.js', () => ({
  getPR: vi.fn(), getRepoInfo: vi.fn(), getPRDiffStats: vi.fn(), getPRDiff: vi.fn(),
  listPRCommentsPage: vi.fn(), mergePR: vi.fn(), addPRLineComment: vi.fn(),
  replyToComment: vi.fn(), editPRComment: vi.fn(), deletePRComment: vi.fn(), reviewPR: vi.fn(),
}))

const DIFF = [
  'diff --git a/src/code.js b/src/code.js',
  '@@ -1 +1 @@',
  '-oldValue',
  '+newValue',
  'diff --git a/docs/guide.md b/docs/guide.md',
  '@@ -0,0 +1 @@',
  '+guide text',
].join('\n')

let currentState
function DiffSession(props) {
  const state = useDiffState(props)
  useEffect(() => { currentState = state })
  return <DiffView prNumber={props.prNumber} state={state} />
}

function mountSession() {
  const onBack = vi.fn()
  const notifyDialog = vi.fn()
  const view = renderWithProviders(
    <DiffSession repo="owner/repo" prNumber={42} onBack={onBack} onViewComments={() => {}} />,
    { appContext: { notifyDialog } },
  )
  return { view, onBack, notifyDialog }
}

beforeEach(() => {
  vi.clearAllMocks()
  currentState = null
  mergePR.mockResolvedValue(undefined)
  useGh.mockImplementation(fn => ({
    data: fn === getPRDiff ? DIFF
      : fn === getPR ? { title: 'Diff contracts', state: 'OPEN', headRefOid: 'a'.repeat(40) }
      : fn === getRepoInfo ? { viewerPermission: 'ADMIN' }
      : fn === getPRDiffStats ? { additions: 2, deletions: 1, changedFiles: 2 }
      : fn === listPRCommentsPage ? { comments: [], truncated: false } : null,
    loading: false, error: null, refetch: vi.fn(), mutate: vi.fn(),
  }))
})
afterEach(cleanup)

describe('diff state and render contracts', () => {
  it('keeps unified line numbers and pairs adjacent deletions/additions in split view', async () => {
    const { view } = mountSession()
    await waitForExpectation(() => expect(currentState?.rows).toHaveLength(7))
    expect(view.lastFrame()).toContain('newValue')
    expect(view.lastFrame()).toMatch(/1│\s+- oldValue/)
    expect(view.lastFrame()).toMatch(/│\s+1 \+ newValue/)

    await sendInput(firstActionKey('diff.split'))
    await waitForExpectation(() => expect(view.lastFrame()).toContain('[split]'))
    expect(view.lastFrame().split('\n').some(line => /oldValue.*│.*newValue/.test(line))).toBe(true)
    expect(view.lastFrame()).toContain('unified')
  })

  it('says so when the inline comments are only the first page (#507)', async () => {
    const partial = { comments: [], truncated: { threads: true, replies: false } }
    const base = useGh.getMockImplementation()
    useGh.mockImplementation(fn => (fn === listPRCommentsPage ? { ...base(fn), data: partial } : base(fn)))
    const { view } = mountSession()
    await waitForExpectation(() => expect(view.lastFrame()).toContain('inline comments incomplete'))
  })

  it('maps the file tree back to diff rows and releases overlay scope on selection', async () => {
    const { view, notifyDialog } = mountSession()
    await waitForExpectation(() => expect(currentState?.rows).toHaveLength(7))
    await sendInput(firstActionKey('diff.tree'))
    await waitForExpectation(() => expect(view.lastFrame()).toContain('Files'))
    expect(notifyDialog).toHaveBeenLastCalledWith(true)
    for (let i = 0; i < 3; i++) await sendInput('j')
    await sendInput('', { return: true })
    await waitForExpectation(() => expect(currentState.cursor).toBe(4))
    expect(currentState.rows[currentState.cursor].filename).toBe('docs/guide.md')
    expect(currentState.showTree).toBe(false)
    expect(notifyDialog).toHaveBeenLastCalledWith(false)
  })

  it('admin bypass keeps the message, waits for a confirm and needs the PR number typed', async () => {
    const { view, onBack } = mountSession()
    await waitForExpectation(() => expect(currentState).not.toBeNull())
    currentState.submitMerge({ value: 'admin-squash', text: 'reviewed change' })
    await waitForExpectation(() => expect(view.lastFrame()).toContain('ADMIN BYPASS'))
    expect(view.lastFrame()).toContain('Type 42 to confirm')
    expect(view.lastFrame()).not.toMatch(/--admin|--squash/)
    expect(mergePR).not.toHaveBeenCalled()
    expect(currentState.mergeChoice).toEqual({ strategy: 'admin-squash', msg: 'reviewed change' })

    currentState.confirmMerge()
    await waitForExpectation(() => expect(onBack).toHaveBeenCalledOnce())
    expect(mergePR).toHaveBeenCalledExactlyOnceWith('owner/repo', 42, 'admin-squash', 'reviewed change', { allowAdmin: true })
  })

  it('m then Enter then Enter never merges: the confirm defaults to No (#468)', async () => {
    const { view } = mountSession()
    await waitForExpectation(() => expect(currentState?.rows).toHaveLength(7))
    await sendInput('m')
    await waitForExpectation(() => expect(view.lastFrame()).toContain('Merge PR #42'))
    expect(view.lastFrame()).toContain('Squash and merge')
    await sendInput('', { return: true })
    await waitForExpectation(() => expect(view.lastFrame()).toContain('Merge PR #42 via Squash and merge?'))
    await sendInput('', { return: true })
    await sendInput('', { return: true })
    expect(mergePR).not.toHaveBeenCalled()
  })

  it('m, Enter, y merges with the preferred method (#468)', async () => {
    const { view, onBack } = mountSession()
    await waitForExpectation(() => expect(currentState?.rows).toHaveLength(7))
    await sendInput('m')
    await waitForExpectation(() => expect(view.lastFrame()).toContain('Merge PR #42'))
    await sendInput('', { return: true })
    await waitForExpectation(() => expect(view.lastFrame()).toContain('via Squash and merge?'))
    await sendInput('y')
    await waitForExpectation(() => expect(onBack).toHaveBeenCalledOnce())
    expect(mergePR).toHaveBeenCalledExactlyOnceWith('owner/repo', 42, 'squash', undefined, undefined)
  })

  it('shows a pending status and ignores a second merge while one is in flight (#453)', async () => {
    let release
    mergePR.mockReturnValue(new Promise(r => { release = r }))
    const { onBack } = mountSession()
    await waitForExpectation(() => expect(currentState).not.toBeNull())
    currentState.submitMerge('squash')
    await waitForExpectation(() => expect(currentState.mergeChoice).toEqual({ strategy: 'squash', msg: undefined }))
    currentState.confirmMerge()
    await waitForExpectation(() => expect(currentState.commentStatus).toContain('Merging #42'))
    currentState.submitMerge('squash')
    await waitForExpectation(() => expect(currentState.mergeChoice).toBeTruthy())
    currentState.confirmMerge()
    await waitForExpectation(() => expect(currentState.commentStatus).toContain('still in progress'))
    expect(mergePR).toHaveBeenCalledTimes(1)
    release()
    await waitForExpectation(() => expect(onBack).toHaveBeenCalledOnce())
  })

  it('guards diff comment writes: pending status, one call, text kept when ignored (#453)', async () => {
    let release
    replyToComment.mockReturnValue(new Promise(r => { release = r }))
    mountSession()
    await waitForExpectation(() => expect(currentState).not.toBeNull())
    const submit = () => sendInput('', { ctrl: true, return: true })
    await act(async () => { currentState.setCompose({ mode: 'reply', rootCommentId: 3, body: 'first' }) })
    await submit()
    await waitForExpectation(() => expect(currentState.commentStatus).toContain('Sending reply'))
    await act(async () => { currentState.setCompose({ mode: 'reply', rootCommentId: 3, body: 'second' }) })
    await submit()
    await waitForExpectation(() => expect(currentState.commentStatus).toContain('still in progress'))
    expect(replyToComment).toHaveBeenCalledTimes(1)
    expect(currentState.compose?.body).toBe('second')
    release()
    await waitForExpectation(() => expect(currentState.commentStatus).toBe('Reply sent'))
  })

  it('guards comment delete and closes the confirm when ignored (#453)', async () => {
    let release
    deletePRComment.mockReturnValue(new Promise(r => { release = r }))
    mountSession()
    await waitForExpectation(() => expect(currentState).not.toBeNull())
    await act(async () => { currentState.setCompose({ mode: 'delete', commentId: 9 }) })
    await sendInput('y')
    await waitForExpectation(() => expect(currentState.commentStatus).toContain('Deleting comment'))
    await act(async () => { currentState.setCompose({ mode: 'delete', commentId: 10 }) })
    await sendInput('y')
    await waitForExpectation(() => expect(currentState.commentStatus).toContain('still in progress'))
    expect(deletePRComment).toHaveBeenCalledTimes(1)
    expect(currentState.compose).toBeNull()
    release()
    await waitForExpectation(() => expect(currentState.commentStatus).toBe('Deleted'))
  })

  it('shows a pending status and submits a review once (#453)', async () => {
    let release
    reviewPR.mockReturnValue(new Promise(r => { release = r }))
    mountSession()
    await waitForExpectation(() => expect(currentState).not.toBeNull())
    currentState.submitApproval({ body: 'ok' })
    await waitForExpectation(() => expect(currentState.commentStatus).toContain('Approving'))
    currentState.submitChanges({ body: 'no' })
    await waitForExpectation(() => expect(currentState.commentStatus).toContain('still in progress'))
    expect(reviewPR).toHaveBeenCalledTimes(1)
    release()
    await waitForExpectation(() => expect(currentState.commentStatus).toContain('Approved'))
  })
})

it('builds an ordered tree without changing the parser file records', () => {
  const files = [
    { filename: 'src/a.js', addCount: 2, delCount: 1 },
    { filename: 'src/nested/b.js', addCount: 0, delCount: 3 },
    { filename: 'README.md', addCount: 1, delCount: 0 },
  ]
  const original = structuredClone(files)
  expect(buildTreeRows(files).map(row => [row.type, row.prefix, row.name, row.addCount, row.delCount])).toEqual([
    ['dir', '├──', 'src', 0, 0],
    ['file', '│  ├──', 'a.js', 2, 1],
    ['dir', '│  └──', 'nested', 0, 0],
    ['file', '│     └──', 'b.js', 0, 3],
    ['file', '└──', 'README.md', 1, 0],
  ])
  expect(files).toEqual(original)
  expect(buildTreeRows([])).toEqual([])
})
