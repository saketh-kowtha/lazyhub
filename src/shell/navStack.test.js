import { describe, it, expect } from 'vitest'
import { MAX_MOUNTED, navigate } from './navStack.js'
import { createViewStateStore } from './viewState.js'

const layer = (id, base = false) => ({ id, base, element: id, meta: { pane: 'prs' } })
const ids = (stack) => stack.map(l => l.id)

describe('navigate', () => {
  it('goes forward by keeping the layer it leaves covered', () => {
    const a = navigate([], layer('list:prs', true), layer('detail:1'))
    expect(ids(a.covered)).toEqual(['list:prs'])
    const b = navigate(a.covered, layer('detail:1'), layer('diff:1'))
    expect(ids(b.covered)).toEqual(['list:prs', 'detail:1'])
    expect(b.evicted).toEqual([])
  })

  it('goes back to a covered layer and drops it with everything deeper', () => {
    const r = navigate([layer('list:prs', true), layer('detail:1')], layer('diff:1'), { id: 'detail:1', base: false })
    expect(ids(r.covered)).toEqual(['list:prs'])
  })

  it('evicts the oldest covered layer past the cap, so at most MAX_MOUNTED stay mounted', () => {
    expect(MAX_MOUNTED).toBe(3)
    const r = navigate([layer('list:prs', true), layer('detail:1')], layer('diff:1'), layer('comments:1'))
    expect(ids(r.covered)).toEqual(['detail:1', 'diff:1'])
    expect(ids(r.evicted)).toEqual(['list:prs'])
  })

  it('a list pane that is not covered starts a new root', () => {
    const r = navigate([layer('list:prs', true)], layer('detail:1'), { id: 'list:actions::', base: true })
    expect(r.covered).toEqual([])
  })

  it('does nothing when the active layer is unchanged', () => {
    const covered = [layer('list:prs', true)]
    expect(navigate(covered, layer('detail:1'), { id: 'detail:1', base: false }).covered).toBe(covered)
  })
})

describe('view-state store', () => {
  it('hands a snapshot back once and keeps a bounded number', () => {
    const store = createViewStateStore()
    store.save('a', { pane: 'prs', view: 'list', itemNumber: 4, paneState: { cursor: 3 } })
    expect(store.has('a')).toBe(true)
    expect(store.take('a')?.paneState).toEqual({ cursor: 3 })
    expect(store.take('a')).toBeUndefined()
    for (let i = 0; i < 40; i++) store.save(`k${i}`, { pane: 'prs', view: 'list', itemNumber: i, paneState: null })
    expect(store.size).toBe(20)
    expect(store.has('k0')).toBe(false)
    expect(store.has('k39')).toBe(true)
  })
})
