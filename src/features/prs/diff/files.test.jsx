import React from 'react'
import { Text } from 'ink'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { usePRDiffFiles } from './files.js'
import { resetGhMemoryCache } from '../../../hooks/useGh.js'
import { listPRFilesPage, getPRFilePatch, getPR } from '../../../executor.js'
import { cleanup, flush, renderWithProviders, waitForExpectation } from '../../../test/test-helpers.jsx'
import { flattenFiles } from '../diff-parser.js'
import { resetHeadHints } from './keys.js'

vi.mock('../../../executor.js', () => ({ listPRFilesPage: vi.fn(), getPRFilePatch: vi.fn(), getPR: vi.fn() }))

const meta = n => Array.from({ length: n }, (_, i) => ({ path: `src/f${i}.js`, additions: 2, deletions: 1, changeType: 'MODIFIED' }))
const patchFor = path => ({ status: 'ok', patch: `@@ -1,2 +1,3 @@\n a\n-b\n+c ${path}\n+d`, oldPath: null, additions: 2, deletions: 1 })

let latest
function Probe({ focus = 0, budgetBytes, number = 7 }) {
  latest = usePRDiffFiles({ repo: 'o/r', prNumber: number, focusIndex: focus, budgetBytes })
  return <Text>{`files=${latest.files.length} loaded=${latest.loadedFiles}`}</Text>
}

beforeEach(() => {
  vi.clearAllMocks()
  resetGhMemoryCache()
  resetHeadHints()
  getPR.mockResolvedValue(null)
  getPRFilePatch.mockImplementation(async (_r, _n, path) => patchFor(path))
})
afterEach(() => cleanup())

describe('usePRDiffFiles (#509)', () => {
  it('shows the file list at once and loads only the files near the cursor', async () => {
    listPRFilesPage.mockResolvedValue({ files: meta(10), hasNextPage: false, endCursor: null, totalCount: 10 })
    const view = renderWithProviders(<Probe number={100} />)
    await waitForExpectation(() => expect(view.lastFrame()).toContain('files=10'))
    await waitForExpectation(() => expect(getPRFilePatch).toHaveBeenCalledTimes(3))
    expect(getPRFilePatch.mock.calls.map(c => c[2])).toEqual(['src/f0.js', 'src/f1.js', 'src/f2.js'])
    expect(getPRFilePatch.mock.calls[0][3]).toEqual({ indexHint: 0 })
    // Unloaded files are placeholders with a note; loaded ones carry parsed lines.
    expect(latest.files[0].lines.length).toBeGreaterThan(0)
    expect(latest.files[9].lines).toEqual([])
    expect(latest.files[9].note).toMatch(/Loading/)
    expect(latest.stats).toEqual({ additions: 20, deletions: 10, changedFiles: 10 })
  })

  it('loads a file on demand when the cursor reaches it', async () => {
    listPRFilesPage.mockResolvedValue({ files: meta(10), hasNextPage: false, endCursor: null, totalCount: 10 })
    const view = renderWithProviders(<Probe number={101} focus={0} />)
    await waitForExpectation(() => expect(getPRFilePatch).toHaveBeenCalledTimes(3))
    view.rerender(<Probe number={101} focus={8} />)
    await waitForExpectation(() => expect(getPRFilePatch.mock.calls.map(c => c[2])).toContain('src/f8.js'))
    await waitForExpectation(() => expect(latest.files[8].lines.length).toBeGreaterThan(0))
    expect(getPRFilePatch.mock.calls.find(c => c[2] === 'src/f8.js')[3]).toEqual({ indexHint: 8 })
  })

  it('pages the file list by cursor and never refetches an earlier page', async () => {
    listPRFilesPage
      .mockResolvedValueOnce({ files: meta(100), hasNextPage: true, endCursor: 'c1', totalCount: 230 })
      .mockResolvedValueOnce({ files: meta(230).slice(100, 200), hasNextPage: true, endCursor: 'c2', totalCount: 230 })
      .mockResolvedValueOnce({ files: meta(230).slice(200), hasNextPage: false, endCursor: null, totalCount: 230 })
    const view = renderWithProviders(<Probe number={102} />)
    await waitForExpectation(() => expect(view.lastFrame()).toContain('files=230'))
    expect(listPRFilesPage.mock.calls.map(c => c[2]?.after ?? null)).toEqual([null, 'c1', 'c2'])
    expect(latest.listComplete).toBe(true)
    expect(latest.totalFiles).toBe(230)
  })

  it('keeps a notice for files GitHub will not render, and for files that fail to load', async () => {
    listPRFilesPage.mockResolvedValue({ files: meta(3), hasNextPage: false, endCursor: null, totalCount: 3 })
    getPRFilePatch.mockImplementation(async (_r, _n, path) => {
      if (path.endsWith('f0.js')) return { status: 'omitted', patch: null, oldPath: null, additions: 9000, deletions: 0 }
      if (path.endsWith('f1.js')) return { status: 'empty', patch: null, oldPath: null, additions: 0, deletions: 0 }
      throw new Error('HTTP 502')
    })
    renderWithProviders(<Probe number={103} />)
    await waitForExpectation(() => expect(latest.files[2].note).toMatch(/Could not load this file: HTTP 502/))
    expect(latest.files[0].note).toMatch(/does not render/)
    expect(latest.files[1].note).toMatch(/No textual changes/)
    // The notices survive flattening into rows, so nothing is dropped silently.
    const rows = flattenFiles(latest.files)
    expect(rows.filter(r => r.type === 'file-note').map(r => r.text)).toHaveLength(3)
  })

  it('evicts files far from the cursor when over the byte budget, and reloads them when revisited', async () => {
    listPRFilesPage.mockResolvedValue({ files: meta(12), hasNextPage: false, endCursor: null, totalCount: 12 })
    const view = renderWithProviders(<Probe number={104} focus={0} budgetBytes={150} />)
    await waitForExpectation(() => expect(getPRFilePatch).toHaveBeenCalledTimes(3))
    view.rerender(<Probe number={104} focus={10} budgetBytes={150} />)
    await waitForExpectation(() => expect(latest.files[10].lines.length).toBeGreaterThan(0))
    await flush(20)
    expect(latest.files[0].lines).toEqual([])
    const before = getPRFilePatch.mock.calls.length
    view.rerender(<Probe number={104} focus={0} budgetBytes={150} />)
    await waitForExpectation(() => expect(latest.files[0].lines.length).toBeGreaterThan(0))
    expect(getPRFilePatch.mock.calls.length).toBeGreaterThan(before)
  })
})
