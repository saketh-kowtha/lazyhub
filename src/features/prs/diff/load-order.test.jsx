import React, { useEffect } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { rmSync } from 'node:fs'
import { cleanup, renderWithProviders, waitForExpectation } from '../../../test/test-helpers.jsx'
import { sendInput } from '../../../test/input-bus.js'
import { firstActionKey } from '../../../config/actions.js'

// Real useGh, hand-rolled executor fakes with deferred promises (no wall clock).
// Functions are plain named functions because useGh keys its cache by fn.name.
const h = vi.hoisted(() => {
  // Disk cache must be hermetic: set before cache.js is first imported.
  process.env.LAZYHUB_CACHE_DIR = `${process.env.TMPDIR || '/tmp'}/lazyhub-load-order-${process.pid}`
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
  classifyGhFailure: () => ({ tone: 'warn', cause: 'diff failed', notes: [], fix: null, fixHint: null }),
  failureGlyph: () => '!',
}))

const { useDiffState } = await import('./state.js')
const { DiffView } = await import('./render.jsx')
const { resetGhMemoryCache } = await import('../../../hooks/useGh.js')

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
  resetGhMemoryCache()
  rmSync(process.env.LAZYHUB_CACHE_DIR, { recursive: true, force: true })
  h.calls.length = 0
  for (const k of Object.keys(h.pending)) delete h.pending[k]
  currentState = null
})
afterEach(() => { cleanup(); rmSync(process.env.LAZYHUB_CACHE_DIR, { recursive: true, force: true }) })

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

describe('diff open: errors, too-large, retry (#451)', () => {
  it('shows the large-diff gate with open-in-browser when gh says the diff is too large', async () => {
    const view = renderWithProviders(<Session n={460} />, { appContext: { notifyDialog: () => {} } })
    await waitForExpectation(() => expect(h.calls).toContain('getPRDiff'))
    h.pending.getPRDiff.reject(Object.assign(new Error('HTTP 406: Sorry, the diff exceeded the maximum number of lines'), { stderr: '' }))
    await waitForExpectation(() => expect(view.lastFrame()).toContain('Large diff'))
    expect(view.lastFrame()).toContain('Open in browser')
    expect(h.calls).toEqual(['getPRDiff'])
  })

  it('retry after a diff error loads the diff and then the secondary data', async () => {
    const view = renderWithProviders(<Session n={461} />, { appContext: { notifyDialog: () => {} } })
    await waitForExpectation(() => expect(h.calls).toContain('getPRDiff'))
    h.pending.getPRDiff.reject(new Error('boom'))
    await waitForExpectation(() => expect(view.lastFrame()).toMatch(/retry/))
    expect(h.calls).toEqual(['getPRDiff'])
    await sendInput(firstActionKey('list.refresh', 'r'))
    await waitForExpectation(() => expect(h.calls).toEqual(['getPRDiff', 'getPRDiff']))
    h.pending.getPRDiff.resolve(DIFF)
    await waitForExpectation(() => expect(view.lastFrame()).toContain('newValue'))
    await waitForExpectation(() => expect(h.calls).toEqual(expect.arrayContaining(['getPR', 'getRepoInfo', 'listPRComments'])))
  })

  it('does not count +++/--- content lines inside a hunk as headers', async () => {
    const view = renderWithProviders(<Session n={462} />, { appContext: { notifyDialog: () => {} } })
    await waitForExpectation(() => expect(h.calls).toContain('getPRDiff'))
    const lines = ['diff --git a/a.sql b/a.sql', '--- a/a.sql', '+++ b/a.sql', '@@ -1 +1 @@']
    for (let i = 0; i < 2600; i++) lines.push(`+++i${i}`, `--- sql${i}`)
    h.pending.getPRDiff.resolve(lines.join('\n'))
    await waitForExpectation(() => expect(view.lastFrame()).toContain('Large diff: +2600 -2600 across 1 files'))
  })
})

describe('diff loading frame (#454)', () => {
  it('shows a skeleton with header on the first frame, not a bare spinner', async () => {
    const view = renderWithProviders(<Session n={454} />, { appContext: { notifyDialog: () => {} } })
    const frame = view.lastFrame()
    expect(frame).toContain('PR #454 Diff')
    expect(frame).toContain('░')
    expect(frame).not.toContain('Loading diff')
  })

  it('renders a cached diff immediately with no loading frame', async () => {
    const first = renderWithProviders(<Session n={455} />, { appContext: { notifyDialog: () => {} } })
    await waitForExpectation(() => expect(h.calls).toContain('getPRDiff'))
    h.pending.getPRDiff.resolve(DIFF)
    await waitForExpectation(() => expect(first.lastFrame()).toContain('newValue'))
    cleanup()

    const second = renderWithProviders(<Session n={455} />, { appContext: { notifyDialog: () => {} } })
    expect(second.lastFrame()).toContain('newValue')
    expect(second.lastFrame()).not.toContain('░')
  })
})
