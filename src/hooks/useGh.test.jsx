import React from 'react'
import { Text } from 'ink'
import { describe, expect, it } from 'vitest'
import { render, cleanup } from 'ink-testing-library'
import { useGh, resetGhMemoryCache, ghMemoryCacheStats, GH_MEMORY_MAX_BYTES } from './useGh.js'
import { mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import { CACHE_DIR, cacheKey as mkDiskKey, writeCache } from '../cache.js'
import { flush, waitForExpectation } from '../test/test-helpers.jsx'

function defer() {
  let resolve
  const promise = new Promise(r => { resolve = r })
  return { promise, resolve }
}

describe('useGh async races (#434)', () => {
  it('a slow response for the previous deps must not overwrite the newer deps', async () => {
    const pending = { 'a/old': defer(), 'a/new': defer() }
    async function raceFetchRepoPRs(repo) { return pending[repo].promise }

    function View({ repo }) {
      const { data, loading } = useGh(raceFetchRepoPRs, [repo])
      return <Text>{`data=${data ?? 'none'} loading=${loading}`}</Text>
    }

    const view = render(<View repo="a/old" />)
    await flush(10)
    view.rerender(<View repo="a/new" />)
    await flush(10)
    pending['a/new'].resolve('NEW')
    await flush(20)
    expect(view.lastFrame()).toContain('data=NEW')
    pending['a/old'].resolve('OLD')
    await flush(20)
    expect(view.lastFrame()).toContain('data=NEW')
    cleanup()
  })

  it('an old response landing while the new request is in flight must not clear loading', async () => {
    const pending = { 1: defer(), 2: defer() }
    async function raceFetchOne(n) { return pending[n].promise }

    function View({ n }) {
      const { data, loading } = useGh(raceFetchOne, [n])
      return <Text>{`data=${data ?? 'none'} loading=${loading}`}</Text>
    }

    const view = render(<View n={1} />)
    await flush(10)
    view.rerender(<View n={2} />)
    await flush(10)
    pending[1].resolve('ONE')
    await flush(20)
    expect(view.lastFrame()).not.toContain('data=ONE')
    expect(view.lastFrame()).toContain('loading=true')
    cleanup()
  })
})

describe('useGh enabled option (#451)', () => {
  it('defers the fetch until enabled, and a true->false flip does not strand loading', async () => {
    const d = defer()
    let calls = 0
    async function gatedFetch() { calls++; return d.promise }
    function View({ on }) {
      const { data, loading } = useGh(gatedFetch, ['g'], { enabled: on })
      return <Text>{`data=${data ?? 'none'} loading=${loading}`}</Text>
    }
    const view = render(<View on={false} />)
    await flush(10)
    expect(calls).toBe(0)
    view.rerender(<View on={true} />)
    await flush(10)
    expect(calls).toBe(1)
    expect(view.lastFrame()).toContain('loading=true')
    view.rerender(<View on={false} />)
    await flush(10)
    expect(view.lastFrame()).toContain('loading=false')
    cleanup()
  })
})

describe('useGh stale-while-revalidate (#454)', () => {
  it('renders cached data on the very first frame with no loading frame', async () => {
    const second = defer()
    let call = 0
    async function swrFetch() { call++; return call === 1 ? 'CACHED' : second.promise }

    const frames = []
    function View() {
      const { data, loading, isStale } = useGh(swrFetch, ['x'], { ttl: 0 })
      frames.push(`data=${data ?? 'none'} loading=${loading} stale=${isStale}`)
      return <Text>{frames[frames.length - 1]}</Text>
    }

    const first = render(<View />)
    await flush(20)
    expect(first.lastFrame()).toContain('data=CACHED')
    first.unmount()

    frames.length = 0
    const view = render(<View />)
    expect(frames[0]).toBe('data=CACHED loading=false stale=true')
    expect(view.lastFrame()).toContain('data=CACHED')
    await flush(20)
    expect(frames.some(f => f.includes('data=none') || f.includes('loading=true'))).toBe(false)
    second.resolve('FRESH')
    await flush(20)
    expect(view.lastFrame()).toContain('data=FRESH loading=false stale=false')
    cleanup()
  })
})

describe('useGh seeding (#454)', () => {
  it('seeds from fresh memory cache without refetching', async () => {
    let calls = 0
    async function memSeedFetch() { calls++; return 'MEM' }
    const frames = []
    function View() {
      const { data, loading, isStale } = useGh(memSeedFetch, ['m'])
      frames.push(`data=${data ?? 'none'} loading=${loading} stale=${isStale}`)
      return <Text>{frames[frames.length - 1]}</Text>
    }
    const first = render(<View />)
    await flush(20)
    first.unmount()
    frames.length = 0
    render(<View />)
    await flush(20)
    expect(frames[0]).toBe('data=MEM loading=false stale=false')
    expect(calls).toBe(1)
    cleanup()
  })

  it('seeds from the disk cache alone as stale, then revalidates', async () => {
    const d = defer()
    async function diskSeedFetch() { return d.promise }
    writeCache(mkDiskKey(['o/r', 'diskSeedFetch', ['o/r', 1]]), 'DISK', { repo: 'o/r', op: 'diskSeedFetch' })
    const frames = []
    function View() {
      const { data, loading, isStale } = useGh(diskSeedFetch, ['o/r', 1])
      frames.push(`data=${data ?? 'none'} loading=${loading} stale=${isStale}`)
      return <Text>{frames[frames.length - 1]}</Text>
    }
    const view = render(<View />)
    expect(frames[0]).toBe('data=DISK loading=false stale=true')
    await flush(20)
    expect(frames.some(f => f.includes('loading=true'))).toBe(false)
    d.resolve('NET')
    await flush(20)
    expect(view.lastFrame()).toContain('data=NET loading=false stale=false')
    cleanup()
  })

  it('re-seeds when the key changes so the previous key data is never shown', async () => {
    const d = defer()
    async function reseedFetch(id) { return id === 'a' ? 'DATA-A' : d.promise }
    // Recorded in the render body (not an effect): this is every frame the hook
    // returned, in order, so a one-render stale seed cannot hide (#548).
    const renders = []
    function View({ id }) {
      const { data, loading } = useGh(reseedFetch, [id])
      const line = `${id}:data=${data ?? 'none'} loading=${loading}`
      renders.push(line)
      return <Text>{line}</Text>
    }
    const view = render(<View id="a" />)
    // Wait for A to fully settle (data AND loading=false) instead of a fixed sleep:
    // under coverage the trailing loading=false render used to land after the reset
    // below and be mistaken for the first frame of key B.
    await waitForExpectation(() => expect(view.lastFrame()).toContain('a:data=DATA-A loading=false'))
    renders.length = 0
    view.rerender(<View id="b" />)
    await waitForExpectation(() => expect(view.lastFrame()).toContain('b:data=none loading=true'))
    const bRenders = renders.filter(f => f.startsWith('b:'))
    expect(bRenders.length).toBeGreaterThan(0)
    expect(bRenders[0]).toBe('b:data=none loading=true')
    expect(bRenders.every(f => !f.includes('DATA-A'))).toBe(true)
    // The key changed in one step: no render pairs key b with key a's data.
    expect(renders.some(f => f.startsWith('b:') && f.includes('DATA-A'))).toBe(false)
    cleanup()
  })
})

describe('useGh disk cache off the input path (#455)', () => {
  it('a mount never reads the cache file synchronously: a cold entry arrives via the async read while the fetch is in flight', async () => {
    mkdirSync(CACHE_DIR, { recursive: true })
    const key = mkDiskKey(['o/cold', 'coldFetch', ['o/cold', 7]])
    // Written by an earlier session / another process: not in the in-memory mirror.
    writeFileSync(join(CACHE_DIR, `${key}.json`), JSON.stringify({ meta: { repo: 'o/cold' }, ts: 1, payload: 'COLD-DISK' }))
    const d = defer()
    async function coldFetch() { return d.promise }
    const frames = []
    function View() {
      const { data, loading, isStale } = useGh(coldFetch, ['o/cold', 7])
      frames.push(`data=${data ?? 'none'} loading=${loading} stale=${isStale}`)
      return <Text>{frames[frames.length - 1]}</Text>
    }
    const view = render(<View />)
    // First frame is memory-only: a skeleton, not a blocking file read.
    expect(frames[0]).toBe('data=none loading=true stale=false')
    await waitForExpectation(() => expect(view.lastFrame()).toContain('data=COLD-DISK loading=false stale=true'))
    d.resolve('NET')
    await waitForExpectation(() => expect(view.lastFrame()).toContain('data=NET loading=false stale=false'))
    cleanup()
  })
})

describe('useGh in-memory cache is bounded by bytes (#457)', () => {
  it('evicts old large payloads instead of holding every one', async () => {
    resetGhMemoryCache()
    const big = 'd'.repeat(Math.floor(GH_MEMORY_MAX_BYTES * 0.4))
    for (let i = 0; i < 5; i++) {
      const fetchBig = async () => big + i
      Object.defineProperty(fetchBig, 'name', { value: `fetchBig${i}` })
      function View() { const { data } = useGh(fetchBig, [`o/big${i}`]); return <Text>{data ? 'ok' : 'wait'}</Text> }
      const v = render(<View />)
      await waitForExpectation(() => expect(v.lastFrame()).toBe('ok'))
      v.unmount()
    }
    const stats = ghMemoryCacheStats()
    expect(stats.size).toBeLessThan(5)
    expect(stats.bytes).toBeLessThanOrEqual(GH_MEMORY_MAX_BYTES)
    resetGhMemoryCache()
    cleanup()
  })
})
