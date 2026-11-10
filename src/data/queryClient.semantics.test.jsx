// V1 query semantics (#597): derived render mode, structural sharing, batched notifications,
// freshness classes and GC. Each behaviour here fails on the pre-V1 client.
import React from 'react'
import { Text } from 'ink'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { render, cleanup } from 'ink-testing-library'
import { createQueryClient, keyString, useQuery, useInfiniteQuery, replaceEqualDeep } from './queryClient.js'
import { FRESHNESS, freshnessForOp } from './freshness.js'
import { deriveRenderMode } from './renderMode.js'
import { QueryBoundary } from '../components/QueryBoundary.jsx'
import { flush } from '../test/test-helpers.jsx'

const sleep = ms => new Promise(r => setTimeout(r, ms))
function defer() {
  let resolve, reject
  const promise = new Promise((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}
const rows = n => Array.from({ length: n }, (_, i) => ({ id: i + 1, title: `row ${i + 1}`, labels: [{ name: 'a' }] }))

describe('replaceEqualDeep', () => {
  it('returns prev for deep-equal input and keeps unchanged subtrees', () => {
    const prev = { a: [1, 2, { b: 3 }], c: { d: 4 } }
    expect(replaceEqualDeep(prev, JSON.parse(JSON.stringify(prev)))).toBe(prev)
    const next = replaceEqualDeep(prev, { a: [1, 2, { b: 3 }], c: { d: 5 } })
    expect(next).not.toBe(prev)
    expect(next.a).toBe(prev.a)
    expect(next.c).not.toBe(prev.c)
  })

  it('matches array rows by stable id, so a moved row keeps its identity', () => {
    const prev = rows(3)
    const next = replaceEqualDeep(prev, [rows(3)[2], rows(3)[0], rows(3)[1]])
    expect(next[0]).toBe(prev[2])
    expect(next[1]).toBe(prev[0])
    expect(next[2]).toBe(prev[1])
    expect(next).not.toBe(prev) // order changed: a new array of the same rows
  })

  it('falls back to position when ids repeat, and never merges unlike types', () => {
    const prev = [{ id: 1, v: 1 }, { id: 1, v: 2 }]
    const same = replaceEqualDeep(prev, [{ id: 1, v: 1 }, { id: 1, v: 2 }])
    expect(same).toBe(prev)
    expect(replaceEqualDeep({ a: 1 }, [1])).toEqual([1])
    const d = new Date(0)
    expect(replaceEqualDeep({ d }, { d: new Date(0) }).d).not.toBe(d)
  })
})

describe('deriveRenderMode', () => {
  it('skeleton only without data, only after the delay; data wins over everything', () => {
    expect(deriveRenderMode({ data: null, isLoading: true, skeletonDue: false })).toBe('pending')
    expect(deriveRenderMode({ data: null, isLoading: true, skeletonDue: true })).toBe('skeleton')
    expect(deriveRenderMode({ data: [1], isLoading: true, error: new Error('x') })).toBe('data')
    expect(deriveRenderMode({ data: [], isLoading: false })).toBe('empty')
    expect(deriveRenderMode({ data: null, isLoading: false, error: new Error('x') })).toBe('error')
  })
})

describe('useQuery lazy updates', () => {
  let client
  beforeEach(() => { client = createQueryClient() })
  afterEach(() => cleanup())

  /** A legacy-style view: draws a skeleton on `loading`, the way unmigrated panes do. */
  function mountList(fetcher, opts = {}) {
    const seen = { renders: 0, rowRenders: new Map(), api: null, rowsSeen: [] }
    const Row = React.memo(function Row({ item }) {
      seen.rowRenders.set(item.id, (seen.rowRenders.get(item.id) || 0) + 1)
      return <Text>{item.title}</Text>
    })
    function View() {
      const api = useQuery(['list'], fetcher, { client, ...opts })
      seen.api = api
      seen.renders++
      if (api.data) seen.rowsSeen = api.data
      return api.loading && !api.data ? <Text>SKELETON</Text> : <>{(api.data || []).map(r => <Row key={r.id} item={r} />)}</>
    }
    const view = render(<View />)
    return { view, seen }
  }

  it('an identical revalidate keeps row identity and writes no frame, even on a manual refetch', async () => {
    let n = 0
    const { view, seen } = mountList(async () => { n++; return rows(5) })
    await flush(20)
    const first = seen.rowsSeen
    const framesBefore = view.frames.length
    const rowRendersBefore = [...seen.rowRenders.values()].reduce((a, b) => a + b, 0)
    seen.api.refetch()
    await flush(40)
    expect(n).toBe(2)
    expect(seen.rowsSeen).toBe(first) // same array, same row objects
    expect(seen.rowsSeen[0]).toBe(first[0])
    expect(view.frames.length).toBe(framesBefore) // no SKELETON frame, no repaint
    expect([...seen.rowRenders.values()].reduce((a, b) => a + b, 0)).toBe(rowRendersBefore)
  })

  it('one changed row changes only that row identity', async () => {
    let n = 0
    const { seen } = mountList(async () => { n++; const r = rows(4); if (n > 1) r[2] = { ...r[2], title: 'edited' }; return r })
    await flush(20)
    const before = seen.rowsSeen
    seen.api.refetch()
    await flush(40)
    const after = seen.rowsSeen
    expect(after).not.toBe(before)
    expect(after[0]).toBe(before[0])
    expect(after[1]).toBe(before[1])
    expect(after[2]).not.toBe(before[2])
    expect(after[3]).toBe(before[3])
    expect(seen.rowRenders.get(1)).toBe(1) // memoised rows did not re-render
    expect(seen.rowRenders.get(3)).toBe(2)
  })

  it('seeded data with a fetch in flight is mode data, never skeleton', async () => {
    client.set(keyString(['list']), rows(2), Date.now() - 60_000) // stale seed
    const gate = defer()
    const modes = []
    function View() {
      const api = useQuery(['list'], () => gate.promise, { client })
      modes.push(`${api.mode}:${api.isLoading}:${api.isFetching}`)
      return <Text>{api.mode}</Text>
    }
    render(<View />)
    await sleep(250) // past the skeleton delay
    expect(modes.every(m => m.startsWith('data:false:'))).toBe(true)
    expect(modes.some(m => m.endsWith(':true'))).toBe(true) // fetching is reported separately
    gate.resolve(rows(2))
    await flush(20)
  })

  it('an uncached fetch resolving in 100 ms never shows the skeleton; at 300 ms it does', async () => {
    const quick = []
    function Quick() {
      const api = useQuery(['quick'], async () => { await sleep(100); return rows(1) }, { client })
      const body = (
        <QueryBoundary query={api} skeleton={<Text>SKELETON</Text>}>
          {data => <Text>{data[0].title}</Text>}
        </QueryBoundary>
      )
      quick.push(api.mode)
      return body
    }
    const a = render(<Quick />)
    await sleep(250)
    expect(a.frames.some(f => f.includes('SKELETON'))).toBe(false)
    expect(a.lastFrame()).toContain('row 1')
    expect(quick).toContain('pending')

    function Slow() {
      const api = useQuery(['slow'], async () => { await sleep(300); return rows(1) }, { client })
      return (
        <QueryBoundary query={api} skeleton={<Text>SKELETON</Text>}>
          {data => <Text>{data[0].title}</Text>}
        </QueryBoundary>
      )
    }
    const b = render(<Slow />)
    await sleep(220)
    expect(b.lastFrame()).toContain('SKELETON')
    await sleep(200)
    expect(b.lastFrame()).toContain('row 1')
  })

  it('re-mount inside the freshness window makes no call; after it, one call and no skeleton', async () => {
    let calls = 0
    function View() {
      const api = useQuery(['fresh'], async () => { calls++; return rows(2) }, { client, staleTime: 250 })
      return <QueryBoundary query={api} skeleton={<Text>SKELETON</Text>}>{d => <Text>{d.length} rows</Text>}</QueryBoundary>
    }
    const first = render(<View />)
    await flush(30)
    first.unmount()
    const again = render(<View />)
    await flush(30)
    expect(calls).toBe(1)
    expect(again.lastFrame()).toContain('2 rows')
    again.unmount()
    await sleep(260)
    const late = render(<View />)
    expect(late.lastFrame()).toContain('2 rows') // cached data on the first frame
    await flush(40)
    expect(calls).toBe(2)
    expect(late.frames.some(f => f.includes('SKELETON'))).toBe(false)
  })

  it('three cache updates in one tick produce one render', async () => {
    client.set(keyString(['batch']), 0)
    let renders = 0
    function View() {
      const { data } = useQuery(['batch'], async () => 0, { client })
      renders++
      return <Text>{`v=${data}`}</Text>
    }
    const view = render(<View />)
    await flush(30)
    const before = renders
    client.setQueryData(['batch'], 1)
    client.setQueryData(['batch'], 2)
    client.updateQueryData(['batch'], prev => prev + 1)
    await flush(10)
    expect(renders - before).toBe(1)
    expect(view.lastFrame()).toContain('v=3')
  })

  it('a fetch result lands as one render (no intermediate data/stale/loading commits)', async () => {
    const gate = defer()
    let renders = 0
    function View() {
      const { data } = useQuery(['one'], () => gate.promise, { client })
      renders++
      return <Text>{`v=${data}`}</Text>
    }
    render(<View />)
    await flush(20)
    const before = renders
    gate.resolve('X')
    await flush(20)
    expect(renders - before).toBe(1)
  })

  it('several invalidations in one tick revalidate once', async () => {
    let calls = 0
    function View() {
      const { data } = useQuery(['inv'], async () => ++calls, { client })
      return <Text>{`v=${data}`}</Text>
    }
    render(<View />)
    await flush(30)
    client.invalidate(['inv'])
    client.invalidate(['inv'])
    client.invalidate([])
    await flush(30)
    expect(calls).toBe(2)
  })

  it('an optimistic patch reaches a mounted query without a fetch', async () => {
    let calls = 0
    function View() {
      const { data } = useQuery(['opt'], async () => { calls++; return rows(2) }, { client })
      return <Text>{(data || []).map(r => r.title).join(',')}</Text>
    }
    const view = render(<View />)
    await flush(30)
    client.updateQueryData(['opt'], prev => prev.map(r => (r.id === 1 ? { ...r, title: 'patched' } : r)))
    await flush(20)
    expect(view.lastFrame()).toContain('patched,row 2')
    expect(calls).toBe(1)
  })

  it('an error during revalidate keeps the rows and sets the error', async () => {
    client.set(keyString(['e']), rows(2), Date.now() - 60_000)
    let api
    function View() {
      api = useQuery(['e'], async () => { throw new Error('boom') }, { client })
      return <QueryBoundary query={api}>{d => <Text>{d.length} rows</Text>}</QueryBoundary>
    }
    const view = render(<View />)
    await flush(40)
    expect(api.error.message).toBe('boom')
    expect(api.mode).toBe('data')
    expect(view.lastFrame()).toContain('2 rows')
  })

  it('keepPreviousData keeps the last key rows (flagged) until the new key lands', async () => {
    const gate = defer()
    let api
    function View({ k }) {
      api = useQuery(['kp', k], k === 'a' ? async () => rows(1) : () => gate.promise, { client, keepPreviousData: true })
      return <Text>{`${api.data ? api.data.length : 'none'}:${api.isPlaceholderData}`}</Text>
    }
    const view = render(<View k="a" />)
    await flush(30)
    expect(view.lastFrame()).toContain('1:false')
    view.rerender(<View k="b" />)
    await flush(20)
    expect(view.lastFrame()).toContain('1:true')
    expect(api.mode).toBe('data')
    gate.resolve(rows(3))
    await flush(20)
    expect(view.lastFrame()).toContain('3:false')
  })

  it('without keepPreviousData a key change never shows the previous key rows (#548)', async () => {
    let api
    function View({ k }) {
      api = useQuery(['nk', k], k === 'a' ? async () => rows(1) : () => new Promise(() => {}), { client })
      return <Text>{`${api.data ? api.data.length : 'none'}`}</Text>
    }
    const view = render(<View k="a" />)
    await flush(30)
    view.rerender(<View k="b" />)
    await flush(20)
    expect(view.lastFrame()).toContain('none')
  })

  it('immutable freshness (Infinity) is not refetched on mount or by an invalidation', async () => {
    let calls = 0
    function View() {
      const { data } = useQuery(['imm'], async () => { calls++; return rows(1) }, { client, staleTime: FRESHNESS.immutable })
      return <Text>{data ? 'ok' : 'none'}</Text>
    }
    const a = render(<View />)
    await flush(30)
    client.invalidate(['imm'])
    await flush(30)
    a.unmount()
    render(<View />)
    await flush(30)
    expect(calls).toBe(1)
  })

  it('legacy loading is isLoading: true with no data, false while data revalidates', async () => {
    const gate = defer()
    const seen = []
    function View() {
      const { loading, isLoading, isFetching, data } = useQuery(['legacy'], () => gate.promise, { client })
      seen.push({ loading, isLoading, isFetching, has: data != null })
      return <Text>x</Text>
    }
    render(<View />)
    await flush(10)
    expect(seen[seen.length - 1]).toEqual({ loading: true, isLoading: true, isFetching: true, has: false })
    gate.resolve(rows(1))
    await flush(20)
    expect(seen[seen.length - 1]).toEqual({ loading: false, isLoading: false, isFetching: false, has: true })
  })
})

describe('useInfiniteQuery lazy updates', () => {
  let client
  beforeEach(() => { client = createQueryClient() })
  afterEach(() => cleanup())

  it('an identical page-1 revalidate keeps the same items array and rows', async () => {
    let api
    let renders = 0
    function View() {
      api = useInfiniteQuery(['pages'], async () => ({ items: rows(3), next: null }), {
        client, getNextCursor: p => p.next, getItems: p => p.items,
      })
      renders++
      return <Text>{api.mode}:{api.items.length}</Text>
    }
    render(<View />)
    await flush(30)
    const items = api.items
    expect(api.mode).toBe('data')
    const before = renders
    api.refetch()
    await flush(40)
    expect(api.items).toBe(items)
    expect(api.isFetching).toBe(false)
    expect(renders - before).toBeLessThanOrEqual(2) // fetching on, fetching off; items untouched
  })
})

describe('freshness classes and GC', () => {
  it('maps conversation and notification reads to 15 s, others to 30 s, immutable to Infinity', () => {
    expect(freshnessForOp('listPRTimelinePage')).toBe(15_000)
    expect(freshnessForOp('listNotifications')).toBe(15_000)
    expect(freshnessForOp('listPRsPage')).toBe(30_000)
    expect(freshnessForOp('getPR')).toBe(30_000)
    expect(FRESHNESS.immutable).toBe(Infinity)
  })

  it('keeps unused entries for gcMs, drops them after, and never drops a watched one', () => {
    const client = createQueryClient({ gcMs: 1000 })
    const t0 = Date.now()
    client.set('unused', 'a')
    client.set('watched', 'b')
    const unwatch = client.watch('watched', () => {})
    expect(client.gc(t0 + 500)).toBe(0)
    expect(client.gc(t0 + 5000)).toBe(1)
    expect(client.get('unused')).toBeUndefined()
    expect(client.get('watched')).toBeDefined()
    unwatch()
    expect(client.gc(Date.now() + 5000)).toBe(1)
  })

  it('the default keeps unused entries for at least 5 minutes', () => {
    const client = createQueryClient()
    client.set('k', 'v')
    expect(client.gc(Date.now() + 4 * 60_000)).toBe(0)
    expect(client.get('k')).toBeDefined()
  })
})
