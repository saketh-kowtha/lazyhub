/**
 * contrast.test.js — the contrast floor for every hex theme (#566), measured with the WCAG
 * relative-luminance ratio against the theme's declared background (`ui.bg`).
 *
 *   text and state tokens   >= 4.5:1
 *   muted / dim metadata    >= 3:1
 *   borders and dividers    >= 1.8:1  (visible, but still quieter than text)
 *
 * The `terminal` and `ansi-16` themes use the terminal's own palette, so they have no hex to measure.
 */
import { describe, it, expect } from 'vitest'
import { BUILTIN_THEMES, resolveTheme } from '../theme.js'

const luminance = (hex) => {
  const n = parseInt(hex.slice(1), 16)
  const lin = c => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4 }
  return 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255)
}

/**
 * WCAG contrast ratio between two #rrggbb colours.
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

const TEXT_MIN = 4.5
const META_MIN = 3
const BORDER_MIN = 1.8

const TEXT = [
  'ui.fg', 'ui.selected', 'ui.borderActive',
  'pr.open', 'pr.merged', 'pr.closed', 'pr.draft', 'pr.conflict',
  'issue.open', 'issue.closed',
  'ci.pass', 'ci.fail', 'ci.pending', 'ci.running',
  'review.approved', 'review.changes', 'review.pending',
  'diff.ctxFg',
]
const META = ['ui.muted', 'ui.dim', 'diff.hunkFg', 'syntax.comment']
const BORDER = ['ui.border', 'ui.divider', 'diff.threadBorder']

const get = (obj, path) => path.split('.').reduce((n, k) => n?.[k], obj)

// Themes whose colours are hex (declare ui.bg); the ANSI themes follow the terminal instead.
const HEX_THEMES = Object.keys(BUILTIN_THEMES).filter(name => /^#/.test(BUILTIN_THEMES[name].ui?.bg ?? ''))

describe('contrast floor for the hex themes (#566)', () => {
  it('covers every hex theme', () => {
    expect(HEX_THEMES).toEqual(expect.arrayContaining(['github-dark', 'github-light', 'catppuccin-mocha', 'catppuccin-latte', 'tokyo-night', 'aurora-dark', 'aurora-light']))
  })

  describe.each(HEX_THEMES)('%s', (name) => {
    const t = resolveTheme(name)
    const bg = t.ui.bg

    it.each(TEXT)(`%s is at least ${TEXT_MIN}:1`, (path) => {
      expect(contrast(get(t, path), bg), `${name} ${path} ${get(t, path)} on ${bg}`).toBeGreaterThanOrEqual(TEXT_MIN)
    })

    it.each(META)(`%s is at least ${META_MIN}:1`, (path) => {
      expect(contrast(get(t, path), bg), `${name} ${path} ${get(t, path)} on ${bg}`).toBeGreaterThanOrEqual(META_MIN)
    })

    it.each(BORDER)(`%s is at least ${BORDER_MIN}:1`, (path) => {
      expect(contrast(get(t, path), bg), `${name} ${path} ${get(t, path)} on ${bg}`).toBeGreaterThanOrEqual(BORDER_MIN)
    })

    it.each(Object.entries(t.syntax).filter(([k]) => k !== 'comment'))(`syntax.%s is at least ${TEXT_MIN}:1`, (key, value) => {
      expect(contrast(value, bg), `${name} syntax.${key} ${value} on ${bg}`).toBeGreaterThanOrEqual(TEXT_MIN)
    })

    it.each([['add', 'addFg', 'addBg'], ['add', 'addSign', 'addBg'], ['del', 'delFg', 'delBg'], ['del', 'delSign', 'delBg']])(
      `diff %s text (%s) on its row background (%s) is at least ${TEXT_MIN}:1`,
      (_kind, fg, rowBg) => {
        expect(contrast(t.diff[fg], t.diff[rowBg]), `${name} diff.${fg} on diff.${rowBg}`).toBeGreaterThanOrEqual(TEXT_MIN)
      },
    )
  })

  it('fails today\'s github-dark dim (#484f58): about 2:1 on #0d1117', () => {
    expect(contrast('#484f58', '#0d1117')).toBeLessThan(META_MIN)
  })
})
