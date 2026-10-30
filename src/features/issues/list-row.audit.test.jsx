import React from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup } from 'ink-testing-library'
import { renderWithProviders } from '../../test/test-helpers.jsx'
import { IssueRow } from './list-row.jsx'
import { schemeToT } from '../prs/list-row.jsx'
import scheme from '../../theme/schemes/lazyhub-dark.js'

afterEach(cleanup)
const t = schemeToT(scheme)
const issue = (state) => ({ number: 7, title: 'Same title', state, author: { login: 'a' }, labels: [], updatedAt: new Date().toISOString() })
// Frames are compared without SGR: this is what NO_COLOR / a monochrome terminal shows.
const plain = (s) => s.replace(/\x1b\[[0-9;]*m/g, '')

describe('issue list row without colour', () => {
  it('marks the selected row with a glyph, not only a colour/background', () => {
    const on = plain(renderWithProviders(<IssueRow issue={issue('OPEN')} isSelected={true} t={t} />).lastFrame())
    const off = plain(renderWithProviders(<IssueRow issue={issue('OPEN')} isSelected={false} t={t} />).lastFrame())
    expect(on).not.toEqual(off)
  })
})
