/**
 * bg-detect.test.js — terminal background detection, which picks light or dark for the hex themes (#566).
 */

import { describe, it, expect } from 'vitest'
import { detectBackground, parseColorFgBg, guessFromTermProgram } from './bg-detect.js'

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
