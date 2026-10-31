import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PRDetail } from './detail.jsx'
import { useGh } from '../../hooks/useGh.js'
import { getPR, getRepoInfo, getPRChecks, getBranchProtection, mergePR, reviewPR } from '../../executor.js'
import { sendInput } from '../../test/input-bus.js'
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

  it('merges with the default method in two keys: m, Enter', async () => {
    const view = await open()
    await sendInput('m')
    await waitForExpectation(() => expect(view.lastFrame()).toContain('Merge PR #42'))
    await flush(20)
    await sendInput('', { return: true })
    await waitForExpectation(() => expect(mergePR).toHaveBeenCalledTimes(1))
    expect(mergePR.mock.calls[0].slice(0, 3)).toEqual(['o/r', 42, 'merge'])
  })

  it('defaults to the first merge method the repository allows', async () => {
    repoInfo = { squashMergeAllowed: true, mergeCommitAllowed: false, rebaseMergeAllowed: false, viewerPermission: 'WRITE' }
    const view = await open()
    await sendInput('m')
    await waitForExpectation(() => expect(view.lastFrame()).toContain('Merge PR #42'))
    expect(view.lastFrame()).not.toContain('Rebase and merge')
    await flush(20)
    await sendInput('', { return: true })
    await waitForExpectation(() => expect(mergePR).toHaveBeenCalledTimes(1))
    expect(mergePR.mock.calls[0][2]).toBe('squash')
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

describe('approve dialog (#468)', () => {
  it('Enter approves', async () => {
    const view = await open()
    await sendInput('a')
    await waitForExpectation(() => expect(view.lastFrame()).toContain('Approve PR #42'))
    await flush(20)
    await sendInput('', { return: true })
    await waitForExpectation(() => expect(reviewPR).toHaveBeenCalledWith('o/r', 42, 'approve', ''))
  })
})
