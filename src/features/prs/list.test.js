/**
 * list.test.js — Phase C step 3: verify PR list theme-token wiring.
 *
 * Goal: prove that schemeToT() correctly maps lazyhub-dark scheme tokens
 * to the `t.*` shape consumed by PR list sub-components.
 *
 * This does NOT render the full PRList component (it requires Ink + gh CLI).
 * Instead we test the pure adapter function and confirm every token path
 * resolves to the correct hex value from the lazyhub-dark scheme.
 */

import { describe, it, expect } from 'vitest'
import { schemeToT } from './list.jsx'
import lazyhubDark from '../../theme/schemes/lazyhub-dark.js'
import lazyhubLight from '../../theme/schemes/lazyhub-light.js'
import { themes } from '../../theme/index.js'

// ── 1. Adapter: lazyhub-dark token values ──────────────────────────────────

describe('schemeToT adapter — lazyhub-dark', () => {
  const t = schemeToT(lazyhubDark)

  it('maps fg.muted → t.ui.muted', () => {
    expect(t.ui.muted).toBe(lazyhubDark.fg.muted)
    expect(t.ui.muted).toBe('#768390')
  })

  it('maps fg.subtle → t.ui.dim', () => {
    expect(t.ui.dim).toBe(lazyhubDark.fg.subtle)
    expect(t.ui.dim).toBe('#545d68')
  })

  it('maps accent.primary → t.ui.selected', () => {
    expect(t.ui.selected).toBe(lazyhubDark.accent.primary)
    expect(t.ui.selected).toBe('#539bf5')
  })

  it('maps pr.open → t.pr.open', () => {
    expect(t.pr.open).toBe(lazyhubDark.pr.open)
    expect(t.pr.open).toBe('#57ab5a')
  })

  it('maps pr.draft → t.pr.draft', () => {
    expect(t.pr.draft).toBe(lazyhubDark.pr.draft)
    expect(t.pr.draft).toBe('#768390')
  })

  it('maps pr.merged → t.pr.merged', () => {
    expect(t.pr.merged).toBe(lazyhubDark.pr.merged)
    expect(t.pr.merged).toBe('#b083f0')
  })

  it('maps pr.closed → t.pr.closed', () => {
    expect(t.pr.closed).toBe(lazyhubDark.pr.closed)
    expect(t.pr.closed).toBe('#e5534b')
  })

  it('maps ci.pending → t.pr.conflict (conflict reuses ci.pending amber)', () => {
    expect(t.pr.conflict).toBe(lazyhubDark.ci.pending)
    expect(t.pr.conflict).toBe('#c69026')
  })

  it('maps ci.pass → t.ci.pass', () => {
    expect(t.ci.pass).toBe(lazyhubDark.ci.pass)
    expect(t.ci.pass).toBe('#57ab5a')
  })

  it('maps ci.fail → t.ci.fail', () => {
    expect(t.ci.fail).toBe(lazyhubDark.ci.fail)
    expect(t.ci.fail).toBe('#e5534b')
  })

  it('maps ci.pending → t.ci.pending', () => {
    expect(t.ci.pending).toBe(lazyhubDark.ci.pending)
    expect(t.ci.pending).toBe('#c69026')
  })

  it('maps ci.skipped → t.ci.skipped', () => {
    expect(t.ci.skipped).toBe(lazyhubDark.ci.skipped)
    expect(t.ci.skipped).toBe('#545d68')
  })

  it('maps ci.pass → t.review.approved (semantic: approval = pass color)', () => {
    expect(t.review.approved).toBe(lazyhubDark.ci.pass)
  })

  it('maps ci.fail → t.review.changes (semantic: changes-requested = fail color)', () => {
    expect(t.review.changes).toBe(lazyhubDark.ci.fail)
  })
})

// ── 2. Adapter: lazyhub-light scheme (proves it works for any scheme) ──────

describe('schemeToT adapter — lazyhub-light', () => {
  const t = schemeToT(lazyhubLight)

  it('maps fg.muted → t.ui.muted', () => {
    expect(t.ui.muted).toBe(lazyhubLight.fg.muted)
  })

  it('maps fg.subtle → t.ui.dim', () => {
    expect(t.ui.dim).toBe(lazyhubLight.fg.subtle)
  })

  it('maps accent.primary → t.ui.selected', () => {
    expect(t.ui.selected).toBe(lazyhubLight.accent.primary)
  })

  it('maps pr.open → t.pr.open', () => {
    expect(t.pr.open).toBe(lazyhubLight.pr.open)
  })
})

// ── 3. Context wiring: ThemeProvider provides lazyhub-dark scheme ──────────
//
// Proves that the theme module's context API exports the correct scheme
// object that schemeToT() will receive at runtime.

describe('ThemeProvider context wiring', () => {
  it('themes["lazyhub-dark"] has all required token paths consumed by PR list', () => {
    const scheme = themes['lazyhub-dark']

    // All token paths that schemeToT() accesses:
    expect(scheme.fg.muted).toBeDefined()
    expect(scheme.fg.subtle).toBeDefined()
    expect(scheme.accent.primary).toBeDefined()
    expect(scheme.pr.open).toBeDefined()
    expect(scheme.pr.draft).toBeDefined()
    expect(scheme.pr.merged).toBeDefined()
    expect(scheme.pr.closed).toBeDefined()
    expect(scheme.ci.pass).toBeDefined()
    expect(scheme.ci.fail).toBeDefined()
    expect(scheme.ci.pending).toBeDefined()
    expect(scheme.ci.skipped).toBeDefined()
  })

  it('schemeToT(themes["lazyhub-dark"]) produces the expected t shape', () => {
    const t = schemeToT(themes['lazyhub-dark'])

    // Structural shape check
    expect(typeof t.ui).toBe('object')
    expect(typeof t.pr).toBe('object')
    expect(typeof t.ci).toBe('object')
    expect(typeof t.review).toBe('object')

    // All color values must be non-empty strings (hex or named)
    for (const [group, tokens] of Object.entries(t)) {
      for (const [key, val] of Object.entries(tokens)) {
        expect(typeof val, `t.${group}.${key} must be a string`).toBe('string')
        expect(val.length, `t.${group}.${key} must not be empty`).toBeGreaterThan(0)
      }
    }
  })
})
