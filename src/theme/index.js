/**
 * src/theme/index.js — Public API for the lazyhub theme system.
 *
 * Exports:
 *   themes         — Map of scheme name → scheme object
 *   getDefaultScheme(env) — Returns 'lazyhub-dark' or 'lazyhub-light' based on
 *                           terminal background detection. Falls back to 'lazyhub-dark'.
 *   ThemeContext   — React context (for advanced consumers)
 *   ThemeProvider  — Wraps the app; provides `useTheme()` to all children
 *   useTheme()     — React hook; returns { scheme, schemeName, setScheme }
 *
 * Usage in components:
 *   import { useTheme } from '../theme/index.js'
 *   const { scheme } = useTheme()
 *   <Text color={scheme.accent.primary}>focused row</Text>
 *
 * Design contract (DESIGN_REVAMP.md §3.4):
 *   - Components NEVER import color literals directly.
 *   - They always consume tokens via useTheme().scheme[...].
 *   - Theme switch is hot — no relaunch required.
 *
 * Only stable React APIs are used (createContext, useContext, useMemo, useState)
 * to remain compatible with both React 18 and React 19.
 */

/* eslint-disable-next-line no-unused-vars */
import React, { createContext, useContext, useMemo, useState } from 'react'
import lazyhubDark  from './schemes/lazyhub-dark.js'
import lazyhubLight from './schemes/lazyhub-light.js'
import { detectBackground } from './bg-detect.js'

// ── Theme registry ────────────────────────────────────────────────────────────

/**
 * All built-in schemes shipped with lazyhub.
 * Per §12.1: only lazyhub-dark and lazyhub-light are in the default cycle.
 * Additional community/opt-in themes will be added in Step 5.
 *
 * @type {Record<string, object>}
 */
export const themes = {
  'lazyhub-dark':  lazyhubDark,
  'lazyhub-light': lazyhubLight,
}

// ── Default scheme selection ──────────────────────────────────────────────────

/**
 * Determine the default scheme name based on terminal environment.
 *
 * Uses bg-detect.js to read $COLORFGBG / $TERM_PROGRAM heuristics.
 * If the terminal is confidently light → returns 'lazyhub-light'.
 * Otherwise → returns 'lazyhub-dark' (safe, default).
 *
 * @param {NodeJS.ProcessEnv} [env] — injectable for testing; defaults to process.env
 * @returns {'lazyhub-dark' | 'lazyhub-light'}
 */
export function getDefaultScheme(env = process.env) {
  const bg = detectBackground(env)
  return bg === 'light' ? 'lazyhub-light' : 'lazyhub-dark'
}

// ── React context + hook ──────────────────────────────────────────────────────

/**
 * Default context value (used when no ThemeProvider is present above in the tree).
 * Defaults to lazyhub-dark so components are safe to render in isolation.
 */
const defaultContextValue = {
  scheme:     lazyhubDark,
  schemeName: 'lazyhub-dark',
  setScheme:  () => {},
}

/**
 * ThemeContext — consumed by useTheme().
 * Exposed for advanced consumers (e.g. testing utilities) that need to
 * provide a custom value without ThemeProvider.
 */
export const ThemeContext = createContext(defaultContextValue)

/**
 * useTheme() — React hook for consuming the active theme.
 *
 * Returns:
 *   scheme     — The active scheme object (tokens tree).
 *   schemeName — The active scheme's registered name ('lazyhub-dark' etc.)
 *   setScheme  — Setter to switch schemes live (hot-swap, no relaunch).
 *
 * Example:
 *   const { scheme } = useTheme()
 *   return <Text color={scheme.accent.primary}>hello</Text>
 *
 * @returns {{ scheme: object, schemeName: string, setScheme: (name: string) => void }}
 */
export function useTheme() {
  return useContext(ThemeContext)
}

/**
 * ThemeProvider — wrap the root of the app (in app.jsx) with this component.
 *
 * Props:
 *   children       — React node tree
 *   initialScheme  — Optional starting scheme name. Defaults to getDefaultScheme().
 *
 * @param {{ children: React.ReactNode, initialScheme?: string }} props
 */
export function ThemeProvider({ children, initialScheme }) {
  const [schemeName, setSchemeName] = useState(
    initialScheme ?? getDefaultScheme()
  )

  const scheme = useMemo(() => {
    return themes[schemeName] ?? lazyhubDark
  }, [schemeName])

  const setScheme = useMemo(() => (name) => {
    if (themes[name]) {
      setSchemeName(name)
    }
  }, [])

  const value = useMemo(
    () => ({ scheme, schemeName, setScheme }),
    [scheme, schemeName, setScheme]
  )

  return (
    <ThemeContext.Provider value={value}>
      {children}
    </ThemeContext.Provider>
  )
}
