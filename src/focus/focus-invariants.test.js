/**
 * focus-invariants.test.js — AGENTS.md invariant 10 as a ratchet (R6, #484).
 *
 * A dialog owns keys by being on top of the focus stack (`useKeyScope('dialog', open)`), not by a
 * flag. These source scans keep the flag-based mechanism from coming back:
 *   - `notifyDialog` and `dialogActiveRef` are gone and stay gone, in app code and tests alike;
 *   - nothing outside the focus manager compares a focus scope name by string: use
 *     `isModalScope()` / `isViewScope()` from src/keyscope.js;
 *   - the per-pane `if (dialog) return` guards that remain have a recorded count that may only go
 *     down. Each one still guards in-handler input modes (search, compose, base-branch entry) that
 *     run before it, so it cannot simply become `yieldToModal`; migrate one and lower its count.
 */

import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const ROOT = fileURLToPath(new URL('../..', import.meta.url))
const SELF = relative(ROOT, fileURLToPath(import.meta.url))

/**
 * Every .js/.jsx/.mjs file under `dir`.
 * @param {string} dir absolute directory
 * @returns {string[]} absolute file paths
 */
function sources(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) return entry.name === 'node_modules' ? [] : sources(full)
    return /\.(?:js|jsx|mjs)$/.test(entry.name) ? [full] : []
  })
}

const ALL = [...sources(join(ROOT, 'src')), ...sources(join(ROOT, 'bin'))]
  .map(f => ({ file: relative(ROOT, f), code: readFileSync(f, 'utf8') }))
  .filter(({ file }) => file !== SELF)
const APP = ALL.filter(({ file }) => !/\.test\./.test(file))

/**
 * Lines of `code` that are not comments.
 * @param {string} code source text
 * @returns {string[]} code lines
 */
const codeLines = code => code.split('\n').filter(line => !/^\s*(?:\*|\/\/|\/\*)/.test(line))

const FLAG = /\b(?:notifyDialog|dialogActiveRef)\b/
// A focus scope name compared as a string against the live or rendered scope.
const SCOPES = '(?:global|pane|list|view|detail|overlay|dialog|input)'
const SCOPE_COMPARE = new RegExp(
  `\\b(?:activeScope|liveScope\\(\\)|useActiveScope\\(\\))\\s*[!=]==?\\s*['"\`]${SCOPES}['"\`]` +
  `|['"\`]${SCOPES}['"\`]\\s*[!=]==?\\s*(?:activeScope|liveScope\\(\\)|useActiveScope\\(\\))`,
)
// Files that own the scope names: the router, its provider, the keyscope barrel, and the status-bar chip (display only).
const SCOPE_OWNERS = new Set(['src/focus/router.js', 'src/focus/scopes.js', 'src/focus/FocusProvider.js', 'src/keyscope.js', 'src/shell/scopeIndicator.js'])
const PANE_GUARD = /\bif\s*\(\s*dialog\s*\)\s*return\b/g
const GUARD_BASELINE = {
  'src/features/prs/detail.jsx': 1,
  'src/features/prs/list.jsx': 1,
  'src/features/prs/diff/state.js': 1,
  'src/features/actions/index.jsx': 1,
  'src/features/issues/detail.jsx': 1,
  'src/features/issues/list.jsx': 1,
  'src/features/branches/index.jsx': 1,
  'src/features/notifications/index.jsx': 1,
}

describe('dialogs own keys through the focus stack (AGENTS.md invariant 10, #484)', () => {
  it('scans the app source and its tests', () => {
    expect(APP.length).toBeGreaterThan(100)
    expect(ALL.some(({ file }) => file.endsWith('.test.jsx'))).toBe(true)
    expect(APP.some(({ file }) => file === 'src/app.jsx')).toBe(true)
  })

  it('notifyDialog and dialogActiveRef do not come back', () => {
    const hits = ALL.flatMap(({ file, code }) => codeLines(code).filter(line => FLAG.test(line)).map(line => `${file}: ${line.trim()}`))
    expect(hits, 'claim the scope with useKeyScope(\'dialog\', open) instead').toEqual([])
  })

  it('no file outside the focus manager compares a scope name as a string', () => {
    const hits = APP.filter(({ file }) => !SCOPE_OWNERS.has(file))
      .flatMap(({ file, code }) => codeLines(code).filter(line => SCOPE_COMPARE.test(line)).map(line => `${file}: ${line.trim()}`))
    expect(hits, 'use isModalScope() / isViewScope() from src/keyscope.js').toEqual([])
  })

  it('per-pane `if (dialog) return` guards only go down', () => {
    const now = Object.fromEntries(APP
      .map(({ file, code }) => [file, codeLines(code).reduce((n, line) => n + (line.match(PANE_GUARD) || []).length, 0)])
      .filter(([, n]) => n > 0))
    for (const [file, n] of Object.entries(now)) expect(n, `${file}: a new pane guard; claim the scope and use yieldToModal instead`).toBeLessThanOrEqual(GUARD_BASELINE[file] ?? 0)
    for (const [file, n] of Object.entries(GUARD_BASELINE)) expect(now[file] ?? 0, `${file} improved: lower the baseline`).toBe(n)
  })

  it('the patterns catch the shapes they guard against', () => {
    expect(FLAG.test('notifyDialog(true)')).toBe(true)
    expect(FLAG.test('const dialogActiveRef = useRef(false)')).toBe(true)
    expect(FLAG.test('useKeyScope(\'dialog\', open)')).toBe(false)
    for (const code of ["if (activeScope === 'dialog') return", "liveScope() !== 'pane'", "'overlay' === activeScope", 'useActiveScope() === `input`']) {
      expect(SCOPE_COMPARE.test(code), code).toBe(true)
    }
    for (const code of ['if (isModalScope(liveScope())) return', "action.scope === 'global'", "dialog === 'base'"]) {
      expect(SCOPE_COMPARE.test(code), code).toBe(false)
    }
    expect('    if (dialog) return'.match(PANE_GUARD)).toHaveLength(1)
    expect("    if (dialog === 'base') {".match(PANE_GUARD)).toBeNull()
    expect(codeLines(' * the pane needs no `if (dialog) return`.')).toEqual([])
  })
})
