import React from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup } from 'ink-testing-library'
import { renderWithProviders } from '../../test/test-helpers.jsx'
import { LogViewer } from './LogViewer.jsx'

afterEach(cleanup)

// `gh run view --log` emits "<job>\t<step>\t<timestamp> <message>" on every line (#463).
const lines = [
  'build\tSet up job\t2026-01-01T00:00:00.0000000Z Current runner version: 2.311.0',
  'build\tRun tests\t2026-01-01T00:00:03.0000000Z ' + 'x'.repeat(160),
  'build\tRun tests\t2026-01-01T00:00:04.0000000Z progress 10%\r50%\x07\x00 done\x1b[31m red\x1b[0m',
]

describe('LogViewer with real gh log lines (#463)', () => {
  it('does not emit raw TAB characters (they break the frame in a terminal)', () => {
    const view = renderWithProviders(<LogViewer lines={lines} onClose={() => {}} />)
    expect(view.lastFrame()).not.toContain('\t')
  })
  it('expands tabs to stops instead of collapsing them', () => {
    const view = renderWithProviders(<LogViewer lines={['a\tb']} onClose={() => {}} />)
    expect(view.lastFrame()).toContain('a   b')
  })
  it('strips CR, BEL, NUL and ANSI from log text', () => {
    const view = renderWithProviders(<LogViewer lines={lines} onClose={() => {}} />)
    // eslint-disable-next-line no-control-regex
    expect(view.lastFrame()).not.toMatch(/[\x00-\x08\x0b-\x1a\x1c-\x1f\x7f\r]/)
    expect(view.lastFrame()).toContain('done')
    expect(view.lastFrame()).toContain('red')
  })
  it('never draws a line wider than the terminal', () => {
    const view = renderWithProviders(<LogViewer lines={lines} onClose={() => {}} />)
    const widest = Math.max(...view.lastFrame().split('\n').map(l => [...l].length))
    expect(widest).toBeLessThanOrEqual(100)
  })
  it('shows the supplied title (run name and status) instead of a bare "Log Viewer"', () => {
    const view = renderWithProviders(<LogViewer title="CI · failure" lines={lines} onClose={() => {}} />)
    expect(view.lastFrame()).toContain('CI · failure')
  })
})
