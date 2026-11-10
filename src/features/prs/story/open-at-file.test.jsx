import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useGh } from '../../../hooks/useGh.js'
import { getPR, getRepoInfo, getPRDiffStats, getPRDiff, listPRFilesPage, getPRFilePatch, listPRCommentsPage } from '../../../executor.js'
import { cleanup, renderWithProviders, waitForExpectation } from '../../../test/test-helpers.jsx'
import { diffFilesPage, fakeFilePatch } from '../../../test/diff-fixtures.js'
import { PRDiff } from '../diff.jsx'

vi.mock('ink', async () => ({
  ...await vi.importActual('ink'),
  useInput: (await import('../../../test/input-bus.js')).mockUseInput(await import('react')),
}))
vi.mock('../../../hooks/useGh.js', () => ({ useGh: vi.fn() }))
vi.mock('../../../executor.js', () => ({
  getPR: vi.fn(), getRepoInfo: vi.fn(), getPRDiffStats: vi.fn(), getPRDiff: vi.fn(), listPRFilesPage: vi.fn(), getPRFilePatch: vi.fn(),
  listPRCommentsPage: vi.fn(), mergePR: vi.fn(), addPRLineComment: vi.fn(),
  replyToComment: vi.fn(), editPRComment: vi.fn(), deletePRComment: vi.fn(), reviewPR: vi.fn(),
}))

const DIFF = [
  'diff --git a/src/one.js b/src/one.js', '@@ -1 +1,41 @@', '-aaaOld', '+aaaNew', ...Array.from({ length: 40 }, (_, i) => `+filler${i}`),
  'diff --git a/src/two.js b/src/two.js', '@@ -1 +1 @@', '-bbbOld', '+bbbNew',
].join('\n')

beforeEach(() => {
  vi.clearAllMocks()
  getPRFilePatch.mockImplementation(fakeFilePatch(DIFF))
  useGh.mockImplementation(fn => ({
    data: fn.name === 'listPRDiffFiles' ? diffFilesPage(DIFF) : fn === getPR ? { title: 't', state: 'OPEN' }
      : fn === getRepoInfo ? {} : fn === getPRDiffStats ? { additions: 2, deletions: 2, changedFiles: 2 }
        : fn === listPRCommentsPage ? { comments: [], truncated: false } : null,
    loading: false, error: null, refetch: vi.fn(), mutate: vi.fn(),
  }))
})
afterEach(cleanup)

describe('diff opened from the review story (#362)', () => {
  it('moves the cursor to the requested file once, without touching the diff view', async () => {
    const view = renderWithProviders(<PRDiff repo="o/r" prNumber={7} onBack={() => {}} onViewComments={() => {}} initialFile="src/two.js" />)
    await waitForExpectation(() => expect(view.lastFrame()).toContain('bbbNew'))
    expect(view.lastFrame()).not.toContain('aaaNew')
  })

  it('starts at the top without an initial file', async () => {
    const view = renderWithProviders(<PRDiff repo="o/r" prNumber={7} onBack={() => {}} onViewComments={() => {}} />)
    await waitForExpectation(() => expect(view.lastFrame()).toContain('aaaNew'))
  })
})
