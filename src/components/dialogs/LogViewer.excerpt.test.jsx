/**
 * #463 / #359: a failed job's log opens on a "Failure excerpt" block; `f` switches to the full log and back.
 */
import React from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup } from 'ink-testing-library'
import { renderWithProviders, waitForInputReady, waitForExpectation } from '../../test/test-helpers.jsx'
import { LogViewer } from './LogViewer.jsx'
import { VITEST_LOG } from '../../features/prs/ci-log.fixtures.js'
import { extractExcerpt, loadFailureExcerpt } from '../../features/prs/ci-log.js'
import { toLogLines } from '../../features/actions/log-lines.js'
import { DIALOG_KEYS } from '../../app-keys.js'

afterEach(cleanup)

const full = ['Set up job', 'Run npm test', 'FULL LOG MARKER line']
const ok = { state: 'ok', detail: '', excerpt: extractExcerpt(VITEST_LOG) }

describe('LogViewer failure excerpt (#463)', () => {
  it('opens on the excerpt, not the full log, with its job, step and failing lines', () => {
    const view = renderWithProviders(<LogViewer title="CI · failure" lines={full} excerpt={ok} onClose={() => {}} />)
    const frame = view.lastFrame()
    expect(frame).toContain('Failure excerpt')
    expect(frame).toContain('test (20)')
    expect(frame).toContain('AssertionError')
    expect(frame).not.toContain('FULL LOG MARKER')
    expect(frame).toContain('[f] full log')
  })

  it('f switches to the full log and back', async () => {
    const view = renderWithProviders(<LogViewer lines={full} excerpt={ok} onClose={() => {}} />)
    await waitForInputReady(view)
    view.stdin.write('f')
    await waitForExpectation(() => expect(view.lastFrame()).toContain('FULL LOG MARKER'))
    expect(view.lastFrame()).not.toContain('Failure excerpt')
    expect(view.lastFrame()).toContain('[f] excerpt')
    await waitForInputReady(view)
    view.stdin.write('f')
    await waitForExpectation(() => expect(view.lastFrame()).toContain('Failure excerpt'))
  })

  it('filter moved to / so f is free; it works in the full log only', async () => {
    const view = renderWithProviders(<LogViewer lines={full} excerpt={ok} onClose={() => {}} />)
    await waitForInputReady(view)
    view.stdin.write('/')
    await new Promise(r => setTimeout(r, 30))
    expect(view.lastFrame()).not.toContain('Filter:')
    view.stdin.write('f')
    await waitForExpectation(() => expect(view.lastFrame()).toContain('FULL LOG MARKER'))
    await waitForInputReady(view)
    view.stdin.write('/')
    await waitForExpectation(() => expect(view.lastFrame()).toContain('Filter:'))
  })

  it('says why there is no excerpt instead of guessing', () => {
    const view = renderWithProviders(<LogViewer lines={full} excerpt={{ state: 'expired', detail: 'Log not found or expired', excerpt: null }} onClose={() => {}} />)
    expect(view.lastFrame()).toContain('Failure excerpt unavailable (expired): Log not found or expired')
  })

  it('without an excerpt there is no f key and no excerpt hint', async () => {
    const view = renderWithProviders(<LogViewer lines={full} onClose={() => {}} />)
    expect(view.lastFrame()).not.toContain('excerpt')
    await waitForInputReady(view)
    view.stdin.write('f')
    await new Promise(r => setTimeout(r, 30))
    expect(view.lastFrame()).toContain('FULL LOG MARKER')
    expect(DIALOG_KEYS.logs.map(h => h.label)).not.toContain('excerpt')
    expect(DIALOG_KEYS.failedLogs.map(h => h.label)).toContain('excerpt')
  })

  it('draws excerpt text as untrusted log text: control characters and secrets never reach the screen', () => {
    const raw = 'job\tstep\t2026-01-01T00:00:00Z Error: token=ghp_abcdefghijklmnopqrstuvwxyz0123456789\x1b[31m red \x07\n'
    const excerpt = { state: 'ok', detail: '', excerpt: extractExcerpt(raw) }
    const view = renderWithProviders(<LogViewer lines={[]} excerpt={excerpt} onClose={() => {}} />)
    const frame = view.lastFrame()
    expect(frame).not.toContain('ghp_abcdefghijklmnopqrstuvwxyz0123456789')
    // eslint-disable-next-line no-control-regex
    expect(frame).not.toMatch(/\x07|\x1b\[31m/)
  })
})

describe('failed-log wiring (#463)', () => {
  it('the same loader the viewers use returns each state as data', async () => {
    const result = await loadFailureExcerpt('o/r', { runId: 1 }, async () => ({ state: 'ok', text: VITEST_LOG, detail: '' }))
    expect(result.state).toBe('ok')
    expect(result.excerpt.lines.join('\n')).toContain('AssertionError')
    const gone = await loadFailureExcerpt('o/r', { runId: 1 }, async () => ({ state: 'expired', text: '', detail: 'Log not found or expired' }))
    expect(gone).toMatchObject({ state: 'expired', excerpt: null })
    expect(toLogLines(VITEST_LOG).length).toBeGreaterThan(0)
  })
})
