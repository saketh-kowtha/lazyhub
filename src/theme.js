/**
 * theme.js — resolves the active theme from config and exports t.
 *
 * Import { t } from './theme.js' everywhere — never inline hex strings.
 *
 * Config "theme" field can be:
 *   "github-dark"               → built-in theme by name (default)
 *   "github-light"              → built-in theme by name
 *   "catppuccin-mocha"          → built-in theme by name (extra dark)
 *   "catppuccin-latte"          → built-in theme by name (light)
 *   "tokyo-night"               → built-in theme by name (dark)
 *   "/path/to/theme.json"       → load full custom theme from JSON file
 *   "~/..."                     → path resolved relative to home dir
 *   "./relative"                → path resolved relative to ~/.config/ghui/
 *   { "name": "tokyo-night", "overrides": { "ui": { "selected": "#ff0" } } }
 *   { "ui": { "selected": "#ff0" } }  → plain overrides on github-dark (legacy)
 */

import { readFileSync, existsSync } from 'fs'
import { join, isAbsolute } from 'path'
import { homedir } from 'os'

import githubDark      from './themes/github-dark.js'
import githubLight     from './themes/github-light.js'
import catppuccinMocha from './themes/catppuccin-mocha.js'
import catppuccinLatte from './themes/catppuccin-latte.js'
import tokyoNight      from './themes/tokyo-night.js'

export const BUILTIN_THEMES = {
  'github-dark':      githubDark,
  'github-light':     githubLight,
  'catppuccin-mocha': catppuccinMocha,
  'catppuccin-latte': catppuccinLatte,
  'tokyo-night':      tokyoNight,
}

export const THEME_NAMES = Object.keys(BUILTIN_THEMES)

// ─── Deep merge ───────────────────────────────────────────────────────────────

function deepMerge(base, overrides) {
  if (!overrides || typeof overrides !== 'object' || Array.isArray(overrides)) return base
  const result = { ...base }
  for (const [key, val] of Object.entries(overrides)) {
    if (key in result && typeof result[key] === 'object' && !Array.isArray(result[key])
        && typeof val === 'object' && !Array.isArray(val)) {
      result[key] = deepMerge(result[key], val)
    } else {
      result[key] = val
    }
  }
  return result
}

// ─── Path resolution ──────────────────────────────────────────────────────────

function resolvePath(p) {
  if (p.startsWith('~/')) return join(homedir(), p.slice(2))
  if (isAbsolute(p)) return p
  // Relative paths are resolved from ~/.config/ghui/
  return join(homedir(), '.config', 'ghui', p)
}

function loadThemeFile(p) {
  const resolved = resolvePath(p)
  if (!existsSync(resolved)) return null
  try { return JSON.parse(readFileSync(resolved, 'utf8')) } catch { return null }
}

// ─── Theme resolution ─────────────────────────────────────────────────────────

function resolveTheme(cfg) {
  const fallback = githubDark

  if (!cfg) return fallback

  // String: either a built-in name or a file path
  if (typeof cfg === 'string') {
    if (BUILTIN_THEMES[cfg]) return BUILTIN_THEMES[cfg]
    const fromFile = loadThemeFile(cfg)
    return fromFile ? deepMerge(fallback, fromFile) : fallback
  }

  // Object forms
  if (typeof cfg === 'object' && !Array.isArray(cfg)) {
    // { name, overrides } form
    if (typeof cfg.name === 'string') {
      const namedBase = BUILTIN_THEMES[cfg.name] || fallback
      return deepMerge(namedBase, cfg.overrides || {})
    }
    // Legacy: plain overrides object applied on top of github-dark
    return deepMerge(fallback, cfg)
  }

  return fallback
}

// ─── Read config synchronously (avoids circular dep with config.js) ───────────

function readRawThemeCfg() {
  try {
    const cfgPath = join(homedir(), '.config', 'ghui', 'config.json')
    if (!existsSync(cfgPath)) return null
    return JSON.parse(readFileSync(cfgPath, 'utf8'))?.theme ?? null
  } catch { return null }
}

// ─── Exported resolved theme ──────────────────────────────────────────────────

export const t = resolveTheme(readRawThemeCfg())
