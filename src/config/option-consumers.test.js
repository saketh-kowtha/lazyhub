// #465: every shipped config option does something, retired ones load silently, the PR scope key is
// the documented one, and the shipped defaults do not conflict with themselves.
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'
import { parse } from 'smol-toml'
import { DEFAULT_CONFIG, validateConfig } from './schema.js'
import { generateConfigReferenceMarkdown } from './docs.js'
import { legacyFromToml } from '../config.js'

const shipped = () => parse(readFileSync(new URL('./defaultConfig.toml', import.meta.url), 'utf8'))
const withUser = (patch) => {
  const base = structuredClone(DEFAULT_CONFIG)
  for (const [section, table] of Object.entries(patch)) base[section] = { ...(base[section] || {}), ...table }
  return base
}

describe('shipped defaults', () => {
  it('validate with no warnings (no keymap binding conflicts with a default action key)', () => {
    expect(validateConfig(shipped()).warnings).toEqual([])
  })

  it('keeps single-letter keys case-sensitive: a is approve, A is assignees', () => {
    const { warnings } = validateConfig({
      actions: {
        'x.lower': { keys: ['a'], scope: 'pr-list' },
        'x.upper': { keys: ['A'], scope: 'pr-list' },
      },
      keymaps: { 'pr-list': { a: 'x.lower', A: 'x.upper' } },
    })
    expect(warnings.filter(w => w.includes('also matches'))).toEqual([])
  })

  it('still reports a real conflict (same key, different action)', () => {
    const { warnings } = validateConfig({
      actions: { 'x.one': { keys: ['q'], scope: 'pr-list' }, 'x.two': { keys: ['z'], scope: 'pr-list' } },
      keymaps: { 'pr-list': { q: 'x.two' } },
    })
    expect(warnings.some(w => w.includes('also matches "x.one"'))).toBe(true)
  })
})

describe('options that had no consumer', () => {
  it('density, high_contrast and max_lines are gone from the defaults and load without a warning', () => {
    expect(DEFAULT_CONFIG.ui).not.toHaveProperty('density')
    expect(DEFAULT_CONFIG.ui).not.toHaveProperty('high_contrast')
    expect(DEFAULT_CONFIG.diff).not.toHaveProperty('max_lines')
    const { config, warnings } = validateConfig({ ui: { density: 'comfortable', high_contrast: true }, diff: { max_lines: 10 } })
    expect(warnings).toEqual([])
    expect(config.ui).toEqual({})
    expect(config.diff).toEqual({})
  })

  it('[ui].show_hints = false hides the footer hints like compact_footer', () => {
    expect(legacyFromToml(withUser({})).layout.compactFooter).toBe(false)
    expect(legacyFromToml(withUser({ ui: { show_hints: false } })).layout.compactFooter).toBe(true)
    expect(legacyFromToml(withUser({ layout: { compact_footer: true } })).layout.compactFooter).toBe(true)
  })

  it('[layout].preview_panel reaches the PR list (it hides the detail popover)', () => {
    expect(legacyFromToml(withUser({ layout: { preview_panel: false } })).layout.previewPanel).toBe(false)
    const src = readFileSync(new URL('../features/prs/list.jsx', import.meta.url), 'utf8')
    expect(src).toMatch(/previewPanel === false/)
  })
})

describe('PR scope key', () => {
  it('[features.prs].default_scope sets the list scope', () => {
    expect(legacyFromToml(withUser({ features: { ...DEFAULT_CONFIG.features, prs: { ...DEFAULT_CONFIG.features.prs, default_scope: 'all' } } })).pr.defaultScope).toBe('all')
  })

  it('the retired [defaults].pr_scope still works until default_scope is set', () => {
    expect(legacyFromToml(withUser({ defaults: { pr_scope: 'all' } })).pr.defaultScope).toBe('all')
    const both = withUser({ defaults: { pr_scope: 'all' }, features: { ...DEFAULT_CONFIG.features, prs: { ...DEFAULT_CONFIG.features.prs, default_scope: 'reviewing' } } })
    expect(legacyFromToml(both).pr.defaultScope).toBe('reviewing')
  })

  it('the generated reference names features.prs.default_scope, not defaults.pr_scope', () => {
    const md = generateConfigReferenceMarkdown(DEFAULT_CONFIG)
    expect(md).toContain('features.prs.default_scope')
    expect(md).not.toContain('defaults.pr_scope')
  })
})
