import React from 'react'
import { Text } from 'ink'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { render, cleanup } from 'ink-testing-library'
import { createQueryClient, keyString, useQuery, useInfiniteQuery } from './queryClient.js'
import { flush, waitForExpectation } from '../test/test-helpers.jsx'

function defer() {
  let resolve, reject
  const promise = new Promise((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

describe('queryClient core (no Ink)', () => {
  it('structured keys serialise the same way every time', () => {
    expect(keyString(['pr', 'o/r', 7])).toBe(keyString(['pr', 'o/r', 7]))
    expect(keyString(['pr', 'o/r', 7])).not.toBe(keyString(['pr', 'o/r', 8]))
  })

  it('identical keys share one in-flight promise; a different key does not', async () => {
    const client = createQueryClient()
    const d = defer()
    let calls = 0
    const fetcher = () => { calls++; return d.promise }
    const a = client.fetch('k', fetcher)
    const b = client.fetch('k', fetcher)
    const c = client.fetch('other', fetcher)
    expect(a.promise).toBe(b.promise)
    expect(a.shared).toBe(false)
    expect(b.shared).toBe(true)
    expect(calls).toBe(2)
    d.resolve('V')
    await expect(a.promise).resolves.toBe('V')
    await c.promise
    expect(client.get('k').data).toBe('V')
    expect(client.isInflight('k')).toBe(false)
  })

  it('force starts a new fetch, and the older result never reaches the cache', async () => {
    const client = createQueryClient()
    const old = defer(), fresh = defer()
    const first = client.fetch('k', () => old.promise)
    const second = client.fetch('k', () => fresh.promise, { force: true })
    expect(second.promise).not.toBe(first.promise)
    fresh.resolve('NEW')
    await second.promise
    old.resolve('OLD')
    await first.promise
    expect(client.get('k').data).toBe('NEW')
  })

  it('aborts the fetch only once every caller has released', async () => {
    const client = createQueryClient()
    let signal
    const d = defer()
    const a = client.fetch('k', ctx => { signal = ctx.signal; return d.promise })
    const b = client.fetch('k', () => d.promise)
    a.release()
    expect(signal.aborted).toBe(false)
    b.release()
    b.release() // idempotent
    expect(signal.aborted).toBe(true)
    expect(client.isInflight('k')).toBe(false)
    d.resolve('late')
    await a.promise
    expect(client.get('k')).toBeUndefined() // an abandoned result is not cached
  })

  it('a failed fetch is shared, not cached, and the next call retries', async () => {
    const client = createQueryClient()
    const a = client.fetch('k', async () => { throw new Error('boom') })
    const b = client.fetch('k', async () => 'unused')
    await expect(a.promise).rejects.toThrow('boom')
    await expect(b.promise).rejects.toThrow('boom')
    expect(client.get('k')).toBeUndefined()
    await expect(client.fetch('k', async () => 'ok').promise).resolves.toBe('ok')
  })

  it('the memory cache is bounded by bytes', async () => {
    const client = createQueryClient({ maxBytes: 1000 })
    for (let i = 0; i < 5; i++) await client.fetch(`k${i}`, async () => 'x'.repeat(400)).promise
    expect(client.stats().bytes).toBeLessThanOrEqual(1000)
    expect(client.stats().size).toBeLessThan(5)
    expect(client.get('k4')).toBeDefined()
  })
})

describe('useQuery', () => {
  let client
  beforeEach(() => { client = createQueryClient() })
  afterEach(() => cleanup())

  it('two components with the same key make one fetch', async () => {
    const d = defer()
    let calls = 0
    const fetcher = () => { calls++; return d.promise }
    function View({ id }) {
      const { data, loading } = useQuery(['dedupe'], fetcher, { client })
      return <Text>{`${id}:${data ?? 'none'}:${loading}`}</Text>
    }
    const a = render(<View id="a" />)
    const b = render(<View id="b" />)
    await flush(10)
    expect(calls).toBe(1)
    d.resolve('V')
    await flush(20)
    expect(a.lastFrame()).toContain('a:V:false')
    expect(b.lastFrame()).toContain('b:V:false')
    expect(calls).toBe(1)
  })

  it('drops a stale response after the key changed (#434)', async () => {
    const pending = { old: defer(), new: defer() }
    function View({ k }) {
      const { data, loading } = useQuery(['race', k], () => pending[k].promise, { client })
      return <Text>{`data=${data ?? 'none'} loading=${loading}`}</Text>
    }
    const view = render(<View k="old" />)
    await flush(10)
    view.rerender(<View k="new" />)
    await flush(10)
    pending.old.resolve('OLD') // lands while the new request is still in flight
    await flush(20)
    expect(view.lastFrame()).toContain('data=none loading=true')
    pending.new.resolve('NEW')
    await flush(20)
    expect(view.lastFrame()).toContain('data=NEW loading=false')
    expect(client.get(keyString(['race', 'old']))).toBeUndefined()
  })

  it('aborts the request when the key changes away from it', async () => {
    const signals = {}
    function View({ k }) {
      useQuery(['abort', k], ({ signal }) => { signals[k] = signal; return new Promise(() => {}) }, { client })
      return <Text>x</Text>
    }
    const view = render(<View k="a" />)
    await flush(10)
    view.rerender(<View k="b" />)
    await flush(10)
    expect(signals.a.aborted).toBe(true)
    expect(signals.b.aborted).toBe(false)
  })

  it('a cache hit renders data on the first frame: no loading frame', async () => {
    client.set(keyString(['seed']), 'HIT')
    let calls = 0
    const frames = []
    function View() {
      const { data, loading, isStale } = useQuery(['seed'], async () => { calls++; return 'x' }, { client })
      frames.push(`data=${data} loading=${loading} stale=${isStale}`)
      return <Text>{frames[frames.length - 1]}</Text>
    }
    render(<View />)
    expect(frames[0]).toBe('data=HIT loading=false stale=false')
    await flush(20)
    expect(calls).toBe(0) // fresh: no refetch
    expect(frames.every(f => !f.includes('loading=true'))).toBe(true)
  })

  it('serves stale data and revalidates in the background', async () => {
    client.set(keyString(['swr']), 'OLD', Date.now() - 10_000)
    const d = defer()
    const frames = []
    function View() {
      const { data, loading, isStale } = useQuery(['swr'], () => d.promise, { client, ttl: 1000 })
      frames.push(`data=${data} loading=${loading} stale=${isStale}`)
      return <Text>{frames[frames.length - 1]}</Text>
    }
    const view = render(<View />)
    expect(frames[0]).toBe('data=OLD loading=false stale=true')
    await flush(10)
    expect(view.lastFrame()).toContain('data=OLD loading=false stale=true')
    d.resolve('FRESH')
    await flush(20)
    expect(view.lastFrame()).toContain('data=FRESH loading=false stale=false')
    expect(frames.some(f => f.includes('loading=true'))).toBe(false)
  })

  it('an error keeps the stale data and reports isStale', async () => {
    client.set(keyString(['err']), 'OLD', Date.now() - 10_000)
    function View() {
      const { data, error, isStale } = useQuery(['err'], async () => { throw new Error('boom') }, { client, ttl: 1000 })
      return <Text>{`data=${data} error=${error?.message} stale=${isStale}`}</Text>
    }
    const view = render(<View />)
    await waitForExpectation(() => expect(view.lastFrame()).toContain('error=boom'))
    expect(view.lastFrame()).toContain('data=OLD')
    expect(view.lastFrame()).toContain('stale=true')
  })

  it('refetch bypasses the TTL', async () => {
    let n = 0
    let api
    function View() {
      api = useQuery(['ttl'], async () => ++n, { client, ttl: 60_000 })
      return <Text>{`n=${api.data}`}</Text>
    }
    const view = render(<View />)
    await flush(20)
    expect(view.lastFrame()).toContain('n=1')
    view.unmount()
    const again = render(<View />)
    await flush(20)
    expect(n).toBe(1) // within the TTL: served from cache
    api.refetch()
    await flush(20)
    expect(again.lastFrame()).toContain('n=2')
  })
})

describe('useInfiniteQuery', () => {
  let client
  beforeEach(() => { client = createQueryClient() })
  afterEach(() => cleanup())

  // Four items per page, 10 in total, cursor = offset.
  const makeSource = () => {
    const calls = []
    const fetchPage = async ({ cursor }) => {
      const start = cursor ?? 0
      calls.push(start)
      const items = Array.from({ length: Math.min(4, 10 - start) }, (_, i) => `i${start + i}`)
      return { items, total: 10, next: start + 4 < 10 ? start + 4 : null }
    }
    return { calls, fetchPage }
  }
  const opts = { getNextCursor: p => p.next, getTotal: p => p.total, getCapped: p => Boolean(p.capped) }

  it('pages by cursor, never refetches earlier pages, reports loaded/total/hasMore', async () => {
    const { calls, fetchPage } = makeSource()
    let api
    function View() {
      api = useInfiniteQuery(['list'], fetchPage, { ...opts, client })
      return <Text>{`${api.loaded} of ${api.total} more=${api.hasMore} loading=${api.loading}`}</Text>
    }
    const view = render(<View />)
    await waitForExpectation(() => expect(view.lastFrame()).toContain('4 of 10 more=true loading=false'))
    api.fetchNextPage()
    api.fetchNextPage() // a second call while one is in flight is ignored
    await waitForExpectation(() => expect(view.lastFrame()).toContain('8 of 10'))
    api.fetchNextPage()
    await waitForExpectation(() => expect(view.lastFrame()).toContain('10 of 10 more=false'))
    expect(calls).toEqual([0, 4, 8]) // each page exactly once
    expect(api.items).toEqual(Array.from({ length: 10 }, (_, i) => `i${i}`))
    api.fetchNextPage() // nothing left
    await flush(10)
    expect(calls).toEqual([0, 4, 8])
  })

  it('refetch refreshes page 1 only and keeps the later pages', async () => {
    const { calls, fetchPage } = makeSource()
    let version = 0
    const versioned = async ctx => {
      const page = await fetchPage(ctx)
      return ctx.cursor == null ? { ...page, items: page.items.map(i => `${i}v${version}`) } : page
    }
    let api
    function View() {
      api = useInfiniteQuery(['refresh'], versioned, { ...opts, client })
      return <Text>{`loaded=${api.loaded}`}</Text>
    }
    const view = render(<View />)
    await waitForExpectation(() => expect(view.lastFrame()).toContain('loaded=4'))
    api.fetchNextPage()
    await waitForExpectation(() => expect(view.lastFrame()).toContain('loaded=8'))
    version = 1
    api.refetch()
    await waitForExpectation(() => expect(api.items[0]).toBe('i0v1'))
    expect(api.loaded).toBe(8)
    expect(api.items[4]).toBe('i4') // page 2 untouched
    expect(calls).toEqual([0, 4, 0])
  })

  it('seeds every loaded page synchronously from the cache', async () => {
    const { calls, fetchPage } = makeSource()
    let api
    function View() {
      api = useInfiniteQuery(['seeded'], fetchPage, { ...opts, client })
      return <Text>{`loaded=${api.loaded}`}</Text>
    }
    const first = render(<View />)
    await waitForExpectation(() => expect(first.lastFrame()).toContain('loaded=4'))
    api.fetchNextPage()
    await waitForExpectation(() => expect(first.lastFrame()).toContain('loaded=8'))
    first.unmount()
    const frames = []
    function Again() {
      const q = useInfiniteQuery(['seeded'], fetchPage, { ...opts, client })
      frames.push(`loaded=${q.loaded} loading=${q.loading}`)
      return <Text>x</Text>
    }
    render(<Again />)
    expect(frames[0]).toBe('loaded=8 loading=false')
    await flush(20)
    expect(calls).toEqual([0, 4]) // fresh: nothing refetched
  })

  it('drops a page that lands after the key changed', async () => {
    const slow = defer()
    const source = async ({ cursor }) => (cursor == null
      ? { items: ['a'], total: 2, next: 1 }
      : slow.promise)
    let api
    function View({ k }) {
      api = useInfiniteQuery(['stale', k], k === 'one' ? source : async () => ({ items: ['z'], total: 1, next: null }), { ...opts, client })
      return <Text>{api.items.join(',')}</Text>
    }
    const view = render(<View k="one" />)
    await waitForExpectation(() => expect(view.lastFrame()).toContain('a'))
    api.fetchNextPage()
    view.rerender(<View k="two" />)
    await waitForExpectation(() => expect(view.lastFrame()).toContain('z'))
    slow.resolve({ items: ['LATE'], total: 2, next: null })
    await flush(20)
    expect(view.lastFrame()).toBe('z')
  })

  it('says so when the source is capped', async () => {
    let api
    function View() {
      api = useInfiniteQuery(['capped'], async () => ({ items: ['a', 'b'], total: 500, next: null, capped: true }), { ...opts, client })
      return <Text>{`capped=${api.capped} more=${api.hasMore} of=${api.total}`}</Text>
    }
    const view = render(<View />)
    await waitForExpectation(() => expect(view.lastFrame()).toBe('capped=true more=false of=500'))
  })
})
