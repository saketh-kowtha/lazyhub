import React from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { StatusBar } from './StatusBar.jsx'
import { cleanup, renderWithProviders } from '../test/test-helpers.jsx'
import { clearDaemonFallback, noteDaemonFallback } from '../daemon/fallback.js'
import { getGhHealthSnapshot, recordGhFailure, resetGhHealthForTest } from '../hooks/useGhHealth.js'

afterEach(() => { cleanup(); clearDaemonFallback(); resetGhHealthForTest() })

const bar = health => renderWithProviders(<StatusBar repo="o/r" pane="prs" count={3} ghHealth={health} />).lastFrame()

describe('status bar notice (#491)', () => {
  it('shows that the app is running without the background helper', () => {
    noteDaemonFallback('unavailable')
    const snapshot = getGhHealthSnapshot()
    expect(snapshot.notice).toMatch(/without the background helper/)
    expect(bar(snapshot)).toMatch(/without the background helper/)
  })

  it('shows nothing extra when the helper is in use', () => {
    expect(bar(getGhHealthSnapshot())).not.toMatch(/background helper/)
  })

  it('never hides a real failure behind the notice', () => {
    noteDaemonFallback('unavailable')
    recordGhFailure('listPRs:a', new Error('gh list failed'))
    const frame = bar(getGhHealthSnapshot())
    expect(frame).toMatch(/gh list failed/)
    expect(frame).not.toMatch(/background helper/)
  })
})
