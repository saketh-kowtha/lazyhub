import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PRDetail } from './detail.jsx'
import { useGh } from '../../hooks/useGh.js'
import { getPR, getRepoInfo, getPRChecks, getBranchProtection, mergePR, reviewPR } from '../../executor.js'
import { sendInput } from '../../test/input-bus.js'
import { saveState } from '../../config.js'
import { cleanup, flush, renderWithProviders, waitForExpectation } from '../../test/test-helpers.jsx'

vi.mock('ink', async () => {
  const React = await import('react')
  return { ...await vi.importActual('ink'), useInput: (await import('../../test/input-bus.js')).mockUseInput(React) }
})
vi.mock('../../hooks/useGh.js', () => ({ useGh: vi.fn() }))
vi.mock('../../executor.js', async (original) => ({
  ...await original(), mergePR: vi.fn(), reviewPR: vi.fn(),
}))

const pr = {
  number: 42, title: 'Stabilize parser', body: 'Body', state: 'OPEN', isDraft: false,
  mergeable: 'MERGEABLE', mergeStateStatus: 'CLEAN', baseRefName: 'main', headRefName: 'feat',
  headRefOid: 'a'.repeat(40), files: [], labels: [], assignees: [], reviews: [], reviewRequests: [],
  statusCheckRollup: [], author: { login: 'alice' }, autoMergeRequest: null, url: 'https://x/42',
}
let repoInfo
const result = (data) => ({ data, loading: false, error: null, refetch: vi.fn(), mutate: vi.fn() })

beforeEach(() => {
  saveState({ mergeMethods: {} }) // the remembered method (#314) must not leak between tests
  repoInfo = { squashMergeAllowed: true, mergeCommitAllowed: true, rebaseMergeAllowed: true, viewerPermission: 'WRITE' }
  mergePR.mockResolvedValue(undefined)
  reviewPR.mockResolvedValue(undefined)
  useGh.mockImplementation((fn) => {
    if (fn === getPR) return result(pr)
    if (fn === getRepoInfo) return result(repoInfo)
    if (fn === getPRChecks) return result([])
    if (fn === getBranchProtection) return result(null)
    return result(null)
  })
})
afterEach(() => { cleanup(); vi.clearAllMocks() })

async function open() {
  const view = renderWithProviders(<PRDetail prNumber={42} repo="o/r" onBack={() => {}} />)
  await waitForExpectation(() => expect(view.lastFrame()).toContain('Stabilize parser'))
  await flush(20)
  return view
}

describe('merge flow wording and keystrokes (#468)', () => {
  it('offers human labels, not raw CLI flags', async () => {
    const view = await open()
    await sendInput('m')
    await waitForExpectation(() => expect(view.lastFrame()).toContain('Merge PR #42'))
    const frame = view.lastFrame()
    expect(frame).toContain('Squash and merge')
    expect(frame).toContain('Rebase and merge')
    expect(frame).not.toMatch(/--merge|--squash|--rebase|--admin/)
  })

  const ENTER = ['', { return: true }]

  it('m then Enter never merges by itself: it asks, defaulting to No', async () => {
    const view = await open()
    await sendInput('m')
    await waitForExpectation(() => expect(view.lastFrame()).toContain('Merge PR #42'))
    await flush(20)
    await sendInput(...ENTER)
    await waitForExpectation(() => expect(view.lastFrame()).toMatch(/Merge PR #42 via Squash and merge\?/))
    expect(mergePR).not.toHaveBeenCalled()
    // A held or double Enter lands on the default No and cancels.
    await flush(20)
    await sendInput(...ENTER)
    await sendInput(...ENTER)
    await flush(20)
    expect(mergePR).not.toHaveBeenCalled()
  })

  it('m, Enter, y merges with the preferred method (squash)', async () => {
    const view = await open()
    await sendInput('m')
    await waitForExpectation(() => expect(view.lastFrame()).toContain('Merge PR #42'))
    await flush(20)
    await sendInput(...ENTER)
    await waitForExpectation(() => expect(view.lastFrame()).toContain('via Squash and merge'))
    await flush(20)
    await sendInput('y')
    await waitForExpectation(() => expect(mergePR).toHaveBeenCalledTimes(1))
    expect(mergePR.mock.calls[0].slice(0, 3)).toEqual(['o/r', 42, 'squash'])
  })

  it('defaults to the first allowed method when squash is not allowed', async () => {
    repoInfo = { squashMergeAllowed: false, mergeCommitAllowed: true, rebaseMergeAllowed: true, viewerPermission: 'WRITE' }
    const view = await open()
    await sendInput('m')
    await waitForExpectation(() => expect(view.lastFrame()).toContain('Merge PR #42'))
    expect(view.lastFrame()).not.toContain('Squash and merge')
    await flush(20)
    await sendInput(...ENTER)
    await waitForExpectation(() => expect(view.lastFrame()).toContain('via Create a merge commit'))
    await sendInput('y')
    await waitForExpectation(() => expect(mergePR).toHaveBeenCalledTimes(1))
    expect(mergePR.mock.calls[0][2]).toBe('merge')
  })

  it('shows mergeability, CI and approvals in the picker title', async () => {
    const view = await open()
    await sendInput('m')
    await waitForExpectation(() => expect(view.lastFrame()).toMatch(/clean · no CI · 0 approvals/))
  })

  it('does not open the picker until repository settings have loaded', async () => {
    repoInfo = null
    const view = await open()
    await sendInput('m')
    await flush(20)
    expect(view.lastFrame()).not.toContain('Squash and merge')
    expect(view.lastFrame()).toContain('Loading repository settings')
  })

  it('hides bypass options from non-admins and requires typing the PR number for admins', async () => {
    let view = await open()
    await sendInput('m')
    await waitForExpectation(() => expect(view.lastFrame()).toContain('Merge PR #42'))
    expect(view.lastFrame()).not.toContain('bypass')
    cleanup()
    repoInfo = { ...repoInfo, viewerPermission: 'ADMIN' }
    view = await open()
    await sendInput('m')
    await waitForExpectation(() => expect(view.lastFrame()).toContain('(bypass branch protection)'))
    await flush(20)
    for (let i = 0; i < 3; i++) await sendInput('j')
    await sendInput(...ENTER)
    await waitForExpectation(() => expect(view.lastFrame()).toContain('Type 42 to confirm'))
    expect(view.lastFrame()).toContain('Type 42, then ←, then Enter')
    await sendInput('y')
    await flush(20)
    expect(mergePR).not.toHaveBeenCalled()
  })

  it('e adds a commit message before merging', async () => {
    const view = await open()
    await sendInput('m')
    await waitForExpectation(() => expect(view.lastFrame()).toContain('Merge PR #42'))
    await flush(20)
    await sendInput('e')
    await waitForExpectation(() => expect(view.lastFrame()).toContain('Commit message'))
    expect(view.lastFrame()).toContain('Merge PR #42')
    expect(mergePR).not.toHaveBeenCalled()
  })
})

describe('approve and request-changes (#468)', () => {
  const ENTER = ['', { return: true }]

  it('a then Enter does not approve by itself: it asks first, defaulting to No', async () => {
    const view = await open()
    await sendInput('a')
    await waitForExpectation(() => expect(view.lastFrame()).toContain('Approve PR #42'))
    await flush(20)
    await sendInput(...ENTER)
    await waitForExpectation(() => expect(view.lastFrame()).toContain('Approve PR #42?'))
    expect(reviewPR).not.toHaveBeenCalled()
    await flush(20)
    await sendInput(...ENTER)
    await sendInput(...ENTER)
    await flush(20)
    expect(reviewPR).not.toHaveBeenCalled()
  })

  it('a, Enter, y approves', async () => {
    const view = await open()
    await sendInput('a')
    await waitForExpectation(() => expect(view.lastFrame()).toContain('Approve PR #42'))
    await flush(20)
    await sendInput(...ENTER)
    await waitForExpectation(() => expect(view.lastFrame()).toContain('Approve PR #42?'))
    await flush(20)
    await sendInput('y')
    await waitForExpectation(() => expect(reviewPR).toHaveBeenCalledWith('o/r', 42, 'approve', ''))
  })

  it('request changes with an empty body does not submit', async () => {
    const view = await open()
    await sendInput('x')
    await waitForExpectation(() => expect(view.lastFrame()).toContain('Request changes on PR #42'))
    await flush(20)
    await sendInput(...ENTER)
    await waitForExpectation(() => expect(view.lastFrame()).toContain('a reason is required'))
    expect(reviewPR).not.toHaveBeenCalled()
  })
})
