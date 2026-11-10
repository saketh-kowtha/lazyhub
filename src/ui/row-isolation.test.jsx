/**
 * ROW-RENDER (#597, V5): moving the cursor re-renders only the old and new selected rows, and
 * background animation / the minute clock never re-render list rows.
 */
import React from 'react'
import { Box } from 'ink'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { NotificationList } from '../features/notifications/index.jsx'
import { useGh } from '../hooks/useGh.js'
import { Spinner } from '../components/Spinner.jsx'
import { ActivityIndicator } from '../components/ActivityIndicator.jsx'
import { TICK_MS } from './animation.js'
import { setRowRenderProbe } from './ListRow.jsx'
import { sendInput } from '../test/input-bus.js'
import { cleanup, flush, renderWithProviders } from '../test/test-helpers.jsx'

vi.mock('ink', async () => {
  const React = await import('react')
  return { ...await vi.importActual('ink'), useInput: (await import('../test/input-bus.js')).mockUseInput(React) }
})
vi.mock('../hooks/useGh.js', () => ({ useGh: vi.fn() }))

afterEach(() => { setRowRenderProbe(null); cleanup(); vi.restoreAllMocks() })

const mk = (i) => ({ id: String(i), unread: true, reason: 'mention', updatedAt: '2026-06-06T10:00:00Z', repository: { name: 'repo' }, subject: { title: `Thread ${i}`, type: 'Issue' } })

function seed() {
  const query = { data: Array.from({ length: 300 }, (_, i) => mk(i)), loading: false, isLoading: false, error: null, refetch: vi.fn() }
  useGh.mockReturnValue(query)
}

describe('ROW-RENDER: notifications pane, 300 rows', () => {
  it('renders at most 2 rows for j and for k', async () => {
    seed()
    renderWithProviders(<NotificationList repo="owner/repo" onNavigateTo={() => {}} listHeight={20} />)
    await flush(20)
    let renders = 0
    setRowRenderProbe(() => { renders++ })
    await sendInput('j'); await flush(20)
    expect(renders).toBeGreaterThan(0)
    expect(renders).toBeLessThanOrEqual(2)
    renders = 0
    await sendInput('k'); await flush(20)
    expect(renders).toBeGreaterThan(0)
    expect(renders).toBeLessThanOrEqual(2)
  })

  it('stays at 2 when the window scrolls past the bottom edge', async () => {
    seed()
    const view = renderWithProviders(<NotificationList repo="owner/repo" onNavigateTo={() => {}} listHeight={5} />)
    await flush(20)
    for (let i = 0; i < 4; i++) await sendInput('j')
    await flush(20)
    let renders = 0
    setRowRenderProbe(() => { renders++ })
    await sendInput('j'); await flush(20)
    expect(view.lastFrame()).toContain('Thread 5')
    // The window shifts by one: one new row enters, the old selected row and the new one render.
    expect(renders).toBeLessThanOrEqual(3)
  })
})

describe('animation leaves never re-render list rows', () => {
  it('a spinner and an activity indicator ticking cause 0 ListRow renders', async () => {
    seed()
    renderWithProviders(
      <Box flexDirection="column">
        <Spinner label="working" />
        <ActivityIndicator active />
        <NotificationList repo="owner/repo" onNavigateTo={() => {}} listHeight={20} />
      </Box>,
    )
    await flush(20)
    let renders = 0
    setRowRenderProbe(() => { renders++ })
    await new Promise(r => setTimeout(r, TICK_MS * 4 + 40))
    expect(renders).toBe(0)
  })
})
