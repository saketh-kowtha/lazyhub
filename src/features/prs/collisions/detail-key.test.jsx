import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PRDetail } from '../detail.jsx'
import { useGh } from '../../../hooks/useGh.js'
import { getPR, getRepoInfo, getPRChecks, getBranchProtection } from '../../../executor.js'
import { getCollisionScan } from './scan.js'
import { sendInput } from '../../../test/input-bus.js'
import { cleanup, flush, renderWithProviders, waitForExpectation } from '../../../test/test-helpers.jsx'

vi.mock('ink', async () => {
  const React = await import('react')
  return { ...await vi.importActual('ink'), useInput: (await import('../../../test/input-bus.js')).mockUseInput(React) }
})
vi.mock('../../../hooks/useGh.js', () => ({ useGh: vi.fn() }))

const pr = {
  number: 42, title: 'Stabilize parser', body: 'Body', state: 'OPEN', isDraft: false,
  mergeable: 'MERGEABLE', mergeStateStatus: 'CLEAN', baseRefName: 'main', headRefName: 'feat',
  headRefOid: 'a'.repeat(40), files: [], labels: [], assignees: [], reviews: [], reviewRequests: [],
  statusCheckRollup: [], author: { login: 'alice' }, autoMergeRequest: null, url: 'https://x/42',
}
const result = (data) => ({ data, loading: false, error: null, refetch: vi.fn(), mutate: vi.fn() })
const scan = {
  repo: 'o/r', number: 42, fetchedAt: Date.now(), totalOpen: 1, notScanned: 0, filesCapped: [], hunkChecked: [], hunkSkipped: [], patchTruncated: [], errors: [],
  prs: [{ number: 42, title: 'Stabilize parser', state: 'OPEN', baseRefName: 'main', additions: 1, deletions: 1, files: [{ path: 'a.js', changeType: 'MODIFIED' }] }],
}

beforeEach(() => {
  useGh.mockImplementation((fn) => {
    if (fn === getPR) return result(pr)
    if (fn === getRepoInfo) return result({})
    if (fn === getPRChecks) return result([])
    if (fn === getBranchProtection) return result(null)
    if (fn === getCollisionScan) return result(scan)
    return result(null)
  })
})
afterEach(() => { cleanup(); vi.clearAllMocks() })

describe('collision radar key in PR detail (#360)', () => {
  it('K opens the radar and Esc returns to the detail', async () => {
    const view = renderWithProviders(<PRDetail prNumber={42} repo="o/r" onBack={() => {}} />)
    await waitForExpectation(() => expect(view.lastFrame()).toContain('Stabilize parser'))
    await flush(20)
    await sendInput('K')
    await waitForExpectation(() => expect(view.lastFrame()).toContain('Collisions for #42'))
    expect(view.lastFrame()).toContain('No other open PR into main shares a file')
    await flush(20)
    await sendInput('', { escape: true })
    await waitForExpectation(() => expect(view.lastFrame()).not.toContain('Collisions for #42'))
  })
})
