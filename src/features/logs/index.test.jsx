import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup } from 'ink-testing-library'
import { renderWithProviders, waitForExpectation } from '../../test/test-helpers.jsx'
import { LogPane } from './index.jsx'

vi.mock('../../utils.js', async (original) => ({
  ...await original(),
  getLogs: () => [{ timestamp: '2026-01-02T03:04:05.000Z', level: 'ERROR', message: 'boom happened', component: 'gh' }],
}))
afterEach(cleanup)

describe('LogPane', () => {
  it('renders the debug log list instead of throwing on missing ink imports', async () => {
    const view = renderWithProviders(<LogPane onBack={() => {}} />)
    expect(view.lastFrame()).toContain('Debug Logs')
    await waitForExpectation(() => {
      expect(view.lastFrame()).toContain('boom happened')
      expect(view.lastFrame()).toContain('03:04:05')
    })
  })
})
