/**
 * Conflict-view writes share one in-flight guard (#453): a second Enter on the
 * commit field, sent before React re-renders, must not commit and push twice.
 */
import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ConflictView } from './ConflictView.jsx'
import { gitCommit, gitUnstage, pushBranch, getConflictedFiles, countFileConflicts } from '../../executor.js'
import { renderWithProviders, flush, cleanup, waitForExpectation } from '../../test/test-helpers.jsx'

vi.mock('../../executor.js', () => ({
  getCurrentBranch: vi.fn(async () => 'feature'),
  checkoutBranch: vi.fn(),
  isInMerge: vi.fn(async () => true),
  getConflictedFiles: vi.fn(async () => [{ path: 'a.js' }]),
  countFileConflicts: vi.fn(async () => 0),
  gitAdd: vi.fn(), gitUnstage: vi.fn(), gitMergeAbort: vi.fn(), gitCommit: vi.fn(), gitMergeBranch: vi.fn(),
  getMergeCommitMessage: vi.fn(async () => 'Merge branch main'),
  pushBranch: vi.fn(),
}))
vi.mock('../../editor.js', () => ({ openInEditor: vi.fn(async () => {}) }))

describe('ConflictView double submit (#453)', () => {
  afterEach(() => cleanup())

  it('commits and pushes once when Enter is pressed twice in a row', async () => {
    let release
    gitCommit.mockReturnValue(new Promise(r => { release = r }))
    pushBranch.mockResolvedValue(undefined)
    const view = renderWithProviders(
      <ConflictView pr={{ number: 5, url: 'https://example.test/pr/5', headRefName: 'feature' }} repo="o/r" onBack={() => {}} onResolved={() => {}} />
    )
    await waitForExpectation(() => expect(view.lastFrame()).toContain('Commit message:'))
    await flush(20)
    view.stdin.write('\r')
    view.stdin.write('\r')
    await waitForExpectation(() => expect(gitCommit).toHaveBeenCalled())
    await flush(40)
    expect(gitCommit).toHaveBeenCalledTimes(1)
    release()
    await waitForExpectation(() => expect(pushBranch).toHaveBeenCalledTimes(1))
  })

  it('shows a pending status while an unstage runs', async () => {
    let release
    gitUnstage.mockReturnValue(new Promise(r => { release = r }))
    countFileConflicts.mockResolvedValue(0)
    getConflictedFiles.mockResolvedValue([{ path: 'a.js', staged: false }])
    const view = renderWithProviders(
      <ConflictView pr={{ number: 5, url: 'https://example.test/pr/5', headRefName: 'feature' }} repo="o/r" onBack={() => {}} onResolved={() => {}} />
    )
    await waitForExpectation(() => expect(view.lastFrame()).toContain('a.js'))
    await flush(20)
    view.stdin.write(' ')
    await waitForExpectation(() => expect(view.lastFrame()).toContain('Unstaging a.js'))
    release()
  })
})
