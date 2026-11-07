/**
 * row-colour-budget.test.jsx — one accent per focused row; red/yellow/green only for attention (#566).
 *
 * Rows are drawn with the github-dark hex theme so every foreground colour is a distinguishable
 * truecolour code; the terminal theme maps the same tokens onto ANSI names.
 */
import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.hoisted(() => { process.env.FORCE_COLOR = '3'; delete process.env.NO_COLOR })

import { cleanup } from 'ink-testing-library'
import { renderWithProviders } from './test/test-helpers.jsx'
import { resolveTheme } from './theme.js'
import { PRRow } from './features/prs/list-row.jsx'
import { IssueRow } from './features/issues/list-row.jsx'

afterEach(cleanup)

const t = resolveTheme('github-dark')
// eslint-disable-next-line no-control-regex
const FG = /\x1b\[38;2;(\d+);(\d+);(\d+)m/g
const hex = (r, g, b) => '#' + [r, g, b].map(n => Number(n).toString(16).padStart(2, '0')).join('')
const colours = frame => new Set([...frame.matchAll(FG)].map(m => hex(m[1], m[2], m[3])))

const healthyPR = {
  number: 7, title: 'Tidy the parser', state: 'OPEN', mergeable: 'MERGEABLE', updatedAt: new Date(Date.now() - 20 * 86_400_000).toISOString(),
  author: { login: 'maria' }, reviewDecision: 'APPROVED',
  statusCheckRollup: [{ state: 'SUCCESS' }],
}

const prFrame = (pr, isSelected) => renderWithProviders(<PRRow pr={pr} isSelected={isSelected} t={t} titleWidth={24} />).lastFrame()

describe('PR row colour budget', () => {
  it('an unfocused healthy row uses no attention colour and no author or age colour', () => {
    const used = colours(prFrame(healthyPR, false))
    for (const c of [t.ci.pass, t.ci.fail, t.ci.pending, t.pr.open, t.pr.merged, t.pr.closed]) expect(used.has(c), c).toBe(false)
    expect([...used].every(c => c === t.ui.muted), [...used].join(' ')).toBe(true)
  })

  it('the focused row uses the accent only', () => {
    expect([...colours(prFrame(healthyPR, true))]).toEqual([t.ui.selected])
  })

  it('failing CI and changes requested stay red', () => {
    const used = colours(prFrame({ ...healthyPR, reviewDecision: 'CHANGES_REQUESTED', statusCheckRollup: [{ state: 'FAILURE' }] }, false))
    expect(used.has(t.ci.fail)).toBe(true)
    expect(used.has(t.ci.pass)).toBe(false)
  })

  it('a conflict and pending CI stay yellow', () => {
    expect(colours(prFrame({ ...healthyPR, mergeable: 'CONFLICTING' }, false)).has(t.pr.conflict)).toBe(true)
    expect(colours(prFrame({ ...healthyPR, statusCheckRollup: [{ state: 'PENDING' }] }, false)).has(t.ci.pending)).toBe(true)
  })

  it('state is told apart by glyph, not colour', () => {
    const glyph = pr => prFrame(pr, false).match(/[●◆○◐▲⟳]/)[0]
    expect(glyph(healthyPR)).toBe('●')
    expect(glyph({ ...healthyPR, state: 'MERGED' })).toBe('◆')
    expect(glyph({ ...healthyPR, state: 'CLOSED' })).toBe('○')
    expect(glyph({ ...healthyPR, isDraft: true })).toBe('◐')
    expect(glyph({ ...healthyPR, mergeable: 'CONFLICTING' })).toBe('▲')
  })
})

describe('issue row colour budget', () => {
  const issue = { number: 3, title: 'Crash on start', state: 'OPEN', updatedAt: new Date(Date.now() - 30 * 86_400_000).toISOString(), author: { login: 'bo' }, labels: [{ name: 'bug', color: 'ff0000' }] }
  const frame = isSelected => renderWithProviders(<IssueRow issue={issue} isSelected={isSelected} t={t} width={80} />).lastFrame()

  it('labels render muted when unfocused, never in the label colour', () => {
    const used = colours(frame(false))
    expect(used.has('#ff0000')).toBe(false)
    expect([...used]).toEqual([t.ui.muted])
  })

  it('the focused row shows the gutter glyph and uses the accent only', () => {
    expect(frame(true)).toContain('▎')
    expect([...colours(frame(true))]).toEqual([t.ui.selected])
  })
})
