import React, { useEffect, useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup } from 'ink-testing-library'
import { renderWithProviders, waitForInputReady, waitForExpectation } from '../../test/test-helpers.jsx'
import { MultiSelect } from './MultiSelect.jsx'

afterEach(cleanup)

const FRESH = [{ id: 'bug', name: 'bug', selected: true }, { id: 'infra', name: 'infra', selected: false }]

function StaleThenFresh({ onSubmit }) {
  const [items, setItems] = useState([{ id: 'bug', name: 'bug', selected: false }])
  useEffect(() => { const id = setTimeout(() => setItems(FRESH), 30); return () => clearTimeout(id) }, [])
  return <MultiSelect items={items} onSubmit={onSubmit} onCancel={() => {}} />
}

describe('MultiSelect', () => {
  it('re-syncs preselected items when the item list changes after mount (stale list then fresh list)', async () => {
    const onSubmit = vi.fn()
    const view = renderWithProviders(<StaleThenFresh onSubmit={onSubmit} />)
    await waitForExpectation(() => expect(view.lastFrame()).toMatch(/◉ bug/))
    await waitForInputReady(view)
    view.stdin.write('\r')
    await waitForExpectation(() => expect(onSubmit).toHaveBeenCalledWith(['bug']))
  })
})
