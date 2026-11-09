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
