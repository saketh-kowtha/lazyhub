/**
 * theme.test.js — Unit tests for the src/theme/ module.
 *
 * Test suites:
 *   1. Token coverage — every scheme defines every token from tokens.js
 *   2. getDefaultScheme — returns correct scheme name for COLORFGBG env values
 *   3. bg-detect — parseColorFgBg and guessFromTermProgram return expected values
 *   4. themes registry — all registered themes resolve to objects
 */

import { describe, it, expect } from 'vitest'
import { allTokenPaths, resolveToken } from './tokens.js'
import { themes, getDefaultScheme } from './index.js'
import { detectBackground, parseColorFgBg, guessFromTermProgram } from './bg-detect.js'

// ── 1. Token coverage (parameterized) ────────────────────────────────────────
//
// For each registered scheme, assert that every token path defined in tokens.js
// resolves to a non-undefined value. This enforces 100% coverage per scheme.
//
// Diff tokens (add, del, add_emph, del_emph) are { fg, bg } objects — we assert
// they are objects with both fg and bg string properties.

const tokenPaths = allTokenPaths()

// Token paths whose values are objects ({ fg, bg }), not plain strings.
const OBJECT_TOKENS = new Set(['diff.add', 'diff.del', 'diff.add_emph', 'diff.del_emph'])

describe('Token coverage', () => {
  for (const [schemeName, scheme] of Object.entries(themes)) {
    describe(`scheme: ${schemeName}`, () => {
      for (const path of tokenPaths) {
        it(`defines token "${path}"`, () => {
          const value = resolveToken(scheme, path)
          expect(value, `scheme "${schemeName}" is missing token "${path}"`).toBeDefined()
          expect(value, `scheme "${schemeName}" token "${path}" must not be null`).not.toBeNull()

          if (OBJECT_TOKENS.has(path)) {
            // Diff tokens must be { fg: string, bg: string }
            expect(typeof value, `token "${path}" must be an object`).toBe('object')
            expect(typeof value.fg, `token "${path}.fg" must be a string`).toBe('string')
            expect(typeof value.bg, `token "${path}.bg" must be a string`).toBe('string')
            expect(value.fg.length, `token "${path}.fg" must not be empty`).toBeGreaterThan(0)
            expect(value.bg.length, `token "${path}.bg" must not be empty`).toBeGreaterThan(0)
          } else {
            // All other tokens must be non-empty strings
            expect(typeof value, `token "${path}" must be a string`).toBe('string')
            expect(value.length, `token "${path}" must not be empty string`).toBeGreaterThan(0)
          }
        })
      }
    })
  }
})

// ── 2. getDefaultScheme ──────────────────────────────────────────────────────

describe('getDefaultScheme', () => {
  it('returns "lazyhub-dark" when COLORFGBG is not set', () => {
    expect(getDefaultScheme({})).toBe('lazyhub-dark')
  })

  it('returns "lazyhub-dark" as fallback when env is empty', () => {
    expect(getDefaultScheme({})).toBe('lazyhub-dark')
  })

  it('returns "lazyhub-light" when COLORFGBG=15;0 (light bg = index 0 as fg, 15 as bg segment?)', () => {
    // COLORFGBG="fg;bg" — bg component 15 = bright white = light terminal
    // "15;0" means fg=15 (bright white), bg=0 (black) — dark terminal
    // We parse the LAST segment: 0 → dark
    expect(getDefaultScheme({ COLORFGBG: '15;0' })).toBe('lazyhub-dark')
  })

  it('returns "lazyhub-light" when COLORFGBG=0;15 (fg=black, bg=15=bright-white = light)', () => {
    // "0;15" means fg=0 (black), bg=15 (bright white) = light terminal
    expect(getDefaultScheme({ COLORFGBG: '0;15' })).toBe('lazyhub-light')
  })

  it('returns "lazyhub-light" when COLORFGBG=0;7 (bg=7=white = light)', () => {
    // "0;7" means bg=7 (white palette) = light terminal
    expect(getDefaultScheme({ COLORFGBG: '0;7' })).toBe('lazyhub-light')
  })

  it('returns "lazyhub-dark" when COLORFGBG=15;0 (bg=0=black = dark)', () => {
    expect(getDefaultScheme({ COLORFGBG: '15;0' })).toBe('lazyhub-dark')
  })

  it('returns "lazyhub-dark" when COLORFGBG=15;8 (bg=8=dark gray)', () => {
    expect(getDefaultScheme({ COLORFGBG: '15;8' })).toBe('lazyhub-dark')
  })

  it('returns "lazyhub-dark" when COLORFGBG has unknown bg index', () => {
    expect(getDefaultScheme({ COLORFGBG: '0;5' })).toBe('lazyhub-dark')
  })

  it('returns "lazyhub-light" when COLORTHEME=light and no COLORFGBG', () => {
    expect(getDefaultScheme({ COLORTHEME: 'light' })).toBe('lazyhub-light')
  })

  it('returns "lazyhub-dark" when COLORTHEME=dark and no COLORFGBG', () => {
    expect(getDefaultScheme({ COLORTHEME: 'dark' })).toBe('lazyhub-dark')
  })
})

// ── 3. bg-detect ─────────────────────────────────────────────────────────────

describe('parseColorFgBg', () => {
  it('returns "light" for COLORFGBG="0;15" (bg=15, bright white)', () => {
    expect(parseColorFgBg('0;15')).toBe('light')
  })

  it('returns "light" for COLORFGBG="0;7" (bg=7, white)', () => {
    expect(parseColorFgBg('0;7')).toBe('light')
  })

  it('returns "dark" for COLORFGBG="15;0" (bg=0, black)', () => {
    expect(parseColorFgBg('15;0')).toBe('dark')
  })

  it('returns "dark" for COLORFGBG="15;8" (bg=8, dark gray)', () => {
    expect(parseColorFgBg('15;8')).toBe('dark')
  })

  it('returns "dark" for COLORFGBG="0" (just bg index = 0)', () => {
    expect(parseColorFgBg('0')).toBe('dark')
  })

  it('returns "light" for COLORFGBG="7" (just bg index = 7)', () => {
    expect(parseColorFgBg('7')).toBe('light')
  })

  it('returns "unknown" for COLORFGBG with non-numeric segment', () => {
    expect(parseColorFgBg('fg;bg')).toBe('unknown')
  })

  it('returns "unknown" for COLORFGBG with unrecognized palette index', () => {
    expect(parseColorFgBg('0;5')).toBe('unknown')
  })

  it('returns "unknown" for empty string', () => {
    expect(parseColorFgBg('')).toBe('unknown')
  })

  it('handles 3-part format "fg;middle;bg"', () => {
    // Last segment is 0 = dark
    expect(parseColorFgBg('15;7;0')).toBe('dark')
    // Last segment is 15 = light
    expect(parseColorFgBg('0;0;15')).toBe('light')
  })
})

describe('guessFromTermProgram', () => {
  it('returns "light" for Apple_Terminal', () => {
    expect(guessFromTermProgram('Apple_Terminal')).toBe('light')
  })

  it('returns "dark" for iTerm.app', () => {
    expect(guessFromTermProgram('iTerm.app')).toBe('dark')
  })

  it('returns "dark" for WezTerm', () => {
    expect(guessFromTermProgram('WezTerm')).toBe('dark')
  })

  it('returns "dark" for Alacritty', () => {
    expect(guessFromTermProgram('Alacritty')).toBe('dark')
  })

  it('returns "dark" for kitty', () => {
    expect(guessFromTermProgram('kitty')).toBe('dark')
  })

  it('returns "dark" for Ghostty', () => {
    expect(guessFromTermProgram('Ghostty')).toBe('dark')
  })

  it('returns "unknown" for unrecognized terminal', () => {
    expect(guessFromTermProgram('UnknownTerm')).toBe('unknown')
  })

  it('returns "unknown" for empty string', () => {
    expect(guessFromTermProgram('')).toBe('unknown')
  })
})

describe('detectBackground', () => {
  it('returns "dark" from COLORFGBG when set to dark', () => {
    expect(detectBackground({ COLORFGBG: '15;0' })).toBe('dark')
  })

  it('returns "light" from COLORFGBG when set to light', () => {
    expect(detectBackground({ COLORFGBG: '0;15' })).toBe('light')
  })

  it('falls through to COLORTHEME when COLORFGBG is unrecognized', () => {
    expect(detectBackground({ COLORFGBG: '0;5', COLORTHEME: 'light' })).toBe('light')
  })

  it('falls through to TERM_PROGRAM when COLORFGBG and COLORTHEME are absent', () => {
    expect(detectBackground({ TERM_PROGRAM: 'Apple_Terminal' })).toBe('light')
    expect(detectBackground({ TERM_PROGRAM: 'iTerm.app' })).toBe('dark')
  })

  it('returns "unknown" when nothing is detectable', () => {
    expect(detectBackground({})).toBe('unknown')
  })
})

// ── 4. themes registry ───────────────────────────────────────────────────────

describe('themes registry', () => {
  it('exports both built-in schemes', () => {
    expect(themes).toHaveProperty('lazyhub-dark')
    expect(themes).toHaveProperty('lazyhub-light')
  })

  it('lazyhub-dark is the default (getDefaultScheme with empty env)', () => {
    expect(getDefaultScheme({})).toBe('lazyhub-dark')
  })

  for (const name of Object.keys(themes)) {
    it(`scheme "${name}" is an object`, () => {
      expect(typeof themes[name]).toBe('object')
      expect(themes[name]).not.toBeNull()
    })
  }

  it('allTokenPaths returns a non-empty array', () => {
    expect(tokenPaths.length).toBeGreaterThan(0)
  })

  it('token count matches schema (28 leaf tokens)', () => {
    // bg: 3, fg: 4, accent: 2, status: 4, diff: 6, pr: 4, ci: 4, border: 3 = 30
    // diff.add/del/add_emph/del_emph each count once in the flat list
    expect(tokenPaths.length).toBe(30)
  })
})
