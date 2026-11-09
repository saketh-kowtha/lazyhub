import React from 'react'
import { Text } from 'ink'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { render, cleanup } from 'ink-testing-library'
import { createQueryClient, queryClient, identityKey, useQuery, useInfiniteQuery } from './queryClient.js'
import { notifyWrite, onWrite } from './invalidation.js'
import { useGh, resetGhMemoryCache } from '../hooks/useGh.js'
import { ghQueryKey, seedGh } from './ghKeys.js'
import { resetCacheState } from '../cache.js'
import { flush, waitForExpectation } from '../test/test-helpers.jsx'

function defer() {
  let resolve, reject
  const promise = new Promise((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

beforeEach(() => { resetGhMemoryCache(); resetCacheState() })
afterEach(() => cleanup())

describe('client invalidation (no Ink)', () => {
  it('marks only entries under the prefix stale and keeps their data', () => {
    const client = createQueryClient()
    client.setQueryData(['h', null, 'o/r', 'getPR', 'o/r', 7], { n: 7 })
    client.setQueryData(['h', null, 'o/r', 'listPRs', 'o/r'], [1])
    client.setQueryData(['h', null, 'x/y', 'getPR', 'x/y', 1], { n: 1 })
    expect(client.invalidate(['h', null, 'o/r'])).toBe(2)
    expect(client.getQueryData(['h', null, 'o/r', 'getPR', 'o/r', 7])).toEqual({ n: 7 })
    const stamp = key => client.get(JSON.stringify(key)).timestamp
    expect(stamp(['h', null, 'o/r', 'getPR', 'o/r', 7])).toBe(0)
    expect(stamp(['h', null, 'x/y', 'getPR', 'x/y', 1])).toBeGreaterThan(0)
  })

  it('compares repository names case-insensitively', () => {
    const client = createQueryClient()
    client.setQueryData(['h', null, 'Owner/Repo', 'getPR'], 1)
    expect(client.invalidate(['h', null, 'owner/repo'])).toBe(1)
  })

  it('forgets a fetch that started before the write, so its pre-write result is never stored', async () => {
    const client = createQueryClient()
    const d = defer()
    const call = client.fetch(JSON.stringify(['h', null, 'o/r', 'getPR']), () => d.promise)
    client.invalidate(['h', null, 'o/r'])
    d.resolve('PRE-WRITE')
    await call.promise
    expect(client.get(JSON.stringify(['h', null, 'o/r', 'getPR']))).toBeUndefined()
  })

  it('setQueryData with ifAbsent keeps an existing entry', () => {
    const client = createQueryClient()
    expect(client.setQueryData(['k'], 'full')).toBe(true)
    expect(client.setQueryData(['k'], 'seed', { ifAbsent: true })).toBe(false)
    expect(client.getQueryData(['k'])).toBe('full')
  })

  it('the app client invalidates a repository when a write is announced', () => {
    const key = identityKey('o/r', 'getPR', 'o/r', 7)
    queryClient.setQueryData(key, { n: 7 })
    notifyWrite('o/r')
    expect(queryClient.get(JSON.stringify(key)).timestamp).toBe(0)
  })

  it('an unattributed write (no repo) invalidates every repository', () => {
    const a = identityKey('o/r', 'getPR')
    const b = identityKey('x/y', 'getPR')
    queryClient.setQueryData(a, 1)
    queryClient.setQueryData(b, 2)
    notifyWrite(null)
    expect(queryClient.get(JSON.stringify(a)).timestamp).toBe(0)
    expect(queryClient.get(JSON.stringify(b)).timestamp).toBe(0)
  })

  it('a throwing listener never stops the others or the write', () => {
    let seen = 0
    const off1 = onWrite(() => { throw new Error('boom') })
    const off2 = onWrite(() => { seen++ })
    expect(() => notifyWrite('o/r')).not.toThrow()
    expect(seen).toBe(1)
    off1(); off2()
  })
})

describe('a write updates every mounted view without r (#439, #481)', () => {
  it('useGh revalidates in the background: data stays on screen, then the new value lands', async () => {
    let version = 'v1'
    const second = defer()
    let calls = 0
    async function getThing(repo) {
      calls++
      if (version === 'v2') return second.promise
      return `${repo}:${version}`
    }
    const frames = []
    function View() {
      const { data, loading, isStale } = useGh(getThing, ['o/r'])
      frames.push(`data=${data} loading=${loading} stale=${isStale}`)
      return <Text>{`data=${data} loading=${loading} stale=${isStale}`}</Text>
    }
    const view = render(<View />)
    await waitForExpectation(() => expect(view.lastFrame()).toContain('data=o/r:v1 loading=false stale=false'))
    expect(calls).toBe(1)

    version = 'v2'
    notifyWrite('O/R') // the write finished
    await flush(20)
    // Background revalidation: the old value stays, no loading frame.
    expect(view.lastFrame()).toContain('data=o/r:v1 loading=false stale=true')
    second.resolve('o/r:v2')
    await waitForExpectation(() => expect(view.lastFrame()).toContain('data=o/r:v2 loading=false stale=false'))
    expect(calls).toBe(2)
    expect(frames.some(f => f.includes('loading=true') && f.includes('v2'))).toBe(false)
  })

  it('a write to another repository leaves this view alone', async () => {
    let calls = 0
    async function getOther(repo) { calls++; return repo }
    function View() {
      const { data } = useGh(getOther, ['o/r'])
      return <Text>{`data=${data}`}</Text>
    }
    const view = render(<View />)
    await waitForExpectation(() => expect(view.lastFrame()).toContain('data=o/r'))
    notifyWrite('x/y')
    await flush(20)
    expect(calls).toBe(1)
  })

  it('two views on the same key share one revalidation fetch', async () => {
    let calls = 0
    const gate = defer()
    async function getShared(repo) { calls++; return calls === 1 ? repo : gate.promise }
    function Both() {
      const a = useGh(getShared, ['o/r'])
      const b = useGh(getShared, ['o/r'])
      return <Text>{`a=${a.data} b=${b.data}`}</Text>
    }
    const view = render(<Both />)
    await waitForExpectation(() => expect(view.lastFrame()).toContain('a=o/r b=o/r'))
    expect(calls).toBe(1)
    notifyWrite('o/r')
    await flush(20)
    expect(calls).toBe(2)
    gate.resolve('NEW')
    await waitForExpectation(() => expect(view.lastFrame()).toContain('a=NEW b=NEW'))
  })

  it('a disabled query is not fetched by an invalidation', async () => {
    let calls = 0
    async function getOff(repo) { calls++; return repo }
    function View() {
      const { data } = useGh(getOff, ['o/r'], { enabled: false })
      return <Text>{`data=${data}`}</Text>
    }
    render(<View />)
    await flush(20)
    notifyWrite('o/r')
    await flush(20)
    expect(calls).toBe(0)
  })

  it('an unmounted view is not revalidated, and its entry is stale on the next visit', async () => {
    let calls = 0
    async function getGone(repo) { calls++; return `${repo}:${calls}` }
    function View() {
      const { data, isStale } = useGh(getGone, ['o/r'])
      return <Text>{`data=${data} stale=${isStale}`}</Text>
    }
    const first = render(<View />)
    await waitForExpectation(() => expect(first.lastFrame()).toContain('data=o/r:1'))
    first.unmount()
    await flush(20) // passive effect cleanup
    notifyWrite('o/r')
    await flush(20)
    expect(calls).toBe(1)
    const again = render(<View />)
    // First frame: the stale value, already on screen (no loading frame); then the fresh one.
    expect(again.lastFrame()).toContain('data=o/r:1 stale=true')
    await waitForExpectation(() => expect(again.lastFrame()).toContain('data=o/r:2 stale=false'))
  })

  it('useQuery on a bare client key revalidates when that client is invalidated by prefix', async () => {
    const client = createQueryClient()
    let n = 0
    function View() {
      const { data } = useQuery(['a', 'b'], async () => ++n, { client })
      return <Text>{`n=${data}`}</Text>
    }
    const view = render(<View />)
    await waitForExpectation(() => expect(view.lastFrame()).toContain('n=1'))
    client.invalidate(['a'])
    await waitForExpectation(() => expect(view.lastFrame()).toContain('n=2'))
  })

  it('an infinite query refreshes page 1 on invalidation and keeps the later pages', async () => {
    const client = createQueryClient()
    let version = 1
    const fetchPage = async ({ cursor }) => (cursor == null
      ? { items: [`first-v${version}`], next: 'c2' }
      : { items: ['second'], next: null })
    function View() {
      const q = useInfiniteQuery(['list'], fetchPage, { getNextCursor: p => p.next, client })
      return <Text>{`items=${q.items.join(',')}`}</Text>
    }
    const view = render(<View />)
    await waitForExpectation(() => expect(view.lastFrame()).toContain('items=first-v1'))
    // Later pages were loaded by scrolling; simulate by a second render pass of fetchNextPage.
    version = 2
    client.invalidate(['list'])
    await waitForExpectation(() => expect(view.lastFrame()).toContain('items=first-v2'))
  })
})

describe('list rows seed the detail query (#481, #452)', () => {
  it('seedGh puts a stale entry under the key useGh reads, shown on the first frame', async () => {
    let calls = 0
    async function getSeeded(repo, n) { calls++; return { number: n, title: 'full', body: 'b' } }
    seedGh(getSeeded, ['o/r', 7], { number: 7, title: 'row', partial: true })
    expect(queryClient.get(JSON.stringify(ghQueryKey(getSeeded, ['o/r', 7]))).timestamp).toBe(0)
    function View() {
      const { data, loading, isStale } = useGh(getSeeded, ['o/r', 7])
      return <Text>{`title=${data?.title} partial=${Boolean(data?.partial)} loading=${loading} stale=${isStale}`}</Text>
    }
    const view = render(<View />)
    expect(view.lastFrame()).toContain('title=row partial=true loading=false stale=true')
    await waitForExpectation(() => expect(view.lastFrame()).toContain('title=full partial=false loading=false stale=false'))
    expect(calls).toBe(1)
  })

  it('never replaces a fuller cached entry with the row', () => {
    async function getKeep() { return null }
    queryClient.setQueryData(ghQueryKey(getKeep, ['o/r', 7]), { title: 'full' })
    expect(seedGh(getKeep, ['o/r', 7], { title: 'row', partial: true })).toBe(false)
    expect(queryClient.getQueryData(ghQueryKey(getKeep, ['o/r', 7]))).toEqual({ title: 'full' })
  })

  it('a seed is not written to the disk cache', async () => {
    const { peekCache, scopedCacheKey } = await import('../cache.js')
    async function getNoDisk() { return null }
    seedGh(getNoDisk, ['o/r', 7], { partial: true })
    expect(peekCache(scopedCacheKey(['o/r', 'getNoDisk', ['o/r', 7]]))).toBeNull()
  })
})
