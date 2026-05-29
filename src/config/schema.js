/**
 * config/schema.js — TOML config schema, defaults, validation, and merge logic.
 *
 * This is the pure (no I/O) core of the V1 user-config layer (issue #130, Phase E1).
 * `loader.js` handles all file/network I/O and calls into here.
 *
 * Exports:
 *   - SCHEMA_VERSION      current schema version string
 *   - BUILTIN_SCOPES      the six built-in permission scopes (ARCHITECT_DECISIONS §7)
 *   - DEFAULT_CONFIG      full JS defaults — emergency fallback + canonical shape.
 *                         Values MUST mirror defaultConfig.toml (enforced by a test).
 *   - validateConfig(raw) → { config, warnings }  type-checks a parsed TOML object,
 *                         drops invalid/unknown keys (never throws), collects warnings.
 *   - mergeConfig(a, b)   deep merge (b wins); plain objects merge, arrays/scalars replace.
 *   - mergePlatformKeymaps(keymaps, platform)  fold [keymaps.ctx.<platform>] onto base.
 *   - expandConfigPaths(config)  expand leading ~ to homedir() for known path fields.
 *
 * Validation philosophy (issue acceptance #2):
 *   - unknown key  → warn, ignore that key (don't crash)
 *   - wrong type   → warn, ignore that key (default fills in via merge)
 *   - valid value  → keep
 */

import { homedir } from 'os'
import { join } from 'path'

export const SCHEMA_VERSION = '1.0'

const PLATFORMS = ['darwin', 'linux', 'win32']

const SCOPE_BOOL_KEYS = ['allow_reads', 'allow_writes', 'allow_approvals', 'allow_merges', 'allow_comments']
const SCOPE_ARRAY_KEYS = ['repo_allowlist', 'branch_denylist']

// ─── Built-in permission scopes (ARCHITECT_DECISIONS §7) ────────────────────────

/** @typedef {{allow_reads:boolean,allow_writes:boolean,allow_approvals:boolean,allow_merges:boolean,allow_comments:boolean}} Scope */

function scope(reads, writes, approvals, merges, comments) {
  return {
    allow_reads: reads,
    allow_writes: writes,
    allow_approvals: approvals,
    allow_merges: merges,
    allow_comments: comments,
  }
}

export const BUILTIN_SCOPE_NAMES = ['full', 'read-only', 'review-only', 'comment-only', 'no-merge', 'triage-only']

export const BUILTIN_SCOPES = {
  'full':         scope(true,  true,  true,  true,  true),
  'read-only':    scope(true,  false, false, false, false),
  'review-only':  scope(true,  false, true,  false, true),
  'comment-only': scope(true,  false, false, false, true),
  'no-merge':     scope(true,  true,  true,  false, true),
  'triage-only':  scope(true,  false, false, false, true), // comments on issues only — enforced in L3 #148
}

// ─── Canonical JS defaults (mirror of defaultConfig.toml) ───────────────────────

export const DEFAULT_CONFIG = {
  meta: {
    schema_version: SCHEMA_VERSION,
    config_url: '',
  },
  theme: {
    name: 'lazyhub-dark',
    overrides: {},
  },
  defaults: {
    pr_scope: 'mine',
    ai_provider: 'claude-code',
  },
  ui: {
    density: 'compact',
    show_hints: true,
    no_color: false,
    high_contrast: false,
  },
  keymaps: {
    global: {
      ':': 'command-palette.open',
      '<space><space>': 'command-palette.open',
      ',': 'settings.open',
      'q': 'app.quit',
      '?': 'help.show',
    },
    'pr-list': {
      'j': 'cursor.down',
      'k': 'cursor.up',
      'enter': 'pr.open-selected',
      'a': 'pr.approve',
      'm': 'pr.merge',
      'r': 'pr.refresh',
    },
  },
  tabs: [],
  agent: {
    auto_spawn_daemon: true,
    mcp_auto_register: false,
    default_scope: 'full',
    require_confirm: false,
    audit_log_path: '~/.config/lazyhub/audit.log',
  },
  daemon: {
    idle_timeout_minutes: 30,
    socket_path: '~/.config/lazyhub/daemon.sock',
    pid_file: '~/.config/lazyhub/daemon.pid',
  },
  scopes: { ...BUILTIN_SCOPES },
  ai: {
    budget: {
      monthly_usd_cap: 0,
      per_call_usd_cap: 0,
      on_cap_exceeded: 'warn',
    },
  },
}

// ─── Type helpers ───────────────────────────────────────────────────────────────

/**
 * True for a plain (non-array, non-null) object.
 * @param {*} v value to test
 * @returns {boolean} whether v is a plain object
 */
export function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
}

function checkType(val, type) {
  switch (type) {
    case 'array':   return Array.isArray(val)
    case 'object':  return isPlainObject(val)
    case 'integer': return typeof val === 'number' && Number.isInteger(val)
    case 'number':  return typeof val === 'number' && Number.isFinite(val)
    default:        return typeof val === type
  }
}

/**
 * Validate a flat table of typed scalar fields against a field-spec map.
 * Unknown keys and type/enum/validate violations are dropped with a warning.
 * @param {*} val       raw value (expected to be a table)
 * @param {Object} spec map of key → { type, enum?, validate? }
 * @param {string[]} warnings sink for warning strings
 * @param {string} path dotted section path for messages
 * @returns {Object|undefined} cleaned object, or undefined if `val` isn't a table
 */
function validateFlat(val, spec, warnings, path) {
  if (!isPlainObject(val)) {
    warnings.push(`[${path}] must be a table — section ignored`)
    return undefined
  }
  const out = {}
  for (const [k, v] of Object.entries(val)) {
    const fs = spec[k]
    if (!fs) {
      warnings.push(`unknown key "${k}" in [${path}] — ignored`)
      continue
    }
    if (!checkType(v, fs.type)) {
      warnings.push(`[${path}].${k} expected ${fs.type} — ignored`)
      continue
    }
    if (fs.enum && !fs.enum.includes(v)) {
      warnings.push(`[${path}].${k} = ${JSON.stringify(v)} not one of ${fs.enum.join(' | ')} — ignored`)
      continue
    }
    if (fs.validate) {
      const err = fs.validate(v)
      if (err) {
        warnings.push(`[${path}].${k}: ${err} — ignored`)
        continue
      }
    }
    out[k] = v
  }
  return out
}

// ─── Per-section field specs ────────────────────────────────────────────────────

const META_SPEC = {
  schema_version: { type: 'string' },
  config_url: {
    type: 'string',
    validate: (v) => (v === '' || /^https:\/\//i.test(v) ? null : 'must be an HTTPS URL'),
  },
}

const DEFAULTS_SPEC = {
  pr_scope:    { type: 'string', enum: ['mine', 'reviewing', 'all'] },
  ai_provider: { type: 'string', enum: ['claude-code', 'codex', 'gemini-cli', 'anthropic-api'] },
}

const UI_SPEC = {
  density:       { type: 'string', enum: ['compact', 'comfortable'] },
  show_hints:    { type: 'boolean' },
  no_color:      { type: 'boolean' },
  high_contrast: { type: 'boolean' },
}

const AGENT_SPEC = {
  auto_spawn_daemon: { type: 'boolean' },
  mcp_auto_register: { type: 'boolean' },
  default_scope:     { type: 'string' },
  require_confirm:   { type: 'boolean' },
  audit_log_path:    { type: 'string' },
}

const DAEMON_SPEC = {
  idle_timeout_minutes: { type: 'integer', validate: (v) => (v > 0 ? null : 'must be a positive integer') },
  socket_path:          { type: 'string' },
  pid_file:             { type: 'string' },
}

const BUDGET_SPEC = {
  monthly_usd_cap:  { type: 'number', validate: (v) => (v >= 0 ? null : 'must be >= 0') },
  per_call_usd_cap: { type: 'number', validate: (v) => (v >= 0 ? null : 'must be >= 0') },
  on_cap_exceeded:  { type: 'string', enum: ['warn', 'block'] },
}

// ─── Section validators with bespoke shapes ─────────────────────────────────────

function validateTheme(val, warnings) {
  if (!isPlainObject(val)) {
    warnings.push('[theme] must be a table — section ignored')
    return undefined
  }
  const out = {}
  if ('name' in val) {
    if (typeof val.name === 'string') out.name = val.name
    else warnings.push('[theme].name expected string — ignored')
  }
  if ('overrides' in val) {
    if (!isPlainObject(val.overrides)) {
      warnings.push('[theme.overrides] must be a table — ignored')
    } else {
      const ov = {}
      for (const [token, def] of Object.entries(val.overrides)) {
        // A token value is either a hex/color string or a { fg?, bg? } table.
        if (typeof def === 'string') {
          ov[token] = def
        } else if (isPlainObject(def)) {
          const pair = {}
          if (typeof def.fg === 'string') pair.fg = def.fg
          if (typeof def.bg === 'string') pair.bg = def.bg
          if ('fg' in def && typeof def.fg !== 'string') warnings.push(`[theme.overrides]."${token}".fg expected string — ignored`)
          if ('bg' in def && typeof def.bg !== 'string') warnings.push(`[theme.overrides]."${token}".bg expected string — ignored`)
          ov[token] = pair
        } else {
          warnings.push(`[theme.overrides]."${token}" expected string or { fg, bg } — ignored`)
        }
      }
      out.overrides = ov
    }
  }
  // unknown keys
  for (const k of Object.keys(val)) {
    if (k !== 'name' && k !== 'overrides') warnings.push(`unknown key "${k}" in [theme] — ignored`)
  }
  return out
}

function validateKeymaps(val, warnings) {
  if (!isPlainObject(val)) {
    warnings.push('[keymaps] must be a table — section ignored')
    return undefined
  }
  const out = {}
  for (const [ctx, bindings] of Object.entries(val)) {
    if (!isPlainObject(bindings)) {
      warnings.push(`[keymaps.${ctx}] must be a table — ignored`)
      continue
    }
    const cleaned = {}
    for (const [key, action] of Object.entries(bindings)) {
      if (typeof action === 'string') {
        cleaned[key] = action
      } else if (isPlainObject(action) && PLATFORMS.includes(key)) {
        // Platform sub-section, e.g. [keymaps.pr-list.darwin]. Keep its string bindings;
        // mergePlatformKeymaps() folds it onto the base at load time.
        const sub = {}
        for (const [pk, pv] of Object.entries(action)) {
          if (typeof pv === 'string') sub[pk] = pv
          else warnings.push(`[keymaps.${ctx}.${key}].${pk} expected string action — ignored`)
        }
        cleaned[key] = sub
      } else {
        warnings.push(`[keymaps.${ctx}].${key} expected string action — ignored`)
      }
    }
    out[ctx] = cleaned
  }
  return out
}

function validateTabs(val, warnings) {
  if (!Array.isArray(val)) {
    warnings.push('[[tabs]] must be an array of tables — ignored')
    return undefined
  }
  const out = []
  val.forEach((tab, i) => {
    if (!isPlainObject(tab)) {
      warnings.push(`[[tabs]] entry #${i} must be a table — ignored`)
      return
    }
    const cleaned = {}
    for (const f of ['id', 'label', 'key']) {
      if (f in tab) {
        if (typeof tab[f] === 'string') cleaned[f] = tab[f]
        else warnings.push(`[[tabs]] entry #${i} .${f} expected string — ignored`)
      }
    }
    if ('panes' in tab) {
      if (Array.isArray(tab.panes)) cleaned.panes = tab.panes.filter(isPlainObject)
      else warnings.push(`[[tabs]] entry #${i} .panes expected array — ignored`)
    }
    if (!cleaned.id) {
      warnings.push(`[[tabs]] entry #${i} missing required string "id" — ignored`)
      return
    }
    out.push(cleaned)
  })
  return out
}

function validateScopes(val, warnings) {
  if (!isPlainObject(val)) {
    warnings.push('[scopes] must be a table — section ignored')
    return undefined
  }
  const out = {}
  for (const [name, def] of Object.entries(val)) {
    if (!isPlainObject(def)) {
      warnings.push(`[scopes.${name}] must be a table — ignored`)
      continue
    }
    const cleaned = {}
    for (const [k, v] of Object.entries(def)) {
      if (SCOPE_BOOL_KEYS.includes(k)) {
        if (typeof v === 'boolean') cleaned[k] = v
        else warnings.push(`[scopes.${name}].${k} expected boolean — ignored`)
      } else if (SCOPE_ARRAY_KEYS.includes(k)) {
        if (Array.isArray(v) && v.every((s) => typeof s === 'string')) cleaned[k] = v
        else warnings.push(`[scopes.${name}].${k} expected array of strings — ignored`)
      } else {
        warnings.push(`unknown key "${k}" in [scopes.${name}] — ignored`)
      }
    }
    out[name] = cleaned
  }
  return out
}

function validateAi(val, warnings) {
  if (!isPlainObject(val)) {
    warnings.push('[ai] must be a table — section ignored')
    return undefined
  }
  const out = {}
  for (const [k, v] of Object.entries(val)) {
    if (k === 'budget') {
      const budget = validateFlat(v, BUDGET_SPEC, warnings, 'ai.budget')
      if (budget !== undefined) out.budget = budget
    } else {
      warnings.push(`unknown key "${k}" in [ai] — ignored`)
    }
  }
  return out
}

// ─── Top-level validator ─────────────────────────────────────────────────────────

/**
 * Validate a parsed TOML config object. Never throws: invalid/unknown keys are
 * dropped and recorded in `warnings`. The returned `config` is a partial — only
 * the user-supplied valid keys — meant to be merged onto DEFAULT_CONFIG.
 * @param {*} raw parsed TOML object
 * @returns {{ config: Object, warnings: string[] }}
 */
export function validateConfig(raw) {
  const warnings = []
  if (!isPlainObject(raw)) {
    warnings.push('config root is not a table — using defaults')
    return { config: {}, warnings }
  }
  const out = {}
  const set = (key, value) => { if (value !== undefined) out[key] = value }

  for (const [key, val] of Object.entries(raw)) {
    switch (key) {
      case 'meta':     set('meta',     validateFlat(val, META_SPEC,     warnings, 'meta')); break
      case 'theme':    set('theme',    validateTheme(val, warnings)); break
      case 'defaults': set('defaults', validateFlat(val, DEFAULTS_SPEC, warnings, 'defaults')); break
      case 'ui':       set('ui',       validateFlat(val, UI_SPEC,       warnings, 'ui')); break
      case 'keymaps':  set('keymaps',  validateKeymaps(val, warnings)); break
      case 'tabs':     set('tabs',     validateTabs(val, warnings)); break
      case 'agent':    set('agent',    validateFlat(val, AGENT_SPEC,    warnings, 'agent')); break
      case 'daemon':   set('daemon',   validateFlat(val, DAEMON_SPEC,   warnings, 'daemon')); break
      case 'scopes':   set('scopes',   validateScopes(val, warnings)); break
      case 'ai':       set('ai',       validateAi(val, warnings)); break
      default:         warnings.push(`unknown config section [${key}] — ignored`)
    }
  }
  return { config: out, warnings }
}

// ─── Merge ────────────────────────────────────────────────────────────────────

/**
 * Deep-merge `override` onto `base`. Plain objects merge recursively; arrays and
 * scalars are replaced wholesale. Inputs are not mutated.
 * @param {*} base lower-precedence value
 * @param {*} override higher-precedence value
 * @returns {*} merged result
 */
export function mergeConfig(base, override) {
  if (override === undefined) return base
  if (!isPlainObject(base) || !isPlainObject(override)) return override
  const out = { ...base }
  for (const [k, v] of Object.entries(override)) {
    out[k] = (k in base && isPlainObject(base[k]) && isPlainObject(v))
      ? mergeConfig(base[k], v)
      : v
  }
  return out
}

/**
 * Fold platform sub-sections in keymaps onto their base context bindings.
 * e.g. `[keymaps.pr-list.darwin]` overrides `[keymaps.pr-list]` on macOS, and the
 * platform key is removed from the result. Other platforms' blocks are dropped.
 * @param {Object} keymaps merged keymaps table
 * @param {string} platform process.platform value (darwin|linux|win32|…)
 * @returns {Object} keymaps with platform blocks resolved away
 */
export function mergePlatformKeymaps(keymaps, platform) {
  if (!isPlainObject(keymaps)) return keymaps
  const out = {}
  for (const [ctx, bindings] of Object.entries(keymaps)) {
    if (!isPlainObject(bindings)) { out[ctx] = bindings; continue }
    const base = {}
    let platformOverride = {}
    for (const [key, val] of Object.entries(bindings)) {
      if (PLATFORMS.includes(key) && isPlainObject(val)) {
        if (key === platform) platformOverride = val
      } else {
        base[key] = val
      }
    }
    out[ctx] = { ...base, ...platformOverride }
  }
  return out
}

// ─── Path expansion ─────────────────────────────────────────────────────────────

/**
 * Expand a leading `~` / `~/` to the user's home directory. Never uses a shell.
 * Non-tilde and non-string values pass through unchanged.
 * @param {*} p path-ish value
 * @returns {*} expanded path or original value
 */
export function expandHome(p) {
  if (typeof p !== 'string') return p
  if (p === '~') return homedir()
  if (p.startsWith('~/')) return join(homedir(), p.slice(2))
  return p
}

/**
 * Return a copy of `config` with known path fields (`~`) expanded to homedir().
 * Fields: agent.audit_log_path, daemon.socket_path, daemon.pid_file.
 * @param {Object} config merged config
 * @returns {Object} config copy with expanded paths
 */
export function expandConfigPaths(config) {
  if (!isPlainObject(config)) return config
  const out = { ...config }
  if (isPlainObject(out.agent)) {
    out.agent = { ...out.agent, audit_log_path: expandHome(out.agent.audit_log_path) }
  }
  if (isPlainObject(out.daemon)) {
    out.daemon = {
      ...out.daemon,
      socket_path: expandHome(out.daemon.socket_path),
      pid_file: expandHome(out.daemon.pid_file),
    }
  }
  return out
}
