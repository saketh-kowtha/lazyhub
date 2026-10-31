import React, { useEffect } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, renderWithProviders, waitForExpectation } from '../../../test/test-helpers.jsx'

// Real useGh, hand-rolled executor fakes with deferred promises (no wall clock).
// Functions are plain named functions because useGh keys its cache by fn.name.
const h = vi.hoisted(() => {
  const calls = []
  const pending = {}
  const defer = (name) => new Promise((resolve, reject) => { pending[name] = { resolve, reject } })
  const track = (name) => { calls.push(name); return defer(name) }
  return { calls, pending, track }
})

vi.mock('ink', async () => ({
  ...await vi.importActual('ink'),
  useInput: (await import('../../../test/input-bus.js')).mockUseInput(await import('react')),
}))
vi.mock('../../../executor.js', () => ({
  getPRDiff: async function getPRDiff() { return h.track('getPRDiff') },
  getPR: async function getPR() { return h.track('getPR') },
  getRepoInfo: async function getRepoInfo() { return h.track('getRepoInfo') },
  listPRComments: async function listPRComments() { return h.track('listPRComments') },
  getPRDiffStats: async function getPRDiffStats() { return h.track('getPRDiffStats') },
  addPRLineComment: vi.fn(), replyToComment: vi.fn(), editPRComment: vi.fn(),
  deletePRComment: vi.fn(), mergePR: vi.fn(), reviewPR: vi.fn(),
}))

const { useDiffState } = await import('./state.js')
const { DiffView } = await import('./render.jsx')

const DIFF = [
  'diff --git a/src/code.js b/src/code.js',
  '@@ -1 +1 @@',
  '-oldValue',
  '+newValue',
].join('\n')

let currentState
function Session({ n = 451 }) {
  const state = useDiffState({ prNumber: n, repo: 'load/order', onBack: () => {}, onViewComments: () => {} })
  useEffect(() => { currentState = state })
  return <DiffView prNumber={n} state={state} />
}

beforeEach(() => {
  h.calls.length = 0
  for (const k of Object.keys(h.pending)) delete h.pending[k]
  currentState = null
})
afterEach(cleanup)

describe('diff open order (#451)', () => {
  it('requests only the diff first, renders it on arrival, then loads secondary data', async () => {
    const view = renderWithProviders(<Session />, { appContext: { notifyDialog: () => {} } })
    await waitForExpectation(() => expect(h.calls).toContain('getPRDiff'))
    // Nothing else may compete with the diff for the gh concurrency cap.
    expect(h.calls).toEqual(['getPRDiff'])

    h.pending.getPRDiff.resolve(DIFF)
    await waitForExpectation(() => expect(view.lastFrame()).toContain('newValue'))
    // Secondary calls start only after the diff has landed.
    await waitForExpectation(() => expect(h.calls).toEqual(
      expect.arrayContaining(['getPRDiff', 'getPR', 'getRepoInfo', 'listPRComments'])))
    // Stats are derived from the diff text, no separate call.
    expect(h.calls).not.toContain('getPRDiffStats')
    // Diff rendered without waiting for any secondary call to resolve.
    expect(view.lastFrame()).toContain('newValue')
  })

  it('gates a large diff from the diff text itself, in the frame it arrives', async () => {
    const view = renderWithProviders(<Session n={452} />, { appContext: { notifyDialog: () => {} } })
    await waitForExpectation(() => expect(h.calls).toContain('getPRDiff'))
    const big = ['diff --git a/a.js b/a.js', '@@ -1 +1 @@', ...Array.from({ length: 5001 }, (_, i) => `+line ${i}`)].join('\n')
    h.pending.getPRDiff.resolve(big)
    await waitForExpectation(() => expect(view.lastFrame()).toContain('Large diff: +5001 -0 across 1 files'))
    expect(h.calls).not.toContain('getPRDiffStats')
  })
})
