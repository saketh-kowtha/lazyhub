/**
 * theme.test.js — the single theme system (#566): the terminal default, name mapping, bg-detect.
 */
import { describe, it, expect } from 'vitest'
import { BUILTIN_THEMES, THEME_NAMES, DEFAULT_THEME_NAME, resolveTheme, hexThemeForBackground } from './theme.js'
import githubDark from './themes/github-dark.js'
import terminal from './themes/terminal.js'

const ANSI = new Set([
  'black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white', 'gray', 'grey',
  'blackBright', 'redBright', 'greenBright', 'yellowBright', 'blueBright', 'magentaBright', 'cyanBright', 'whiteBright',
])

// Every leaf of a token tree as [dotted path, value].
function leaves(node, prefix = '') {
  return Object.entries(node).flatMap(([k, v]) => (
    v && typeof v === 'object' ? leaves(v, `${prefix}${k}.`) : [[`${prefix}${k}`, v]]
  ))
}

describe('terminal theme (default)', () => {
  it('is the default when no theme is configured', () => {
    expect(DEFAULT_THEME_NAME).toBe('terminal')
    expect(resolveTheme(null)).toBe(terminal)
    expect(resolveTheme(undefined)).toBe(terminal)
    expect(resolveTheme('no-such-theme-or-file')).toBe(terminal)
  })

  it('is built only from ANSI named colours (or the terminal default)', () => {
    for (const [path, value] of leaves(resolveTheme('terminal'))) {
      if (value === undefined) continue
      expect(ANSI.has(value), `${path} = ${JSON.stringify(value)} is not an ANSI named colour`).toBe(true)
    }
  })

  it('fills every token of the hex theme shape', () => {
    const resolved = resolveTheme('terminal')
    for (const [path] of leaves(githubDark)) {
      const keys = path.split('.')
      const group = keys.slice(0, -1).reduce((n, k) => n?.[k], resolved)
      expect(group && keys.at(-1) in group, `terminal theme lacks ${path}`).toBe(true)
    }
  })

  it('keeps attention colours distinct from the accent', () => {
    const t = resolveTheme('terminal')
    expect(t.ui.selected).toBe('cyan')
    expect(new Set([t.ci.pass, t.ci.fail, t.ci.pending]).size).toBe(3)
    expect(t.ui.selected).not.toBe(t.ci.fail)
  })

  it('is selectable by name and listed first', () => {
    expect(THEME_NAMES[0]).toBe('terminal')
    expect(resolveTheme({ name: 'terminal', overrides: { ui: { selected: 'magenta' } } }).ui.selected).toBe('magenta')
  })
})

describe('named themes keep working', () => {
  it.each(THEME_NAMES.filter(n => n !== 'terminal'))('%s resolves over the hex base', (name) => {
    const t = resolveTheme(name)
    expect(t.ui.selected).toBeTruthy()
    expect(t.diff).toBeTruthy()
  })

  it('maps the lazyhub-* names as before', () => {
    expect(BUILTIN_THEMES['lazyhub-dark']).toBe(BUILTIN_THEMES['github-dark'])
    expect(BUILTIN_THEMES['lazyhub-light']).toBe(BUILTIN_THEMES['github-light'])
    expect(resolveTheme('lazyhub-dark').ui.selected).toBe(githubDark.ui.selected)
  })
})

describe('bg-detect picks light or dark for the hex themes', () => {
  it('chooses by terminal background', () => {
    expect(hexThemeForBackground({})).toBe('github-dark')
    expect(hexThemeForBackground({ COLORFGBG: '0;15' })).toBe('github-light')
    expect(hexThemeForBackground({ COLORFGBG: '15;0' })).toBe('github-dark')
  })
})
