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
