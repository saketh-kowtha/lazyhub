import React from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { HelpOverlay } from './app-panels.jsx'
import { cleanup, renderWithProviders } from './test/test-helpers.jsx'

afterEach(() => cleanup())

describe('HelpOverlay docs link', () => {
  it('shows the real docs URL on wide terminals', () => {
    const { lastFrame } = renderWithProviders(
      <HelpOverlay
        pane="prs"
        view="list"
        actionCtx={{}}
        onClose={() => {}}
        availableWidth={120}
        availableHeight={40}
      />
    )
    const frame = lastFrame()
    expect(frame).toContain('saketh-kowtha.github.io/lazyhub')
    expect(frame).not.toContain('github.io/lgh')
  })
})

describe('HelpOverlay height budget (#462)', () => {
  const cases = [[100, 30, 'issues', 'list'], [80, 24, 'prs', 'list'], [60, 20, 'prs', 'list'], [60, 20, 'prs', 'detail']]
  for (const [cols, rows, pane, view] of cases) {
    it(`fits availableHeight at ${cols}x${rows} (${pane} ${view}) with one line per row`, () => {
      const availableHeight = rows - 3
      const { lastFrame, stdout } = renderWithProviders(
        <HelpOverlay pane={pane} view={view} actionCtx={{}} onClose={() => {}} availableWidth={cols - 4} availableHeight={availableHeight} />
      )
      Object.defineProperty(stdout, 'columns', { value: cols, configurable: true })
      Object.defineProperty(stdout, 'rows', { value: rows, configurable: true })
      const lines = lastFrame().split('\n')
      expect(lines.length, lastFrame()).toBeLessThanOrEqual(availableHeight)
      expect(lines.at(-1), lastFrame()).toMatch(/[╯┘]/)
    })
  }
})
