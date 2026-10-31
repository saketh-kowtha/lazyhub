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
