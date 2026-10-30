import React from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup } from 'ink-testing-library'
import { renderWithProviders } from '../../test/test-helpers.jsx'
import { LogViewer } from './LogViewer.jsx'

afterEach(cleanup)

// `gh run view --log` emits "<job>\t<step>\t<timestamp> <message>" on every line.
const lines = [
  'build\tSet up job\t2026-01-01T00:00:00.0000000Z Current runner version: 2.311.0',
  'build\tRun tests\t2026-01-01T00:00:03.0000000Z ' + 'x'.repeat(160),
]

describe('LogViewer with real gh log lines', () => {
  it('does not emit raw TAB characters (they break the frame in a terminal)', () => {
    const view = renderWithProviders(<LogViewer lines={lines} onClose={() => {}} />)
    expect(view.lastFrame()).not.toContain('\t')
  })
  it('never draws a line wider than the terminal', () => {
    const view = renderWithProviders(<LogViewer lines={lines} onClose={() => {}} />)
    const widest = Math.max(...view.lastFrame().split('\n').map(l => [...l].length))
    expect(widest).toBeLessThanOrEqual(100)
  })
})
