import React, { useEffect } from 'react'
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getPR, getRepoInfo, getPRDiffStats, getPRDiff, listPRCommentsPage, deletePRComment } from '../../../executor.js'
import { scopedCacheKey, writeCache } from '../../../cache.js'
import { resetGhMemoryCache } from '../../../hooks/useGh.js'
import { sendInput } from '../../../test/input-bus.js'
import { cleanup, renderWithProviders, waitForExpectation } from '../../../test/test-helpers.jsx'
import { useDiffState } from './state.js'
import { DiffView } from './render.jsx'

// Real useGh on purpose: the banner must survive its cache, mutate and disk seed, not a mock of them.
vi.mock('ink', async () => ({
  ...await vi.importActual('ink'),
  useInput: (await import('../../../test/input-bus.js')).mockUseInput(await import('react')),
}))
vi.mock('../../../executor.js', () => ({
  getPR: vi.fn(), getRepoInfo: vi.fn(), getPRDiffStats: vi.fn(), getPRDiff: vi.fn(), listPRCommentsPage: vi.fn(),
  addPRLineComment: vi.fn(), replyToComment: vi.fn(), editPRComment: vi.fn(), deletePRComment: vi.fn(),
  mergePR: vi.fn(), reviewPR: vi.fn(),
}))

// useGh keys its caches by function name, and vi.fn() mocks are all called "spy".
for (const [name, fn] of Object.entries({ getPR, getRepoInfo, getPRDiffStats, getPRDiff, listPRCommentsPage })) {
  Object.defineProperty(fn, 'name', { value: name })
}

const DIFF = ['diff --git a/src/code.js b/src/code.js', '@@ -1 +1 @@', '-oldValue', '+newValue'].join('\n')
const TRUNC = { threads: true, replies: false }
const comment = (id) => ({ id, body: `c${id}`, path: 'src/code.js', line: 1, side: 'RIGHT', user: { login: 'u' }, createdAt: '2026-01-01T00:00:00Z' })

let currentState
function Session(props) {
  const state = useDiffState(props)
  useEffect(() => { currentState = state })
  return <DiffView prNumber={props.prNumber} state={state} />
}
let pr = 300
const mount = (n) => renderWithProviders(<Session repo="o/r" prNumber={n} onBack={() => {}} onViewComments={() => {}} />)

beforeEach(() => {
  vi.clearAllMocks()
  resetGhMemoryCache()
  currentState = null
  pr += 1
  getPRDiff.mockResolvedValue(DIFF)
  getPR.mockResolvedValue({ title: 'T', state: 'OPEN', headRefOid: 'a'.repeat(40) })
  getRepoInfo.mockResolvedValue({ viewerPermission: 'WRITE' })
  getPRDiffStats.mockResolvedValue({ additions: 1, deletions: 1, changedFiles: 1 })
  deletePRComment.mockResolvedValue(undefined)
})
afterEach(cleanup)

describe('"inline comments incomplete" banner is carried in the payload (#507)', () => {
  it('survives an inline edit of the comment list (mutate)', async () => {
    listPRCommentsPage.mockResolvedValue({ comments: [comment(9), comment(10)], truncated: TRUNC })
    const view = mount(pr)
    await waitForExpectation(() => expect(view.lastFrame()).toContain('inline comments incomplete'))
    await act(async () => { currentState.setCompose({ mode: 'delete', commentId: 9 }) })
    await sendInput('y')
    await waitForExpectation(() => expect(deletePRComment).toHaveBeenCalled())
    await waitForExpectation(() => expect(currentState.commentsByLine.get('src/code.js:1')).toHaveLength(1))
    expect(view.lastFrame()).toContain('inline comments incomplete')
  })

  it('shows from a JSON-roundtripped disk cache seed before any fetch returns', async () => {
    listPRCommentsPage.mockReturnValue(new Promise(() => {}))
    const payload = JSON.parse(JSON.stringify({ comments: [comment(1)], truncated: TRUNC }))
    writeCache(scopedCacheKey(['o/r', 'listPRCommentsPage', ['o/r', pr]]), payload, { repo: 'o/r' })
    const view = mount(pr)
    await waitForExpectation(() => expect(view.lastFrame()).toContain('inline comments incomplete'))
  })
})
