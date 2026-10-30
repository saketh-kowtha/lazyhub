import React from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup } from 'ink-testing-library'
import { renderWithProviders } from '../../test/test-helpers.jsx'
import { PRRow, schemeToT } from './list-row.jsx'
import scheme from '../../theme/schemes/lazyhub-dark.js'

afterEach(cleanup)
const t = schemeToT(scheme)
const pr = (state) => ({ number: 1, title: 'Same title', state, author: { login: 'a' }, labels: [], reviewRequests: [], headRefName: 'h', baseRefName: 'main', updatedAt: '2026-01-01T00:00:00Z' })
const plain = (s) => s.replace(/\x1b\[[0-9;]*m/g, '')
const row = (state) => plain(renderWithProviders(<PRRow pr={pr(state)} isSelected={false} t={t} titleWidth={30} />).lastFrame())

// Under NO_COLOR / a monochrome terminal the only difference left is the glyph.
describe('PR list row state without colour', () => {
  it('distinguishes open, merged and closed PRs by more than colour', () => {
    const [open, merged, closed] = [row('OPEN'), row('MERGED'), row('CLOSED')]
    expect(new Set([open, merged, closed]).size, `${open}\n${merged}\n${closed}`).toBe(3)
  })
})
