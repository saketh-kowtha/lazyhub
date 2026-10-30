import React from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import { LogPane } from './index.jsx'
import { cleanup, renderWithProviders, waitForExpectation, waitForInputReady } from '../../test/test-helpers.jsx'

vi.mock('../../utils.js', async () => ({
  ...await vi.importActual('../../utils.js'),
  getLogs: () => [
    { timestamp: '2026-10-30T10:00:00Z', level: 'INFO', message: 'Loaded review queue', component: 'queue' },
    { timestamp: '2026-10-30T10:01:00Z', level: 'ERROR', message: 'Refresh failed', component: 'queue' },
  ],
}))

afterEach(cleanup)

it('renders Debug Logs and supports level filtering, search, and log details (#372)', async () => {
  const onBack = vi.fn()
  const view = renderWithProviders(<LogPane onBack={onBack} />)
  const shows = async (text) => {
    await waitForExpectation(() => expect(view.lastFrame()).toContain(text))
    await waitForInputReady(view)
  }

  await shows('Debug Logs')
  await shows('2 entries')
  expect(view.lastFrame()).toContain('Refresh failed')

  view.stdin.write('f')
  await shows('Filter: INFO')
  await shows('1 entries')
  expect(view.lastFrame()).not.toContain('Refresh failed')

  view.stdin.write('/')
  await shows('╭')
  view.stdin.write('Loaded')
  await shows('Search: Loaded')
  view.stdin.write('\r')
  await waitForExpectation(() => expect(view.lastFrame()).not.toContain('╭'))
  await waitForInputReady(view)
  view.stdin.write('\r')
  await shows('Log Details')
  expect(view.lastFrame()).toContain('Loaded review queue')
  expect(view.lastFrame()).toContain('2026-10-30T10:00:00Z')

  view.stdin.write('q')
  await shows('Debug Logs')
  view.stdin.write('q')
  await waitForExpectation(() => expect(onBack).toHaveBeenCalledOnce())
})
