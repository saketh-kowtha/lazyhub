import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, writeFileSync, existsSync, readFileSync, rmSync } from 'fs'
import { tmpdir, homedir } from 'os'
import { join } from 'path'
import { parse } from 'smol-toml'
import { loadConfig, fetchRemoteConfig, formatError } from './loader.js'
import { DEFAULT_CONFIG, BUILTIN_SCOPES } from './schema.js'

let dir
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'lazyhub-cfg-')) })
afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

const writeCfg = (toml) => {
  const p = join(dir, 'lazyhub.toml')
  writeFileSync(p, toml, 'utf8')
  return p
}

// ── defaultConfig.toml is the source of truth for defaults ─────────────────────

describe('defaultConfig.toml', () => {
  it('parses to exactly DEFAULT_CONFIG', () => {
    const text = readFileSync(new URL('./defaultConfig.toml', import.meta.url), 'utf8')
    expect(parse(text)).toEqual(DEFAULT_CONFIG)
  })
})

// ── loadConfig: missing / valid / invalid user file ────────────────────────────

describe('loadConfig — defaults', () => {
  it('returns full defaults when the user file is missing', () => {
    const cfg = loadConfig({ configPath: join(dir, 'does-not-exist.toml') })
    expect(cfg.ui).toEqual(DEFAULT_CONFIG.ui)
    expect(cfg.defaults).toEqual(DEFAULT_CONFIG.defaults)
    expect(cfg.scopes).toEqual(BUILTIN_SCOPES)
  })

  it('expands ~ in path fields', () => {
    const cfg = loadConfig({ configPath: join(dir, 'missing.toml') })
    expect(cfg.agent.audit_log_path).toBe(join(homedir(), '.config/lazyhub/audit.log'))
    expect(cfg.daemon.socket_path).toBe(join(homedir(), '.config/lazyhub/daemon.sock'))
    expect(cfg.daemon.pid_file).toBe(join(homedir(), '.config/lazyhub/daemon.pid'))
  })
})

describe('loadConfig — merge semantics', () => {
  it('merges user overrides on top of defaults (per-key)', () => {
    const p = writeCfg(`
[ui]
density = "comfortable"

[defaults]
pr_scope = "all"
`)
    const cfg = loadConfig({ configPath: p })
    expect(cfg.ui.density).toBe('comfortable')
    expect(cfg.ui.show_hints).toBe(DEFAULT_CONFIG.ui.show_hints) // untouched default kept
    expect(cfg.defaults.pr_scope).toBe('all')
    expect(cfg.defaults.ai_provider).toBe(DEFAULT_CONFIG.defaults.ai_provider)
  })

  it('merges a partial custom scope and a new scope alongside the built-ins', () => {
    const p = writeCfg(`
[scopes.read-only]
allow_comments = true

[scopes.my-bot]
allow_reads = true
allow_merges = false
`)
    const cfg = loadConfig({ configPath: p })
    expect(cfg.scopes['read-only'].allow_comments).toBe(true)
    expect(cfg.scopes['read-only'].allow_reads).toBe(true) // built-in preserved
    expect(cfg.scopes.full).toEqual(BUILTIN_SCOPES.full)
    expect(cfg.scopes['my-bot']).toEqual({ allow_reads: true, allow_merges: false })
  })

  it('folds platform-specific keymap sub-sections for the given platform', () => {
    const p = writeCfg(`
[keymaps.pr-list]
m = "pr.merge"

[keymaps.pr-list.darwin]
m = "pr.merge-mac"
`)
    expect(loadConfig({ configPath: p, platform: 'darwin' }).keymaps['pr-list'].m).toBe('pr.merge-mac')
    expect(loadConfig({ configPath: p, platform: 'linux' }).keymaps['pr-list'].m).toBe('pr.merge')
    // platform sub-section is resolved away, not left in the result
    expect(loadConfig({ configPath: p, platform: 'darwin' }).keymaps['pr-list'].darwin).toBeUndefined()
  })
})

describe('loadConfig — invalid TOML recovery', () => {
  it('falls back to defaults on a syntax error instead of throwing', () => {
    const p = writeCfg('this is = = not valid toml [[[')
    const cfg = loadConfig({ configPath: p })
    expect(cfg.ui).toEqual(DEFAULT_CONFIG.ui)
    expect(cfg.defaults).toEqual(DEFAULT_CONFIG.defaults)
  })
})

// ── formatError ────────────────────────────────────────────────────────────────

describe('formatError', () => {
  it('mentions the source and the TOML error for parse failures', () => {
    let tomlErr
    try { parse('a = = 1') } catch (e) { tomlErr = e }
    const msg = formatError(tomlErr, '/path/to/lazyhub.toml')
    expect(msg).toContain('/path/to/lazyhub.toml')
    expect(msg.toLowerCase()).toContain('toml')
  })

  it('formats generic read errors', () => {
    const msg = formatError(new Error('EACCES'), '/etc/lazyhub.toml')
    expect(msg).toContain('/etc/lazyhub.toml')
    expect(msg).toContain('EACCES')
  })
})

// ── fetchRemoteConfig: HTTPS enforcement + cache fallback ───────────────────────

describe('fetchRemoteConfig', () => {
  const REMOTE = '[ui]\ndensity = "comfortable"\n'

  it('refuses a non-HTTPS url without calling fetch, returns cache if present', async () => {
    const cachePath = join(dir, '.config-cache.toml')
    writeFileSync(cachePath, REMOTE, 'utf8')
    const fetchImpl = vi.fn()
    const result = await fetchRemoteConfig('http://example.com/c.toml', { cachePath, fetchImpl })
    expect(fetchImpl).not.toHaveBeenCalled()
    expect(result).toEqual({ ui: { density: 'comfortable' } })
  })

  it('returns null for a non-HTTPS url with no cache', async () => {
    const result = await fetchRemoteConfig('http://example.com/c.toml', {
      cachePath: join(dir, 'nope.toml'),
      fetchImpl: vi.fn(),
    })
    expect(result).toBeNull()
  })

  it('falls back to cache on a non-200 response', async () => {
    const cachePath = join(dir, '.config-cache.toml')
    writeFileSync(cachePath, REMOTE, 'utf8')
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 503 })
    const result = await fetchRemoteConfig('https://example.com/c.toml', { cachePath, fetchImpl })
    expect(result).toEqual({ ui: { density: 'comfortable' } })
  })

  it('parses a 200 response and writes the cache', async () => {
    const cachePath = join(dir, '.config-cache.toml')
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, status: 200, text: async () => REMOTE })
    const result = await fetchRemoteConfig('https://example.com/c.toml', { cachePath, fetchImpl })
    expect(result).toEqual({ ui: { density: 'comfortable' } })
    expect(existsSync(cachePath)).toBe(true)
    expect(readFileSync(cachePath, 'utf8')).toBe(REMOTE)
  })

  it('falls back to cache when the network throws', async () => {
    const cachePath = join(dir, '.config-cache.toml')
    writeFileSync(cachePath, REMOTE, 'utf8')
    const fetchImpl = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'))
    const result = await fetchRemoteConfig('https://example.com/c.toml', { cachePath, fetchImpl })
    expect(result).toEqual({ ui: { density: 'comfortable' } })
  })
})
