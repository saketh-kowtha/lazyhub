import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup } from 'ink-testing-library'
import { renderWithProviders, waitForInputReady, waitForExpectation } from '../../test/test-helpers.jsx'
import { WhyRed } from './WhyRed.jsx'
import { NODE_ASSERT_LOG } from './ci-log.fixtures.js'

afterEach(cleanup)

const deps = (over = {}) => ({
  getFailedLog: async () => ({ state: 'ok', text: NODE_ASSERT_LOG, detail: '' }),
  listPRChangedPaths: async () => ({ files: [{ path: 'src/math.js' }], truncated: false, error: null }),
  getPRFilePatch: async () => ({ status: 'ok', patch: '@@ -1,2 +1,8 @@\n a\n b\n+c\n+d\n+e\n+f\n+g\n+return x' }),
  getBaseCheckHistory: async () => ({ state: 'ok', detail: '', samples: [{ sha: 'a', outcome: 'failure' }, { sha: 'b', outcome: 'failure' }], partial: false }),
  ...over,
})
const checks = [{ id: 1, name: 'test (20)', status: 'completed', conclusion: 'failure', appName: 'GitHub Actions' }]

describe('WhyRed view', () => {
  it('shows check, step, excerpt, changed line and base verdict', async () => {
    const view = renderWithProviders(<WhyRed repo="o/r" prNumber={7} baseBranch="main" checks={checks} deps={deps()} onClose={() => {}} />)
    await waitForExpectation(() => expect(view.lastFrame()).toContain('also failing on main'))
    const f = view.lastFrame()
    expect(f).toContain('Why is CI red?')
    expect(f).toContain('test (20)')
    expect(f).toContain('failing step: Run node --test')
    expect(f).toContain('AssertionError')
    expect(f).toContain('src/math.js:7')
  })

  it('Esc closes, d opens the diff', async () => {
    const onClose = vi.fn()
    const onOpenDiff = vi.fn()
    const view = renderWithProviders(<WhyRed repo="o/r" prNumber={7} baseBranch="main" checks={checks} deps={deps()} onClose={onClose} onOpenDiff={onOpenDiff} />)
    await waitForInputReady(view)
    view.stdin.write('d')
    await waitForExpectation(() => expect(onOpenDiff).toHaveBeenCalled())
    view.stdin.write('\x1b')
    await waitForExpectation(() => expect(onClose).toHaveBeenCalled())
  })

  it('shows an error as unknown', async () => {
    const bad = deps({ getFailedLog: async () => { throw new Error('x') } , getBaseCheckHistory: async () => { throw new Error('y') } })
    const view = renderWithProviders(<WhyRed repo="o/r" prNumber={7} baseBranch="main" checks={checks} deps={bad} onClose={() => {}} />)
    await waitForExpectation(() => expect(view.lastFrame()).toContain('unknown'))
    expect(view.lastFrame()).toContain('Could not fetch the failed-step log')
  })
})
