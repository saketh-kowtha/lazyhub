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

vi.mock('../../executor.js', () => ({ checkoutBranch: vi.fn() }))
vi.mock('../../services/git.js', () => ({
  findLocalCheckout: vi.fn(async () => ({ dir: '/w', remote: 'origin' })),
  noLocalCheckoutMessage: repo => `No local checkout of ${repo} here`,
  currentBranch: vi.fn(async () => 'feature'),
  isInMerge: vi.fn(async () => true),
  conflictedFiles: vi.fn(async () => [{ path: 'a.js' }]),
  countConflictMarkers: vi.fn(async () => 0), // no markers left: every file counts as staged
  stage: vi.fn(), unstage: vi.fn(), mergeAbort: vi.fn(), commit: vi.fn(), mergeBranch: vi.fn(),
  mergeMessage: vi.fn(async () => 'Merge branch main'),
  push: vi.fn(),
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
