import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { rmSync } from 'node:fs'
import { Text } from 'ink'
import { cleanup, flush, renderWithProviders, waitForExpectation } from '../../../test/test-helpers.jsx'

const h = vi.hoisted(() => {
  process.env.LAZYHUB_CACHE_DIR = `${process.env.TMPDIR || '/tmp'}/lazyhub-prefetch-${process.pid}`
  const calls = []
  const pending = []
  return { calls, pending }
})

vi.mock('../../../executor.js', () => ({
  getPR: async function getPR() { return null },
  getPRFilePatch: async function getPRFilePatch() { return null },
  // Named function: useGh keys its cache by fn.name.
  listPRFilesPage: async function listPRFilesPage(repo, n, opts) {
    h.calls.push({ repo, n, opts })
    return new Promise((resolve) => { h.pending.push(resolve) })
  },
}))

const { resetHeadHints } = await import('./keys.js')
const { prefetchPRDiff, usePrefetchPRDiff, PREFETCH_REST_MS } = await import('./prefetch.js')
const { useGh, resetGhMemoryCache } = await import('../../../hooks/useGh.js')
const { listPRDiffFiles } = await import('./keys.js')

const LIST = { files: [{ path: 'a.js', additions: 1, deletions: 0, changeType: 'MODIFIED' }], hasNextPage: false, endCursor: null, totalCount: 1 }

beforeEach(() => {
  resetGhMemoryCache()
  resetHeadHints()
  rmSync(process.env.LAZYHUB_CACHE_DIR, { recursive: true, force: true })
  h.calls.length = 0
  h.pending.length = 0
})
afterEach(() => { cleanup(); rmSync(process.env.LAZYHUB_CACHE_DIR, { recursive: true, force: true }) })

function Opened({ n }) {
  const { data, loading } = useGh(listPRDiffFiles, ['o/r', n, ''])
  return <Text>{loading ? 'loading' : `files:${data?.files.length}`}</Text>
}

describe('diff prefetch (#482)', () => {
  it('asks for page 1 of the file list at low priority, once', () => {
    expect(prefetchPRDiff('o/r', 7)).toBe(true)
    expect(prefetchPRDiff('o/r', 7)).toBe(false) // already in flight
    expect(h.calls).toEqual([{ repo: 'o/r', n: 7, opts: { priority: 'low' } }])
  })

  it('is joined by the diff open: no second call, content at once when it landed', async () => {
    prefetchPRDiff('o/r', 8)
    h.pending[0](LIST)
    await waitForExpectation(() => expect(prefetchPRDiff('o/r', 8)).toBe(false)) // fresh entry now
    const view = renderWithProviders(<Opened n={8} />)
    await waitForExpectation(() => expect(view.lastFrame()).toContain('files:1'))
    expect(h.calls).toHaveLength(1)
  })

  it('joins an in-flight prefetch instead of starting a second request', async () => {
    prefetchPRDiff('o/r', 9)
    const view = renderWithProviders(<Opened n={9} />)
    expect(view.lastFrame()).toContain('loading')
    expect(h.calls).toHaveLength(1)
    h.pending[0](LIST)
    await waitForExpectation(() => expect(view.lastFrame()).toContain('files:1'))
    expect(h.calls).toHaveLength(1)
  })

  it('does nothing without a repo or number', () => {
    expect(prefetchPRDiff('', 1)).toBe(false)
    expect(prefetchPRDiff('o/r', null)).toBe(false)
    expect(h.calls).toHaveLength(0)
  })

  it('the hook waits for the cursor to rest, and a moving cursor never prefetches', async () => {
    function Rest({ n }) { usePrefetchPRDiff('o/r', n, 120); return <Text>x</Text> }
    const view = renderWithProviders(<Rest n={1} />)
    await flush(60)
    view.rerender(<Rest n={2} />)
    await flush(80)
    expect(h.calls).toHaveLength(0)
    await waitForExpectation(() => expect(h.calls.map(c => c.n)).toEqual([2]))
  })

  it('rests for 400 ms by default', () => {
    expect(PREFETCH_REST_MS).toBe(400)
  })
})
