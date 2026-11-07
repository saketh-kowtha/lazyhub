/**
 * #471/#479: conflict resolution runs git only in a clone of the viewed repo. Without one it says so
 * and does not touch the launch directory.
 */
import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ConflictView } from './ConflictView.jsx'
import * as gitService from '../../services/git.js'
import { renderWithProviders, cleanup, waitForExpectation } from '../../test/test-helpers.jsx'

vi.mock('../../executor.js', () => ({ checkoutBranch: vi.fn() }))
vi.mock('../../services/git.js', () => ({
  findLocalCheckout: vi.fn(async () => null),
  noLocalCheckoutMessage: repo => `No local checkout of ${repo} here`,
  currentBranch: vi.fn(), isInMerge: vi.fn(), conflictedFiles: vi.fn(), countConflictMarkers: vi.fn(),
  stage: vi.fn(), unstage: vi.fn(), mergeAbort: vi.fn(), commit: vi.fn(), mergeBranch: vi.fn(), mergeMessage: vi.fn(), push: vi.fn(),
}))
vi.mock('../../editor.js', () => ({ openInEditor: vi.fn(async () => {}) }))

describe('ConflictView without a local checkout', () => {
  afterEach(() => cleanup())

  it('explains why and runs no git command', async () => {
    const view = renderWithProviders(
      <ConflictView pr={{ number: 5, url: 'https://example.test/pr/5', headRefName: 'f', baseRefName: 'main' }} repo="o/r" onBack={() => {}} onResolved={() => {}} />
    )
    await waitForExpectation(() => expect(view.lastFrame()).toContain('No local checkout of o/r'))
    for (const name of ['currentBranch', 'isInMerge', 'conflictedFiles', 'stage', 'commit', 'mergeBranch', 'push']) {
      expect(gitService[name], name).not.toHaveBeenCalled()
    }
  })
})
