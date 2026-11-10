import React, { useEffect } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { rmSync } from 'node:fs'
import { cleanup, renderWithProviders, waitForExpectation } from '../../../test/test-helpers.jsx'
import { scopedCacheKey as mkDiskKey, writeCache } from '../../../cache.js'
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
  listPRFilesPage: async function listPRFilesPage() { return h.track('listPRFilesPage') },
  getPRFilePatch: async function getPRFilePatch(_repo, _n, path) { return h.track(`patch:${path}`) },
  getPRDiff: async function getPRDiff() { return h.track('getPRDiff') },
  getPR: async function getPR() { return h.track('getPR') },
  getRepoInfo: async function getRepoInfo() { return h.track('getRepoInfo') },
  listPRCommentsPage: async function listPRCommentsPage() { return h.track('listPRCommentsPage') },
  getPRDiffStats: async function getPRDiffStats() { return h.track('getPRDiffStats') },
  addPRLineComment: vi.fn(), replyToComment: vi.fn(), editPRComment: vi.fn(),
  deletePRComment: vi.fn(), mergePR: vi.fn(), reviewPR: vi.fn(),
  classifyGhFailure: () => ({ tone: 'warn', cause: 'diff failed', notes: [], fix: null, fixHint: null }),
  failureGlyph: () => '!',
}))

const { useDiffState } = await import('./state.js')
const { DiffView } = await import('./render.jsx')
const { resetGhMemoryCache } = await import('../../../hooks/useGh.js')

const PATCH = '@@ -1 +1 @@\n-oldValue\n+newValue'
const LIST = { files: [{ path: 'src/code.js', additions: 1, deletions: 1, changeType: 'MODIFIED' }], hasNextPage: false, endCursor: null, totalCount: 1 }
const okPatch = (patch = PATCH) => ({ status: 'ok', patch, oldPath: null, additions: 1, deletions: 1 })
const secondary = ['getPR', 'getRepoInfo', 'listPRCommentsPage']

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
const mount = (n) => renderWithProviders(<Session n={n} />)

describe('diff open order (#451, #509)', () => {
  it('requests only the file list first, shows the files at once, then loads patches and secondary data', async () => {
    const view = mount(451)
    await waitForExpectation(() => expect(h.calls).toContain('listPRFilesPage'))
    // Nothing else may compete with the file list for the gh concurrency cap.
    expect(h.calls).toEqual(['listPRFilesPage'])

    h.pending.listPRFilesPage.resolve(LIST)
    await waitForExpectation(() => expect(view.lastFrame()).toContain('src/code.js'))
    expect(view.lastFrame()).toContain('file 1 of 1')
    // The file's patch is requested on demand; the whole diff is never downloaded.
    await waitForExpectation(() => expect(h.calls).toContain('patch:src/code.js'))
    expect(h.calls).not.toContain('getPRDiff')
    await waitForExpectation(() => expect(h.calls).toEqual(expect.arrayContaining(secondary)))
    h.pending['patch:src/code.js'].resolve(okPatch())
    await waitForExpectation(() => expect(view.lastFrame()).toContain('newValue'))
    expect(h.calls).not.toContain('getPRDiffStats')
  })

  it('loads a huge single file without a size gate (#509)', async () => {
    const view = mount(452)
    await waitForExpectation(() => expect(h.calls).toContain('listPRFilesPage'))
    h.pending.listPRFilesPage.resolve({ ...LIST, files: [{ path: 'a.js', additions: 5001, deletions: 0, changeType: 'MODIFIED' }] })
    await waitForExpectation(() => expect(h.calls).toContain('patch:a.js'))
    h.pending['patch:a.js'].resolve(okPatch(['@@ -1 +1,5001 @@', ...Array.from({ length: 5001 }, (_, i) => `+line ${i}`)].join('\n')))
    await waitForExpectation(() => expect(currentState.rows.length).toBe(5003))
    expect(view.lastFrame()).not.toContain('Large diff')
    expect(view.lastFrame()).toContain('+5001')
  })

  it('says so for a file GitHub will not render instead of dropping it', async () => {
    const view = mount(453)
    await waitForExpectation(() => expect(h.calls).toContain('listPRFilesPage'))
    h.pending.listPRFilesPage.resolve(LIST)
    await waitForExpectation(() => expect(h.calls).toContain('patch:src/code.js'))
    h.pending['patch:src/code.js'].resolve({ status: 'omitted', patch: null, oldPath: null, additions: 9000, deletions: 0 })
    await waitForExpectation(() => expect(view.lastFrame()).toContain('does not render'))
    expect(view.lastFrame()).toContain('src/code.js')
  })
})

describe('diff open: errors and retry (#451)', () => {
  it('shows a retryable error when the file list fails (including a too-large diff), then loads on retry', async () => {
    const view = mount(461)
    await waitForExpectation(() => expect(h.calls).toContain('listPRFilesPage'))
    h.pending.listPRFilesPage.reject(new Error('boom'))
    await waitForExpectation(() => expect(view.lastFrame()).toMatch(/retry/))
    expect(h.calls).toEqual(['listPRFilesPage'])
    await sendInput(firstActionKey('list.refresh', 'r'))
    await waitForExpectation(() => expect(h.calls).toEqual(['listPRFilesPage', 'listPRFilesPage']))
    h.pending.listPRFilesPage.resolve(LIST)
    await waitForExpectation(() => expect(view.lastFrame()).toContain('src/code.js'))
    await waitForExpectation(() => expect(h.calls).toEqual(expect.arrayContaining(secondary)))
  })

  it('does not count +++/--- content lines inside a hunk as headers', async () => {
    mount(462)
    await waitForExpectation(() => expect(h.calls).toContain('listPRFilesPage'))
    h.pending.listPRFilesPage.resolve({ ...LIST, files: [{ path: 'a.sql', additions: 2600, deletions: 2600, changeType: 'MODIFIED' }] })
    await waitForExpectation(() => expect(h.calls).toContain('patch:a.sql'))
    const lines = ['@@ -1 +1 @@']
    for (let i = 0; i < 2600; i++) lines.push(`+++i${i}`, `--- sql${i}`)
    h.pending['patch:a.sql'].resolve(okPatch(lines.join('\n')))
    await waitForExpectation(() => expect(currentState.files[0].addCount).toBe(2600))
    expect(currentState.files[0].delCount).toBe(2600)
    expect(currentState.files).toHaveLength(1)
  })
})

describe('diff loading frame (#454)', () => {
  it('shows a skeleton with header on the first frame, not a bare spinner', async () => {
    const view = mount(454)
    // Under the 150 ms delay nothing new is drawn (the footer chrome only); then the skeleton.
    expect(view.lastFrame()).not.toContain('░')
    await waitForExpectation(() => expect(view.lastFrame()).toContain('░'))
    const frame = view.lastFrame()
    expect(frame).toContain('PR #454 Diff')
    expect(frame).not.toContain('Loading diff')
  })

  it('renders a cached file list immediately with no loading frame', async () => {
    const first = mount(455)
    await waitForExpectation(() => expect(h.calls).toContain('listPRFilesPage'))
    h.pending.listPRFilesPage.resolve(LIST)
    await waitForExpectation(() => expect(first.lastFrame()).toContain('src/code.js'))
    cleanup()

    const second = mount(455)
    expect(second.lastFrame()).toContain('src/code.js')
    expect(second.lastFrame()).not.toContain('░')
  })
})

describe('diff with a cached file list on disk (#451/#454)', () => {
  const seedDiskList = (n) => writeCache(mkDiskKey(['load/order', 'listPRDiffFiles', ['load/order', n, '']]), LIST, { repo: 'load/order', op: 'listPRDiffFiles' })

  it('does not start secondary calls until the revalidation of a cached list lands', async () => {
    seedDiskList(470)
    const view = mount(470)
    expect(view.lastFrame()).toContain('src/code.js')
    await waitForExpectation(() => expect(h.calls).toContain('listPRFilesPage'))
    expect(h.calls.filter(c => secondary.includes(c))).toEqual([])
    h.pending.listPRFilesPage.resolve(LIST)
    await waitForExpectation(() => expect(h.calls).toEqual(expect.arrayContaining(secondary)))
  })

  it('keeps the cached list and shows a banner when the revalidation fails', async () => {
    seedDiskList(471)
    const view = mount(471)
    await waitForExpectation(() => expect(h.calls).toContain('listPRFilesPage'))
    h.pending.listPRFilesPage.reject(new Error('network down'))
    await waitForExpectation(() => expect(view.lastFrame()).toContain('refresh failed'))
    expect(view.lastFrame()).toContain('src/code.js')
  })
})
