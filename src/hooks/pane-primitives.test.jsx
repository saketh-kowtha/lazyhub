/**
 * Tests for the shared pane primitives (R8, #486): useListController, QueryBoundary,
 * useMutation, ListRow.
 */

import React from 'react'
import { Text } from 'ink'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useListController } from './useListController.js'
import { useMutation } from './useMutation.js'
import { QueryBoundary } from '../components/QueryBoundary.jsx'
import { MutationStatus } from '../components/MutationStatus.jsx'
import { ListRow, SELECTION_GLYPH } from '../ui/ListRow.jsx'
import { useKeymapInput } from '../config/keymap.js'
import { sendInput } from '../test/input-bus.js'
import { cleanup, flush, renderWithProviders, waitForExpectation } from '../test/test-helpers.jsx'

vi.mock('ink', async () => {
  const React = await import('react')
  return { ...await vi.importActual('ink'), useInput: (await import('../test/input-bus.js')).mockUseInput(React) }
})

afterEach(() => { cleanup(); vi.restoreAllMocks() })

const mk = n => Array.from({ length: n }, (_, i) => ({ id: `n${i}`, title: `Row ${i}` }))

function ListHarness({ source, height = 3 }) {
  const [items, setItems] = React.useState(source)
  const list = useListController({ items, height, getId: it => it.id })
  useKeymapInput((input, key) => {
    if (list.handleKey(input, key)) return
    if (input === 'x') setItems(prev => prev.slice(1))
    if (input === 'z') setItems(prev => [...prev].reverse())
    if (input === 'e') setItems([])
  })
  return <Text>{`cursor=${list.cursor} sel=${list.selected?.id ?? 'none'} off=${list.scrollOffset} rows=${list.visibleItems.map(i => i.id).join(',')}`}</Text>
}

describe('useListController', () => {
  it('moves, jumps with gg and G, and scrolls the window', async () => {
    const view = renderWithProviders(<ListHarness source={mk(10)} />)
    await flush(20)
    await sendInput('j'); await sendInput('j'); await sendInput('j')
    await waitForExpectation(() => expect(view.lastFrame()).toContain('cursor=3 sel=n3 off=1'))
    await sendInput('G')
    await waitForExpectation(() => expect(view.lastFrame()).toContain('cursor=9 sel=n9 off=7'))
    await sendInput('g'); await sendInput('g')
    await waitForExpectation(() => expect(view.lastFrame()).toContain('cursor=0 sel=n0 off=0'))
  })

  it('does not jump on a single g', async () => {
    const view = renderWithProviders(<ListHarness source={mk(10)} />)
    await flush(20)
    await sendInput('G')
    await sendInput('g')
    await flush(30)
    expect(view.lastFrame()).toContain('cursor=9')
  })

  it('G and navigation on an empty list are safe', async () => {
    const view = renderWithProviders(<ListHarness source={[]} />)
    await flush(20)
    await sendInput('G'); await sendInput('j'); await sendInput('k')
    expect(view.lastFrame()).toContain('cursor=0 sel=none')
  })

  it('clamps onto a real row when the list shrinks under the cursor', async () => {
    const view = renderWithProviders(<ListHarness source={mk(3)} />)
    await flush(20)
    await sendInput('G')
    await sendInput('e')
    await waitForExpectation(() => expect(view.lastFrame()).toContain('cursor=0 sel=none'))
  })

  it('keeps the selection on the same entity when rows are reordered (selection memory)', async () => {
    const view = renderWithProviders(<ListHarness source={mk(3)} height={5} />)
    await flush(20)
    await sendInput('j') // n1
    await waitForExpectation(() => expect(view.lastFrame()).toContain('sel=n1'))
    await sendInput('x') // drop n0: n1 is now index 0
    await waitForExpectation(() => expect(view.lastFrame()).toContain('cursor=0 sel=n1'))
    await sendInput('z') // reverse: [n2, n1]
    await waitForExpectation(() => expect(view.lastFrame()).toContain('cursor=1 sel=n1'))
  })
})

describe('QueryBoundary', () => {
  const rows = data => data.map(d => <Text key={d}>{`row ${d}`}</Text>)

  it('renders the failure cause and retry key, never "empty", when the query failed', () => {
    const err = Object.assign(new Error('x'), { stderr: 'HTTP 401: Bad credentials' })
    const view = renderWithProviders(
      <QueryBoundary query={{ data: null, loading: false, error: err }} empty="Nothing here.">{rows}</QueryBoundary>)
    expect(view.lastFrame()).toMatch(/retry/i)
    expect(view.lastFrame()).not.toContain('Nothing here.')
  })

  it('shows the skeleton only while there is nothing to show', () => {
    const view = renderWithProviders(
      <QueryBoundary query={{ data: null, loading: true, error: null }} skeleton={<Text>SKELETON</Text>}>{rows}</QueryBoundary>)
    expect(view.lastFrame()).toContain('SKELETON')
    const stale = renderWithProviders(
      <QueryBoundary query={{ data: ['a'], loading: true, error: null }} skeleton={<Text>SKELETON</Text>}>{rows}</QueryBoundary>)
    expect(stale.lastFrame()).toContain('row a')
    expect(stale.lastFrame()).not.toContain('SKELETON')
  })

  it('keeps stale rows visible under a failure notice and hides the footer', () => {
    const err = Object.assign(new Error('x'), { stderr: 'HTTP 502' })
    const view = renderWithProviders(
      <QueryBoundary query={{ data: ['a'], loading: false, error: err }} footer={<Text>FOOTER</Text>}>{rows}</QueryBoundary>)
    expect(view.lastFrame()).toContain('row a')
    expect(view.lastFrame()).toMatch(/retry/i)
    expect(view.lastFrame()).not.toContain('FOOTER')
  })

  it('renders the empty state with a refresh hint only when loaded, healthy and empty', () => {
    const view = renderWithProviders(
      <QueryBoundary query={{ data: [], loading: false, error: null }} empty="No things.">{rows}</QueryBoundary>)
    expect(view.lastFrame()).toMatch(/No things\. \[r\] refresh/)
  })
})

function MutationHarness({ fn, invalidates, label = 'Doing it' }) {
  const m = useMutation(fn, { label, success: 'Did it', invalidates })
  useKeymapInput((input) => {
    if (m.status?.persist) m.dismiss()
    if (input === 'w') m.mutate('arg')
  })
  return (<><Text>{`pending=${m.pending ?? 'no'}`}</Text><MutationStatus status={m.status} /></>)
}

describe('useMutation', () => {
  it('shows pending, ignores a second submit, then succeeds and runs invalidates', async () => {
    let release
    const fn = vi.fn(() => new Promise(r => { release = r }))
    const refetch = vi.fn()
    const view = renderWithProviders(<MutationHarness fn={fn} invalidates={[refetch]} />)
    await flush(20)
    await sendInput('w')
    await waitForExpectation(() => expect(view.lastFrame()).toContain('Doing it'))
    expect(view.lastFrame()).toContain('pending=Doing it')
    await sendInput('w')
    await waitForExpectation(() => expect(view.lastFrame()).toContain('still in progress'))
    expect(fn).toHaveBeenCalledTimes(1)
    expect(fn).toHaveBeenCalledWith('arg')
    expect(refetch).not.toHaveBeenCalled()
    release('ok')
    await waitForExpectation(() => expect(view.lastFrame()).toContain('Did it'))
    expect(refetch).toHaveBeenCalledWith('ok', ['arg'])
    expect(view.lastFrame()).toContain('pending=no')
  })

  it('shows a sticky failure, skips invalidates, and any key dismisses it', async () => {
    const fn = vi.fn(() => Promise.reject(new Error('boom')))
    const refetch = vi.fn()
    const view = renderWithProviders(<MutationHarness fn={fn} invalidates={[refetch]} />)
    await flush(20)
    await sendInput('w')
    await waitForExpectation(() => expect(view.lastFrame()).toContain('Failed: boom [any key]'))
    expect(refetch).not.toHaveBeenCalled()
    await flush(20)
    await sendInput('q')
    await waitForExpectation(() => expect(view.lastFrame()).not.toContain('Failed: boom'))
  })

  it('hands key entries to queryClient.invalidate when the client has one (R3 seam)', async () => {
    const { queryClient } = await import('../data/queryClient.js')
    const invalidate = vi.fn()
    queryClient.invalidate = invalidate
    try {
      const view = renderWithProviders(<MutationHarness fn={() => Promise.resolve(1)} invalidates={[['listNotifications']]} />)
      await flush(20)
      await sendInput('w')
      await waitForExpectation(() => expect(view.lastFrame()).toContain('Did it'))
      expect(invalidate).toHaveBeenCalledWith(['listNotifications'])
    } finally {
      delete queryClient.invalidate
    }
  })
})

describe('ListRow', () => {
  it('marks the selected row with a gutter glyph, not only a colour', () => {
    const prev = process.env.NO_COLOR
    process.env.NO_COLOR = '1'
    try {
      const view = renderWithProviders(<><ListRow selected><Text>a</Text></ListRow><ListRow selected={false}><Text>b</Text></ListRow></>)
      const [first, second] = view.lastFrame().split('\n')
      expect(first).toContain(SELECTION_GLYPH)
      expect(second).not.toContain(SELECTION_GLYPH)
    } finally {
      if (prev === undefined) delete process.env.NO_COLOR; else process.env.NO_COLOR = prev
    }
  })
})
