import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { parse } from 'smol-toml'
import { stripFrozenDefaults } from './migrate-frozen.js'
import { loadConfig, takeUnknownActionIds, DEFAULT_CONFIG_TOML_PATH } from './loader.js'
import { createKeymap } from './keymap.js'
import { writeDefaultConfig } from '../config.js'
import { logger } from '../utils.js'
import { execFileSync } from 'child_process'
import { LEGACY_ACTION_VALUES, LEGACY_KEYMAP_BINDINGS } from './legacy-defaults.js'

// A user file as written by a release before #340: the full defaults, frozen, plus the
// stale keymap ids that older releases shipped (app.quit, help.show, settings.open, pr.refresh).
const FROZEN = readFileSync(new URL('./fixtures/frozen-pre-340.toml', import.meta.url), 'utf8')
  .replace('"q"              = "app.back"', '"q"              = "app.quit"')
  .replace('"?"              = "app.help"', '"?"              = "help.show"')
  .replace('","              = "app.settings"', '","              = "settings.open"')
  .replace('"r"     = "list.refresh"', '"r"     = "pr.refresh"')

let dir
let configPath
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'lazyhub-frozen-'))
  configPath = join(dir, 'lazyhub.toml')
  vi.spyOn(logger, 'warn').mockImplementation(() => {})
  takeUnknownActionIds()
})
afterEach(() => {
  vi.restoreAllMocks()
  rmSync(dir, { recursive: true, force: true })
})

const resolve = (scope, key, config) => createKeymap(scope, config).resolve(key, {})

describe('frozen default copies (#475)', () => {
  it('PR-detail keys l A R a m d resolve for a config frozen before #340', () => {
    writeFileSync(configPath, FROZEN)
    const config = loadConfig({ configPath, platform: 'linux' })
    expect(resolve('pr-detail', 'l', config)).toBe('pr.labels')
    expect(resolve('pr-detail', 'A', config)).toBe('pr.assignees')
    expect(resolve('pr-detail', 'R', config)).toBe('pr.reviewers')
    expect(resolve('pr-detail', 'a', config)).toBe('pr.approve')
    expect(resolve('pr-detail', 'm', config)).toBe('pr.merge')
    expect(resolve('pr-detail', 'd', config)).toBe('pr.diff')
  })

  it('a frozen pr.auto-merge keys = ["M"] no longer captures M: M is only the merged filter (#448)', () => {
    writeFileSync(configPath, FROZEN)
    const config = loadConfig({ configPath, platform: 'linux' })
    expect(config.actions['pr.auto-merge'].keys).toEqual([])
    expect(resolve('pr-list', 'M', config)).toBe('pr.filter-merged')
  })

  it('stale keymap ids from old releases fall back to the current defaults silently', () => {
    writeFileSync(configPath, FROZEN)
    const config = loadConfig({ configPath, platform: 'linux' })
    expect(resolve('global', 'q', config)).toBe('app.back')
    expect(resolve('global', '?', config)).toBe('app.help')
    expect(resolve('global', ',', config)).toBe('app.settings')
    expect(resolve('pr-list', 'r', config)).toBe('list.refresh')
    expect(takeUnknownActionIds()).toEqual([])
  })

  it('a frozen config resolves exactly like no config at all', () => {
    writeFileSync(configPath, FROZEN)
    const frozen = loadConfig({ configPath, platform: 'linux' })
    const fresh = loadConfig({ configPath: join(dir, 'missing.toml'), platform: 'linux' })
    expect(frozen.actions).toEqual(fresh.actions)
    expect(frozen.keymaps).toEqual(fresh.keymaps)
  })

  it('genuine user overrides survive next to a frozen copy', () => {
    writeFileSync(configPath, `${FROZEN}\n`
      .replace('[actions."pr.labels"]\nkeys = ["l"]', '[actions."pr.labels"]\nkeys = ["L"]')
      .replace('"j"     = "cursor.down"', '"j"     = "cursor.down"\n"w"     = "pr.merge"'))
    const config = loadConfig({ configPath, platform: 'linux' })
    expect(resolve('pr-detail', 'L', config)).toBe('pr.labels')
    expect(resolve('pr-detail', 'l', config)).toBe(null)
    expect(resolve('pr-list', 'w', config)).toBe('pr.merge')
    // the untouched rest of that action still follows the current default
    expect(config.actions['pr.labels'].scope).toBe('pr-list,pr-detail')
  })

  it('an unknown action id warns once and is dropped', () => {
    writeFileSync(configPath, '[keymaps.pr-list]\n"z" = "pr.nonexistent"\n')
    const config = loadConfig({ configPath, platform: 'linux' })
    expect(takeUnknownActionIds()).toEqual(['pr.nonexistent'])
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('pr.nonexistent'))
    expect(resolve('pr-list', 'z', config)).toBe(null)
    // reported once: a reload does not repeat it
    loadConfig({ configPath, platform: 'linux' })
    expect(takeUnknownActionIds()).toEqual([])
  })

  it('a user-defined action and its binding are kept and not reported as unknown', () => {
    writeFileSync(configPath, '[actions."my.thing"]\nkeys = ["Ctrl+X"]\nscope = "global"\n\n[keymaps.global]\n"Ctrl+Y" = "my.thing"\n')
    const config = loadConfig({ configPath, platform: 'linux' })
    expect(config.keymaps.global['Ctrl+Y']).toBe('my.thing')
    expect(config.actions['my.thing'].keys).toEqual(['Ctrl+X'])
    expect(resolve('global', 'Y', { ...config, keymaps: { global: { Y: 'my.thing' } } })).toBe('my.thing')
    expect(takeUnknownActionIds()).toEqual([])
  })

  it('first run writes a sparse file instead of copying the defaults', () => {
    writeDefaultConfig(configPath)
    const text = readFileSync(configPath, 'utf8')
    expect(parse(text)).toEqual({})
    expect(text.split('\n').length).toBeLessThan(10)
  })
})

describe('stripFrozenDefaults', () => {
  const defaults = parse(readFileSync(DEFAULT_CONFIG_TOML_PATH, 'utf8'))

  it('is idempotent and does not mutate its input', () => {
    const raw = parse(FROZEN)
    const snapshot = JSON.stringify(raw)
    const once = stripFrozenDefaults(raw, defaults)
    expect(JSON.stringify(raw)).toBe(snapshot)
    const twice = stripFrozenDefaults(once.config, defaults)
    expect(twice.config).toEqual(once.config)
    expect(twice.dropped).toBe(0)
  })

  it('removes every action and keymap entry of a frozen copy', () => {
    const { config, dropped } = stripFrozenDefaults(parse(FROZEN), defaults)
    expect(dropped).toBeGreaterThan(400)
    expect(config.actions).toBeUndefined()
    expect(config.keymaps).toBeUndefined()
    expect(config.app).toBeDefined()
  })

  it('keeps platform and unbind tables and non-default scopes', () => {
    const raw = { keymaps: { 'pr-list': { unbind: { m: true }, darwin: { x: 'pr.merge' } } }, actions: { 'pr.merge': { scope: 'pr-detail' } } }
    expect(stripFrozenDefaults(raw, defaults).config).toEqual(raw)
  })

  it('passes non-objects through', () => {
    expect(stripFrozenDefaults(undefined, defaults)).toEqual({ config: undefined, dropped: 0, unknown: [] })
  })
})

describe('legacy-defaults.js covers every shipped revision of defaultConfig.toml', () => {
  const run = (...args) => execFileSync('git', args, { encoding: 'utf8', maxBuffer: 1 << 28, stdio: ['ignore', 'pipe', 'ignore'] })
  let shas = []
  try { shas = run('log', '--full-history', '--format=%H', '--', 'src/config/defaultConfig.toml').trim().split('\n').filter(Boolean) } catch { /* no history available */ }
  // A shallow clone cannot see old revisions; the working-tree check below still runs.
  const hasHistory = shas.length >= 8

  const covered = (list, value) => (list || []).some(v => JSON.stringify(v) === JSON.stringify(value))
  const missing = (rev) => {
    const out = []
    for (const [id, action] of Object.entries(rev.actions || {})) {
      for (const [field, value] of Object.entries(action)) {
        if (!covered(LEGACY_ACTION_VALUES[id]?.[field], value)) out.push(`actions.${id}.${field}=${JSON.stringify(value)}`)
      }
    }
    for (const [scope, bindings] of Object.entries(rev.keymaps || {})) {
      for (const [key, value] of Object.entries(bindings)) {
        if (typeof value === 'string' && !covered(LEGACY_KEYMAP_BINDINGS[scope]?.[key], value)) out.push(`keymaps.${scope}.${key}=${value}`)
      }
    }
    return out
  }

  it('covers the working-tree defaults (regenerate with scripts/gen-legacy-defaults.mjs)', () => {
    expect(missing(parse(readFileSync(DEFAULT_CONFIG_TOML_PATH, 'utf8')))).toEqual([])
  })

  it.skipIf(!hasHistory)('covers every action field and keymap binding of every historical revision', () => {
    for (const sha of shas) {
      expect(missing(parse(run('show', `${sha}:src/config/defaultConfig.toml`))), sha).toEqual([])
    }
  })

  it('keeps exact strings (no inserted spaces)', () => {
    expect(LEGACY_ACTION_VALUES['pr.labels'].scope).toContain('pr-list,pr-detail')
    expect(LEGACY_ACTION_VALUES['app.settings'].hint).toContainEqual(',')
  })
})
