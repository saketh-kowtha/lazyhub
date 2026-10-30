import React from 'react'
import { describe, expect, it, afterEach } from 'vitest'
import { renderWithProviders, waitForExpectation, cleanup } from './test/test-helpers.jsx'
import { HelpOverlay } from './app-panels.jsx'

afterEach(cleanup)

// App passes availableHeight = rows - 3 (app-views.jsx:120): 27 on a 100x30 terminal.
describe('help overlay height budget', () => {
  it('stays within availableHeight on 100x30 (issues list)', async () => {
    const view = renderWithProviders(<HelpOverlay pane="issues" view="list" actionCtx={{}} onClose={() => {}} availableWidth={76} availableHeight={27} />)
    Object.defineProperty(view.stdout, 'columns', { value: 100, configurable: true })
    Object.defineProperty(view.stdout, 'rows', { value: 30, configurable: true })
    await waitForExpectation(() => expect(view.lastFrame()).toContain('Keyboard Reference'))
    const lines = view.lastFrame().split('\n')
    expect(lines.length, view.lastFrame()).toBeLessThanOrEqual(25)
  })
})
