/**
 * theme.js — resolves the active theme from config and exports t.
 */

import _React, { createContext, useContext, useState, useMemo, useCallback } from 'react'
import { readFileSync, existsSync } from 'fs'
import { join, isAbsolute } from 'path'
import { homedir } from 'os'

import githubDark      from './themes/github-dark.js'
import githubLight     from './themes/github-light.js'
import catppuccinMocha from './themes/catppuccin-mocha.js'
import catppuccinLatte from './themes/catppuccin-latte.js'
import tokyoNight      from './themes/tokyo-night.js'
import ansi16          from './themes/ansi-16.js'

export const BUILTIN_THEMES = {
  'github-dark':      githubDark,
  'github-light':     githubLight,
  'catppuccin-mocha': catppuccinMocha,
  'catppuccin-latte': catppuccinLatte,
  'tokyo-night':      tokyoNight,
  'ansi-16':          ansi16,
}

export const THEME_NAMES = Object.keys(BUILTIN_THEMES)

const ThemeContext = createContext({
  t: githubDark,
  themeName: 'github-dark',
  setTheme: () => {},
})

/**
 *
 */
export function useTheme() {
  return useContext(ThemeContext)
}

/**
 * Provide reactive theme to the entire app.
 * @param root0
 * @param root0.children
 * @param root0.initialTheme
 */
export function ThemeProvider({ children, initialTheme }) {
  const [themeName, setThemeName] = useState(initialTheme || 'github-dark')

  const t = useMemo(() => {
    return resolveTheme(themeName)
  }, [themeName])

  const setTheme = useCallback((name) => {
    setThemeName(name)
  }, [])

  const value = useMemo(() => ({ t, themeName, setTheme }), [t, themeName, setTheme])

  return (
    <ThemeContext.Provider value={value}>
      {children}
    </ThemeContext.Provider>
  )
}

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
  if (!p) return null
  if (typeof p !== 'string') return null
  if (p.startsWith('~/')) return join(homedir(), p.slice(2))
  if (isAbsolute(p)) return p
  return join(homedir(), '.config', 'lazyhub', p)
}

function loadThemeFile(p) {
  const resolved = resolvePath(p)
  if (!resolved || !existsSync(resolved)) return null
  try { return JSON.parse(readFileSync(resolved, 'utf8')) } catch { return null }
}

// ─── Theme resolution ─────────────────────────────────────────────────────────

/**
 *
 * @param cfg
 */
export function resolveTheme(cfg) {
  const fallback = githubDark

  if (!cfg) return fallback

  // String: either a built-in name or a file path
  if (typeof cfg === 'string') {
    if (BUILTIN_THEMES[cfg]) return deepMerge(fallback, BUILTIN_THEMES[cfg])
    const fromFile = loadThemeFile(cfg)
    return fromFile ? deepMerge(fallback, fromFile) : fallback
  }

  // Object forms
  if (typeof cfg === 'object' && !Array.isArray(cfg)) {
    if (typeof cfg.name === 'string') {
      const namedBase = BUILTIN_THEMES[cfg.name] || fallback
      return deepMerge(deepMerge(fallback, namedBase), cfg.overrides || {})
    }
    return deepMerge(fallback, cfg)
  }

  return fallback
}

/**
 *
 */
export function readRawThemeCfg() {
  try {
    const cfgPath = join(homedir(), '.config', 'lazyhub', 'config.json')
    if (!existsSync(cfgPath)) return null
    return JSON.parse(readFileSync(cfgPath, 'utf8'))?.theme ?? null
  } catch { return null }
}

// ─── Exported resolved theme (legacy/fallback) ────────────────────────────────

export const t = resolveTheme(readRawThemeCfg())
