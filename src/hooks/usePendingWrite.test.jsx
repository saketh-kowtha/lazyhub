import React from 'react'
import { describe, expect, it, vi, afterEach } from 'vitest'
import { Text } from 'ink'
import { renderWithProviders, waitForExpectation, cleanup } from '../test/test-helpers.jsx'
import { usePendingWrite } from './usePendingWrite.js'

afterEach(cleanup)

function Probe({ api, announce }) {
  const w = usePendingWrite(announce)
  api.current = w
  return <Text>{w.pending ?? 'idle'}</Text>
}

describe('usePendingWrite', () => {
  it('announces, shows pending, and ignores a second run until the first settles', async () => {
    const api = {}
    const announce = vi.fn()
    const view = renderWithProviders(<Probe api={api} announce={announce} />)
    let release
    const first = vi.fn(() => new Promise(r => { release = r }))
    const second = vi.fn(async () => 'x')
    const p1 = api.current.run('Merging #1', first)
    const p2 = api.current.run('Merging #1', second)
    await waitForExpectation(() => expect(view.lastFrame()).toContain('Merging #1'))
    expect(announce).toHaveBeenCalledWith('⟳ Merging #1…')
    expect(await p2).toBeUndefined()
    expect(second).not.toHaveBeenCalled()
    release('done')
    expect(await p1).toBe('done')
    await waitForExpectation(() => expect(view.lastFrame()).toContain('idle'))
    await api.current.run('Again', second)
    expect(second).toHaveBeenCalledOnce()
  })

  it('says which write is still running when it ignores a run', async () => {
    const api = {}
    const announce = vi.fn()
    renderWithProviders(<Probe api={api} announce={announce} />)
    let release
    const p1 = api.current.run('Merging #1', () => new Promise(r => { release = r }))
    expect(await api.current.run('Approving #2', async () => 'x')).toBeUndefined()
    expect(announce).toHaveBeenLastCalledWith('⟳ Merging #1 still in progress')
    release()
    await p1
  })

  it('releases the guard and rethrows when the write fails', async () => {
    const api = {}
    renderWithProviders(<Probe api={api} />)
    await expect(api.current.run('Closing', async () => { throw new Error('boom') })).rejects.toThrow('boom')
    const ok = vi.fn(async () => 1)
    await api.current.run('Closing', ok)
    expect(ok).toHaveBeenCalledOnce()
  })
})
