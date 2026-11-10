import React from 'react'
import { afterEach, expect, it } from 'vitest'
import { Text } from 'ink'
import { cleanup, flush, renderWithProviders } from '../test/test-helpers.jsx'
import { useKeymapInput } from '../config/keymap.js'
import { useListController } from './useListController.js'

afterEach(cleanup)

// Rebuilds equal rows on every render, the way a mocked or re-seeded query does.
function Probe() {
  const items = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]
  const list = useListController({ items, height: 5, getId: i => i.id })
  useKeymapInput((input, key) => { list.handleKey(input, key) })
  return <Text>{`cursor=${list.cursor} sel=${list.selected?.id}`}</Text>
}

it('keeps the cursor where the user put it when rows are rebuilt equal on each render', async () => {
  const view = renderWithProviders(<Probe />)
  await flush(20)
  view.stdin.write('j')
  await flush(20)
  expect(view.lastFrame()).toContain('cursor=1 sel=b')
  view.stdin.write('G')
  await flush(20)
  expect(view.lastFrame()).toContain('cursor=2 sel=c')
})

it('hands out callbacks and a window array whose identity survives cursor moves (#597)', async () => {
  const seen = { handleKey: new Set(), moveTo: new Set(), jumpTop: new Set(), jumpBottom: new Set(), window: new Set() }
  const items = Array.from({ length: 50 }, (_, i) => ({ id: `r${i}` }))
  function Stable() {
    const list = useListController({ items, height: 10, getId: i => i.id })
    for (const k of ['handleKey', 'moveTo', 'jumpTop', 'jumpBottom']) seen[k].add(list[k])
    seen.window.add(list.visibleItems)
    useKeymapInput((input, key) => { list.handleKey(input, key) })
    return <Text>{`cursor=${list.cursor}`}</Text>
  }
  const view = renderWithProviders(<Stable />)
  await flush(20)
  for (const k of ['j', 'j', 'k', 'j']) { view.stdin.write(k); await flush(20) }
  expect(view.lastFrame()).toContain('cursor=2')
  for (const k of ['handleKey', 'moveTo', 'jumpTop', 'jumpBottom', 'window']) expect(seen[k].size, k).toBe(1)
})
