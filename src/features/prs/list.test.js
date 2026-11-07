/**
 * list.test.js — PR list theme wiring (#566): the list reads the one theme (`t`), and the derived
 * `scheme` view that callers like the list dialogs still hold maps back onto the same tokens.
 */

import { describe, it, expect } from 'vitest'
import { canToggleAutoMergeFromList } from './list.jsx'
import { schemeToT } from './list-row.jsx'
import { resolveTheme, tToScheme } from '../../theme.js'

describe.each(['github-dark', 'github-light', 'terminal'])('schemeToT(tToScheme(t)) — %s', (name) => {
  const theme = resolveTheme(name)
  const t = schemeToT(tToScheme(theme))

  it('keeps the one palette: muted, dim and selected come from t.ui', () => {
    expect(t.ui.muted).toBe(theme.ui.muted)
    expect(t.ui.dim).toBe(theme.ui.dim)
    expect(t.ui.selected).toBe(theme.ui.selected)
  })

  it('keeps the PR state and CI tokens', () => {
    for (const k of ['open', 'draft', 'merged', 'closed']) expect(t.pr[k]).toBe(theme.pr[k])
    for (const k of ['pass', 'fail', 'pending']) expect(t.ci[k]).toBe(theme.ci[k])
  })

  it('maps conflict to the pending colour and review to pass/fail', () => {
    expect(t.pr.conflict).toBe(theme.ci.pending)
    expect(t.review.approved).toBe(theme.ci.pass)
    expect(t.review.changes).toBe(theme.ci.fail)
  })
})

describe('canToggleAutoMergeFromList', () => {
  it('allows focused open non-draft PRs to claim the M key', () => {
    expect(canToggleAutoMergeFromList({ state: 'OPEN', isDraft: false })).toBe(true)
  })

  it('leaves M available for the merged filter outside eligible PRs', () => {
    expect(canToggleAutoMergeFromList({ state: 'OPEN', isDraft: true })).toBe(false)
    expect(canToggleAutoMergeFromList({ state: 'MERGED', isDraft: false })).toBe(false)
    expect(canToggleAutoMergeFromList(null)).toBe(false)
  })
})
