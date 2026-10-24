import React, { useEffect } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useGh } from '../../../hooks/useGh.js'
import { getPR, getRepoInfo, getPRDiffStats, getPRDiff, listPRComments, mergePR } from '../../../executor.js'
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
  listPRComments: vi.fn(), mergePR: vi.fn(), addPRLineComment: vi.fn(),
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
      : fn === listPRComments ? [] : null,
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

  it('preserves the admin merge message across method selection and waits for confirmation', async () => {
    const { view, onBack } = mountSession()
    await waitForExpectation(() => expect(currentState).not.toBeNull())
    currentState.submitMerge({ value: 'admin', text: 'reviewed change' })
    await waitForExpectation(() => expect(currentState.dialog).toBe('merge-admin'))
    currentState.selectAdminMethod('squash')
    await waitForExpectation(() => expect(view.lastFrame()).toContain('ADMIN BYPASS'))
    expect(mergePR).not.toHaveBeenCalled()
    expect(currentState.adminMergeMsg).toEqual({ strategy: 'admin-squash', msg: 'reviewed change' })

    currentState.confirmAdminMerge()
    await waitForExpectation(() => expect(onBack).toHaveBeenCalledOnce())
    expect(mergePR).toHaveBeenCalledExactlyOnceWith('owner/repo', 42, 'admin-squash', 'reviewed change', { allowAdmin: true })
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
