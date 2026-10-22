/**
 * The conflict view's commit-message editor is a text field: it must claim the
 * `input` scope so typed characters cannot arm the global `g` prefix.
 */
import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Text } from 'ink'
import { ConflictView } from './ConflictView.jsx'
import { useActiveScope } from '../../keyscope.js'
import { renderWithProviders, flush, cleanup, waitForExpectation } from '../../test/test-helpers.jsx'

vi.mock('../../executor.js', () => ({
  getCurrentBranch: vi.fn(async () => 'feature'),
  checkoutBranch: vi.fn(),
  isInMerge: vi.fn(async () => true),
  getConflictedFiles: vi.fn(async () => [{ path: 'a.js' }]),
  countFileConflicts: vi.fn(async () => 0), // no markers left: every file counts as staged
  gitAdd: vi.fn(), gitUnstage: vi.fn(), gitMergeAbort: vi.fn(), gitCommit: vi.fn(), gitMergeBranch: vi.fn(),
  getMergeCommitMessage: vi.fn(async () => 'Merge branch main'),
  pushBranch: vi.fn(),
}))
vi.mock('../../editor.js', () => ({ openInEditor: vi.fn() }))

function ScopeProbe() { return <Text>{`SCOPE ${useActiveScope()}`}</Text> }

describe('ConflictView text entry', () => {
  afterEach(() => cleanup())

  it('claims the input scope once the commit editor is shown', async () => {
    const view = renderWithProviders(
      <>
        <ConflictView pr={{ number: 5, url: 'https://example.test/pr/5' }} repo="o/r" onBack={() => {}} onResolved={() => {}} />
        <ScopeProbe />
      </>
    )
    await waitForExpectation(() => expect(view.lastFrame()).toContain('Commit message:'))
    await flush(20)
    expect(view.lastFrame()).toContain('SCOPE input')
  })
})
