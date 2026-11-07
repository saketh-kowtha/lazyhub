/**
 * Conflict-view writes share one in-flight guard (#453): a second Enter on the
 * commit field, sent before React re-renders, must not commit and push twice.
 */
import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ConflictView } from './ConflictView.jsx'
import { commit, unstage, mergeAbort, push, conflictedFiles, countConflictMarkers } from '../../services/git.js'
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
vi.mock('../../editor.js', () => ({ openInEditor: vi.fn(async () => {}) }))

describe('ConflictView double submit (#453)', () => {
  afterEach(() => cleanup())

  it('commits and pushes once when Enter is pressed twice in a row', async () => {
    let release
    commit.mockReturnValue(new Promise(r => { release = r }))
    push.mockResolvedValue(undefined)
    const view = renderWithProviders(
      <ConflictView pr={{ number: 5, url: 'https://example.test/pr/5', headRefName: 'feature' }} repo="o/r" onBack={() => {}} onResolved={() => {}} />
    )
    await waitForExpectation(() => expect(view.lastFrame()).toContain('Commit message:'))
    await flush(20)
    view.stdin.write('\r')
    view.stdin.write('\r')
    await waitForExpectation(() => expect(commit).toHaveBeenCalled())
    await flush(40)
    expect(commit).toHaveBeenCalledTimes(1)
    release()
    await waitForExpectation(() => expect(push).toHaveBeenCalledTimes(1))
  })

  it('shows a pending status while an unstage runs', async () => {
    let release
    unstage.mockReturnValue(new Promise(r => { release = r }))
    countConflictMarkers.mockResolvedValue(0)
    conflictedFiles.mockResolvedValue([{ path: 'a.js', staged: false }])
    const view = renderWithProviders(
      <ConflictView pr={{ number: 5, url: 'https://example.test/pr/5', headRefName: 'feature' }} repo="o/r" onBack={() => {}} onResolved={() => {}} />
    )
    await waitForExpectation(() => expect(view.lastFrame()).toContain('a.js'))
    await flush(20)
    view.stdin.write(' ')
    await waitForExpectation(() => expect(view.lastFrame()).toContain('Unstaging a.js'))
    release()
  })

  it('keeps a pending message when an earlier 4 s status timer expires', async () => {
    let release
    unstage.mockReturnValue(new Promise(r => { release = r }))
    conflictedFiles.mockResolvedValue([{ path: 'a.js' }])
    const view = renderWithProviders(
      <ConflictView pr={{ number: 5, url: 'https://example.test/pr/5', headRefName: 'feature' }} repo="o/r" onBack={() => {}} onResolved={() => {}} />
    )
    await waitForExpectation(() => expect(view.lastFrame()).toContain('a.js'))
    await flush(20)
    view.stdin.write('e') // sets a 4 s "Opened a.js in editor" status
    await waitForExpectation(() => expect(view.lastFrame()).toContain('Opened a.js'))
    view.stdin.write(' ')
    await waitForExpectation(() => expect(view.lastFrame()).toContain('Unstaging a.js'))
    await new Promise(r => setTimeout(r, 4300))
    expect(view.lastFrame()).toContain('Unstaging a.js')
    release()
  }, 10000)

  it('closes the abort confirm at once and announces the pending abort', async () => {
    let release
    mergeAbort.mockReturnValue(new Promise(r => { release = r }))
    conflictedFiles.mockResolvedValue([{ path: 'a.js' }])
    const view = renderWithProviders(
      <ConflictView pr={{ number: 5, url: 'https://example.test/pr/5', headRefName: 'feature' }} repo="o/r" onBack={() => {}} onResolved={() => {}} />
    )
    await waitForExpectation(() => expect(view.lastFrame()).toContain('a.js'))
    await flush(20)
    view.stdin.write('A')
    await waitForExpectation(() => expect(view.lastFrame()).toContain('Abort merge?'))
    await flush(20)
    view.stdin.write('y')
    await waitForExpectation(() => expect(view.lastFrame()).toContain('Aborting merge'))
    expect(view.lastFrame()).not.toContain('Abort merge?')
    expect(mergeAbort).toHaveBeenCalledTimes(1)
    release()
  })
})
