import React from 'react'
import { Box } from 'ink'
import { afterEach, describe, expect, it } from 'vitest'
import { renderWithProviders, cleanup } from '../../../test/test-helpers.jsx'
import { PRDetailHeader } from './Header.jsx'

afterEach(cleanup)

const pr = {
  number: 142, title: 'feat(guidance): add closed-loop attitude controller', state: 'OPEN',
  author: { login: 'maria-lopez' }, updatedAt: new Date(Date.now() - 2 * 3600e3).toISOString(),
  baseRefName: 'main', headRefName: 'feat/attitude-ctrl', additions: 19, deletions: 2, changedFiles: 2,
}

describe('PR detail header at a 50-column terminal (#464)', () => {
  it('keeps the author/branch/diffstat line on one row instead of wrapping each field', () => {
    const view = renderWithProviders(<Box width={48}><PRDetailHeader pr={pr} /></Box>)
    const lines = view.lastFrame().split('\n')
    expect(lines.length, view.lastFrame()).toBeLessThanOrEqual(3)
    expect(view.lastFrame()).toContain('maria-lopez')
    expect(view.lastFrame()).toContain('feat/attitude-ctrl')
  })

  it('never draws wider than its box, even with a very long title', () => {
    const long = { ...pr, title: 'x'.repeat(200), headRefName: 'feature/' + 'y'.repeat(100) }
    const view = renderWithProviders(<Box width={40}><PRDetailHeader pr={long} /></Box>)
    for (const line of view.lastFrame().split('\n')) expect(line.length).toBeLessThanOrEqual(40)
    expect(view.lastFrame().split('\n').length).toBeLessThanOrEqual(3)
  })
})
