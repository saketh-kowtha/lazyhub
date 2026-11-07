/**
 * #279: a Focus section keeps its selected row across a detail round trip, also in the
 * one-section-at-a-time mode where the other sections are not mounted while you look away.
 */
import React, { act } from 'react'
import { Text } from 'ink'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { sendInput } from '../../test/input-bus.js'
import { cleanup, flush, renderWithProviders, waitForExpectation } from '../../test/test-helpers.jsx'

vi.mock('ink', async () => {
  const React = await import('react')
  const actual = await vi.importActual('ink')
  return { ...actual, useInput: (await import('../../test/input-bus.js')).mockUseInput(React) }
})

const rowsOf = (first, n = 30) => Array.from({ length: n }, (_, i) => ({ number: first + i, title: `Row ${first + i}`, updatedAt: '2026-06-13T00:00:00Z', url: 'https://example.invalid' }))

vi.mock('../../executor.js', async () => {
  const actual = await vi.importActual('../../executor.js')
  return { ...actual, listPRs: async () => rowsOf(300), listIssues: async () => rowsOf(400) }
})
vi.mock('../../cache.js', async () => {
  const actual = await vi.importActual('../../cache.js')
  return { ...actual, readCache: () => null, writeCache: () => {} }
})

const { TabView, resetTabSelection } = await import('./view.jsx')
const { resetGhMemoryCache } = await import('../../hooks/useGh.js')

const stripAnsi = s => s.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '') // eslint-disable-line no-control-regex
const tab = {
  id: 'focus',
  label: 'Focus',
  panes: [
    { kind: 'prs', title: 'Review requested', filter: {} },
    { kind: 'prs', title: 'My open PRs', filter: {} },
    { kind: 'issues', title: 'Assigned issues', filter: {} },
  ],
}
// Stands in for the app: opening a detail view replaces the dashboard, Esc brings a fresh one back.
const room = { show: null }
function Room() {
  const [detail, setDetail] = React.useState(false)
  room.show = setDetail
  return detail ? <Text>DETAIL</Text> : <TabView tab={tab} repo="o/r" innerWidth={58} listHeight={8} onOpenItem={() => {}} />
}
const toggle = async (detail) => { globalThis.IS_REACT_ACT_ENVIRONMENT = true; await act(async () => { room.show(detail) }); globalThis.IS_REACT_ACT_ENVIRONMENT = false }
const frameOf = view => stripAnsi(view.lastFrame() ?? '')

describe('Focus selection survives a detail round trip (#279)', () => {
  beforeEach(() => { resetGhMemoryCache(); resetTabSelection() })
  afterEach(cleanup)

  it('one-section mode: the first section still has its last row selected after visiting section 3', async () => {
    const view = renderWithProviders(<Room />)
    await waitForExpectation(() => expect(frameOf(view)).toMatch(/section 1\/3/))
    await waitForExpectation(() => expect(frameOf(view)).toMatch(/▸\s+#300/))
    await sendInput('G')
    await waitForExpectation(() => expect(frameOf(view)).toMatch(/▸\s+#329/))
    await sendInput(']')
    await sendInput(']')
    await waitForExpectation(() => expect(frameOf(view)).toMatch(/section 3\/3/))

    await toggle(true)
    await waitForExpectation(() => expect(frameOf(view)).toContain('DETAIL'))
    await toggle(false)
    await waitForExpectation(() => expect(frameOf(view)).toMatch(/section 3\/3/))
    await waitForExpectation(() => expect(frameOf(view)).toMatch(/▸\s+#400/))

    await sendInput('[')
    await sendInput('[')
    await waitForExpectation(() => expect(frameOf(view)).toMatch(/section 1\/3/))
    await waitForExpectation(() => expect(frameOf(view)).toMatch(/▸\s+#329/))
    // The restored row is the one the next key moves from, not row 0.
    await sendInput('k')
    await waitForExpectation(() => expect(frameOf(view)).toMatch(/▸\s+#328/))
  })
})
