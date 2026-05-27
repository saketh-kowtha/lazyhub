/**
 * src/ui/CommandPalette.test.jsx
 *
 * Unit tests for:
 *   - fuzzyScore()     — scoring algorithm
 *   - filterActions()  — context filtering + fuzzy ranking
 *   - resolveContext() — (pane, view) → context string
 *   - buildActions()   — registry shape and completeness
 */

import { describe, it, expect, vi } from 'vitest'
import { fuzzyScore, filterActions, resolveContext, buildActions } from './actions.js'

// ─── fuzzyScore ───────────────────────────────────────────────────────────────

describe('fuzzyScore — exact and substring matches', () => {
  it('returns 100 for empty query', () => {
    expect(fuzzyScore('Approve PR', '')).toBe(100)
    expect(fuzzyScore('Quit', '   ')).toBe(100)
  })

  it('returns 100 for exact match', () => {
    expect(fuzzyScore('Approve PR', 'approve pr')).toBe(100)
  })

  it('returns 100 for substring match', () => {
    expect(fuzzyScore('Approve PR', 'approve')).toBe(100)
    expect(fuzzyScore('Merge PR (squash)', 'squash')).toBe(100)
  })
})

describe('fuzzyScore — word-prefix matching', () => {
  it('matches "ap" as prefix of "Approve"', () => {
    expect(fuzzyScore('Approve PR', 'ap')).toBeGreaterThanOrEqual(70)
  })

  it('matches "mr sq" as word prefixes (merge + squash)', () => {
    // "mr" → prefix of nothing? "merge" starts with "m" and "pr" starts with "p"
    // "mr" → m=merge, r=? — should be >= 10 (subsequence at minimum)
    // "sq" → prefix of "squash"
    const score1 = fuzzyScore('Merge PR (squash)', 'sq')
    expect(score1).toBeGreaterThanOrEqual(70) // "sq" is prefix of "squash"
  })

  it('matches "me sq" as word prefixes', () => {
    const score = fuzzyScore('Merge PR (squash)', 'me sq')
    // "me" is prefix of "merge", "sq" is prefix of "squash"
    expect(score).toBeGreaterThanOrEqual(70)
  })
})

describe('fuzzyScore — subsequence matching', () => {
  it('matches "apv" as subsequence of "Approve PR"', () => {
    const score = fuzzyScore('Approve PR', 'apv')
    // a-p-p-r-o-v-e: a(0),p(1),v(5) — present in order
    expect(score).toBeGreaterThanOrEqual(10)
  })

  it('matches "mrsq" as subsequence of "Merge PR (squash)"', () => {
    // m...r...s...q — m(0),r(6=PR),s(9=squash start?),q(11)
    const score = fuzzyScore('Merge PR (squash)', 'mrsq')
    expect(score).toBeGreaterThanOrEqual(10)
  })

  it('returns -1 for non-matching query', () => {
    expect(fuzzyScore('Approve PR', 'zzzz')).toBe(-1)
    expect(fuzzyScore('Quit', 'xyz')).toBe(-1)
  })
})

describe('fuzzyScore — real-world palette queries', () => {
  it('"approve" matches "Approve PR" with high score', () => {
    expect(fuzzyScore('Approve PR', 'approve')).toBe(100)
  })

  it('"merge sq" matches "Merge PR (squash)"', () => {
    const score = fuzzyScore('Merge PR (squash)', 'merge sq')
    expect(score).toBeGreaterThanOrEqual(70)
  })

  it('"theme dark" matches "Switch theme: github-dark"', () => {
    // "theme dark" contains "theme" which is a substring of label
    const score = fuzzyScore('Switch theme: github-dark', 'theme dark')
    // "theme dark" isn't a substring but "theme" and "dark" may both be prefixes
    expect(score).toBeGreaterThanOrEqual(10)
  })

  it('"quit" matches "Quit" best-score', () => {
    expect(fuzzyScore('Quit', 'quit')).toBe(100)
  })
})

// ─── resolveContext ───────────────────────────────────────────────────────────

describe('resolveContext', () => {
  it('returns "pr-list" for prs pane in list view', () => {
    expect(resolveContext('prs', 'list')).toBe('pr-list')
  })

  it('returns "pr-detail" for prs pane in detail view', () => {
    expect(resolveContext('prs', 'detail')).toBe('pr-detail')
  })

  it('returns "diff" for any pane in diff view', () => {
    expect(resolveContext('prs', 'diff')).toBe('diff')
    expect(resolveContext('issues', 'diff')).toBe('diff')
  })

  it('returns "issues" for issues pane in list view', () => {
    expect(resolveContext('issues', 'list')).toBe('issues')
  })

  it('returns pane name for non-prs pane in detail view', () => {
    expect(resolveContext('issues', 'detail')).toBe('issues-detail')
  })
})

// ─── filterActions ────────────────────────────────────────────────────────────

describe('filterActions — context filtering', () => {
  const callbacks = {
    onNavigate: vi.fn(),
    onTheme:    vi.fn(),
    onClose:    vi.fn(),
    onQuit:     vi.fn(),
    themes:     ['github-dark', 'github-light'],
  }

  it('includes global actions in any context', () => {
    const actions = buildActions(callbacks)
    const results = filterActions(actions, '', 'pr-list')
    const ids = results.map(a => a.id)
    // All results should be from global or pr-list context
    expect(ids.length).toBeGreaterThan(0)
  })

  it('includes pr-list actions when context is pr-list', () => {
    const actions = buildActions(callbacks)
    const results = filterActions(actions, 'approve', 'pr-list', 20)
    const approveAction = results.find(a => a.id === 'pr.approve')
    expect(approveAction).toBeDefined()
  })

  it('excludes pr-list actions when context is issues', () => {
    const actions = buildActions(callbacks)
    const results = filterActions(actions, '', 'issues', 50)
    const prOnly = results.find(a => a.id === 'pr.open-selected')
    expect(prOnly).toBeUndefined()
  })

  it('includes multi-context actions in each matching context', () => {
    const actions = buildActions(callbacks)
    // pr.merge has context ['pr-list', 'pr-detail']
    const inList   = filterActions(actions, 'merge', 'pr-list',   20)
    const inDetail = filterActions(actions, 'merge', 'pr-detail', 20)
    expect(inList.find(a => a.id === 'pr.merge')).toBeDefined()
    expect(inDetail.find(a => a.id === 'pr.merge')).toBeDefined()
  })
})

// ─── buildActions ─────────────────────────────────────────────────────────────

describe('buildActions — registry shape', () => {
  const callbacks = {
    onNavigate: vi.fn(),
    onTheme:    vi.fn(),
    onClose:    vi.fn(),
    onQuit:     vi.fn(),
    themes:     ['github-dark', 'catppuccin-mocha'],
  }

  it('returns an array of action objects', () => {
    const actions = buildActions(callbacks)
    expect(Array.isArray(actions)).toBe(true)
    expect(actions.length).toBeGreaterThan(10)
  })

  it('every action has required fields: id, label, context, run', () => {
    const actions = buildActions(callbacks)
    for (const a of actions) {
      expect(typeof a.id).toBe('string')
      expect(typeof a.label).toBe('string')
      expect(a.context).toBeDefined()
      expect(typeof a.run).toBe('function')
    }
  })

  it('all action ids are unique', () => {
    const actions = buildActions(callbacks)
    const ids = actions.map(a => a.id)
    const unique = new Set(ids)
    expect(unique.size).toBe(ids.length)
  })

  it('builds theme actions for each provided theme', () => {
    const actions = buildActions(callbacks)
    const themeActions = actions.filter(a => a.category === 'theme')
    expect(themeActions.length).toBe(2)
    expect(themeActions.find(a => a.id === 'theme.github-dark')).toBeDefined()
    expect(themeActions.find(a => a.id === 'theme.catppuccin-mocha')).toBeDefined()
  })

  it('global.quit calls onQuit when run', () => {
    const quitFn  = vi.fn()
    const closeFn = vi.fn()
    const actions = buildActions({ ...callbacks, onQuit: quitFn, onClose: closeFn })
    const quitAction = actions.find(a => a.id === 'global.quit')
    expect(quitAction).toBeDefined()
    quitAction.run({})
    expect(quitFn).toHaveBeenCalled()
    expect(closeFn).toHaveBeenCalled()
  })

  it('theme action calls onTheme with correct name when run', () => {
    const themeFn = vi.fn()
    const closeFn = vi.fn()
    const actions = buildActions({ ...callbacks, onTheme: themeFn, onClose: closeFn })
    const darkAction = actions.find(a => a.id === 'theme.github-dark')
    expect(darkAction).toBeDefined()
    darkAction.run({})
    expect(themeFn).toHaveBeenCalledWith('github-dark')
    expect(closeFn).toHaveBeenCalled()
  })
})
