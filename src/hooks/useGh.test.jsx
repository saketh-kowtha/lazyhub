import React from 'react'
import { Text } from 'ink'
import { describe, expect, it } from 'vitest'
import { render, cleanup } from 'ink-testing-library'
import { useGh } from './useGh.js'
import { flush } from '../test/test-helpers.jsx'

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
