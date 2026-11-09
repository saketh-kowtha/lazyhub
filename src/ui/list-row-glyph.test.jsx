// #460 / R9 (#487): every list row marks the selection and the PR state with a glyph, not only a colour.
import React from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup } from 'ink-testing-library'
import { renderWithProviders } from '../test/test-helpers.jsx'
import { resolveTheme } from '../theme.js'
import { GLYPH_MAP } from '../theme/terminal.js'
import { SELECTION_GLYPH } from './ListRow.jsx'
import { PRRow } from '../features/prs/list-row.jsx'
import { IssueRow } from '../features/issues/list-row.jsx'

afterEach(cleanup)
const t = resolveTheme('github-dark')
// eslint-disable-next-line no-control-regex
const strip = s => s.replace(/\u001b\[[0-9;]*m/g, '')
const frame = el => strip(renderWithProviders(el).lastFrame())
const now = new Date().toISOString()

describe('selection glyph survives NO_COLOR', () => {
  const issue = { number: 7, title: 'An issue', state: 'OPEN', author: { login: 'a' }, labels: [], updatedAt: now }
  const pr = { number: 1, title: 'A PR', state: 'OPEN', author: { login: 'a' }, updatedAt: now }

  it('marks the selected issue and PR row, and only that row', () => {
    expect(frame(<IssueRow issue={issue} isSelected t={t} />)).toContain(SELECTION_GLYPH)
    expect(frame(<IssueRow issue={issue} isSelected={false} t={t} />)).not.toContain(SELECTION_GLYPH)
    expect(frame(<PRRow pr={pr} isSelected t={t} titleWidth={25} />)).toContain(SELECTION_GLYPH)
    expect(frame(<PRRow pr={pr} isSelected={false} t={t} titleWidth={25} />)).not.toContain(SELECTION_GLYPH)
  })
})

describe('PR state is distinguishable by glyph', () => {
  const base = { number: 1, title: 'T', author: { login: 'a' }, updatedAt: now }
  const glyphFor = state => frame(<PRRow pr={{ ...base, state }} isSelected={false} t={t} titleWidth={25} />).trim()[0]

  it('uses a different glyph for open, merged and closed', () => {
    const glyphs = ['OPEN', 'MERGED', 'CLOSED'].map(glyphFor)
    expect(new Set(glyphs).size).toBe(3)
  })

  it('every state glyph has an ASCII stand-in', () => {
    for (const g of ['OPEN', 'MERGED', 'CLOSED'].map(glyphFor)) expect(Object.keys(GLYPH_MAP)).toContain(g)
    expect(Object.keys(GLYPH_MAP)).toContain(SELECTION_GLYPH)
  })
})
