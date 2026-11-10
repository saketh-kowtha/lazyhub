import React from 'react'
import { Text } from 'ink'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { usePRDiffFiles } from './files.js'
import { resetGhMemoryCache } from '../../../hooks/useGh.js'
import { listPRFilesPage, getPRFilePatch, getPR } from '../../../executor.js'
import { cleanup, flush, renderWithProviders, waitForExpectation } from '../../../test/test-helpers.jsx'
import { resetHeadHints, HeadMovedError, fetchDiffFiles, prMetaKey } from './keys.js'
import { queryClient } from '../../../data/queryClient.js'

vi.mock('../../../executor.js', () => ({ listPRFilesPage: vi.fn(), getPRFilePatch: vi.fn(), getPR: vi.fn() }))

// Head-SHA-keyed immutable reads (V4b, #597): reopening the diff of the same SHA makes no gh call.
const A = 'a'.repeat(40)
const B = 'b'.repeat(40)
const files = n => Array.from({ length: n }, (_, i) => ({ path: `src/f${i}.js`, additions: 2, deletions: 1, changeType: 'MODIFIED' }))
const page = (sha, n = 3) => ({ files: files(n), hasNextPage: false, endCursor: null, totalCount: n, headRefOid: sha })
const patchFor = (path, sha) => ({ status: 'ok', patch: `@@ -1,2 +1,3 @@\n a\n-b\n+c ${path}\n+d`, oldPath: null, additions: 2, deletions: 1, headSha: sha })
const calls = () => listPRFilesPage.mock.calls.length + getPRFilePatch.mock.calls.length + getPR.mock.calls.length

let latest
const modes = []
function Probe({ n = 7 }) {
  latest = usePRDiffFiles({ repo: 'o/r', prNumber: n, focusIndex: 0 })
  modes.push(latest.mode)
  return <Text>{`files=${latest.files.length} loaded=${latest.loadedFiles}`}</Text>
}

beforeEach(() => {
  vi.clearAllMocks()
  modes.length = 0
  resetGhMemoryCache()
  resetHeadHints()
  listPRFilesPage.mockImplementation(async () => page(A))
  getPR.mockResolvedValue({ headRefOid: A })
  getPRFilePatch.mockImplementation(async (_r, _n, path) => patchFor(path, A))
})
afterEach(() => cleanup())

describe('diff reads keyed by head SHA (#597, V4b)', () => {
  it('reopening the diff of the same SHA makes 0 gh calls', async () => {
    const first = renderWithProviders(<Probe n={10} />)
    await waitForExpectation(() => expect(first.lastFrame()).toContain('loaded=3'))
    await waitForExpectation(() => expect(getPR).toHaveBeenCalled()) // the detail follows the list on a cold open
    await flush(20)
    first.unmount()
    vi.clearAllMocks()

    const second = renderWithProviders(<Probe n={10} />)
    await waitForExpectation(() => expect(second.lastFrame()).toContain('loaded=3'))
    await flush(20)
    expect(calls()).toBe(0)
    expect(latest.mode).toBe('data')
  })

  it('a cold open leads with the file list alone, then keys by the SHA it returned', async () => {
    renderWithProviders(<Probe n={11} />)
    await waitForExpectation(() => expect(latest.files).toHaveLength(3))
    // One list call in total: the SHA-keyed key was seeded from the response, not fetched again.
    await flush(20)
    expect(listPRFilesPage).toHaveBeenCalledTimes(1)
  })

  it('a push changes the SHA: the new head is fetched and old patches are not reused', async () => {
    const view = renderWithProviders(<Probe n={12} />)
    await waitForExpectation(() => expect(view.lastFrame()).toContain('loaded=3'))
    await waitForExpectation(() => expect(getPR).toHaveBeenCalled())
    await flush(20)
    view.unmount()
    vi.clearAllMocks()
    modes.length = 0

    // The PR detail (shared with the detail view) learns of the push.
    queryClient.setQueryData(prMetaKey('o/r', 12), { headRefOid: B })
    listPRFilesPage.mockImplementation(async () => page(B, 2))
    getPRFilePatch.mockImplementation(async (_r, _n, path) => patchFor(path, B))
    const again = renderWithProviders(<Probe n={12} />)
    await waitForExpectation(() => expect(again.lastFrame()).toContain('files=2'))
    expect(listPRFilesPage).toHaveBeenCalledTimes(1)
    await waitForExpectation(() => expect(again.lastFrame()).toContain('loaded=2'))
    expect(getPRFilePatch.mock.calls.length).toBeGreaterThan(0)
    expect(getPRFilePatch.mock.calls.length).toBeLessThanOrEqual(2)
  })

  it('a manual refresh reads GitHub again and never blanks the view', async () => {
    const view = renderWithProviders(<Probe n={13} />)
    await waitForExpectation(() => expect(view.lastFrame()).toContain('loaded=3'))
    await flush(20)
    modes.length = 0
    vi.clearAllMocks()
    latest.refetch()
    await waitForExpectation(() => expect(listPRFilesPage).toHaveBeenCalled())
    await waitForExpectation(() => expect(getPRFilePatch).toHaveBeenCalled())
    await flush(20)
    expect(modes.length).toBeGreaterThan(0)
    expect(modes.every(m => m === 'data')).toBe(true)
  })

  it('never stores a response from a newer head under the older SHA key', async () => {
    listPRFilesPage.mockImplementation(async () => page(B))
    await expect(fetchDiffFiles('o/r', 14, A)).rejects.toBeInstanceOf(HeadMovedError)
    // The page for the head that was really returned is seeded under B's key and is what a reader finds.
    getPR.mockResolvedValue({ headRefOid: B })
    const view = renderWithProviders(<Probe n={14} />)
    await waitForExpectation(() => expect(view.lastFrame()).toContain('files=3'))
  })
})
