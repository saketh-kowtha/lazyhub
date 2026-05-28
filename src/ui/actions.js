/** actions.js — Central action registry for the command palette. */
/**
 * src/ui/actions.js — Central action registry for the command palette.
 *
 * Each action shape:
 * {
 *   id:       string          — unique identifier (e.g. 'pr.approve')
 *   label:    string          — human label shown in palette (e.g. 'Approve PR')
 *   hint:     string          — optional one-liner description
 *   category: string          — grouping label (e.g. 'pr', 'global')
 *   context:  string|string[] — 'global' | 'pr-list' | 'pr-detail' | 'diff' | ...
 *                               '*' means always visible regardless of context
 *   keys:     string[]        — bindings that also trigger it (display only)
 *   run:      (ctx) => void|Promise
 *                             — executes the action; receives current app context:
 *                               { pane, selectedItem, repo, onNavigate, onTheme,
 *                                 onClose, onQuit, themes }
 * }
 *
 * Context values that match panes/views:
 *   'global'    — always visible
 *   'pr-list'   — visible when pane === 'prs' and view === 'list'
 *   'pr-detail' — visible when pane === 'prs' and view === 'detail'
 *   'diff'      — visible when view === 'diff'
 *   'issues'    — visible when pane === 'issues'
 *
 * The palette resolves context via resolveContext(pane, view).
 */

import {
  mergePR,
  checkoutBranch,
  closePR,
  reviewPR,
} from '../executor.js'

// ─── Fuzzy match algorithm ────────────────────────────────────────────────────

/**
 * Score a label against a query string using subsequence / initials matching.
 *
 * Algorithm:
 *   1. Exact substring match → score 100 (highest relevance)
 *   2. Word prefix match (every query word is a prefix of some label word) → score 70
 *   3. Initials match (query chars match first char of consecutive label words) → score 50
 *   4. Subsequence match (all query chars appear in order in label) → score 10–30
 *   5. No match → score -1
 *
 * Returns -1 if no match at all; higher scores = better match.
 *
 * @param {string} label   — action label to test
 * @param {string} query   — user query string
 * @returns {number}
 */
export function fuzzyScore(label, query) {
  if (!query) return 100
  const l = label.toLowerCase()
  const q = query.toLowerCase().trim()
  if (!q) return 100

  // 1. Exact substring
  if (l.includes(q)) return 100

  const queryWords = q.split(/\s+/).filter(Boolean)
  const labelWords = l.split(/[\s\-_()/]+/).filter(Boolean)

  // 2. All query words are prefixes of some label word (in order or any order)
  const allWordPrefixes = queryWords.every(qw =>
    labelWords.some(lw => lw.startsWith(qw))
  )
  if (allWordPrefixes) return 70

  // 3. Initials match — query chars match the first letter of consecutive label words
  //    e.g. "mrsq" → "Merge PR (squash)" — m=merge, r=pr? No. Let's try label initials.
  //    initials: m, p, s from "merge pr squash" → "mps"; query "mrsq" would not match.
  //    But "mr sq" split → ["mr","sq"] and we do word-prefix check (handled above).
  const initials = labelWords.map(w => w[0]).join('')
  if (q.length <= initials.length && initials.startsWith(q)) return 50
  if (initials.includes(q)) return 45

  // 4. Subsequence match — every char in query appears in label in order
  let qi = 0
  for (let i = 0; i < l.length && qi < q.length; i++) {
    if (l[i] === q[qi]) qi++
  }
  if (qi === q.length) {
    // Score by coverage: shorter label relative to query = better
    return Math.max(10, 30 - Math.floor((l.length - q.length) / 3))
  }

  return -1
}

/**
 * Filter and rank actions for the given query and current context.
 *
 * @param {object[]} actions   — full action list
 * @param {string}   query     — user query (may be empty)
 * @param {string}   context   — resolved context string from resolveContext()
 * @param {number}   [limit=8] — max results to return
 * @returns {object[]}         — scored and sorted actions (score attached as ._score)
 */
export function filterActions(actions, query, context, limit = 8) {
  const results = []

  for (const action of actions) {
    // Context gate: skip actions not relevant to current view
    const ctx = Array.isArray(action.context) ? action.context : [action.context]
    if (!ctx.includes('global') && !ctx.includes(context) && !ctx.includes('*')) {
      continue
    }

    const labelScore = fuzzyScore(action.label, query)
    const hintScore  = action.hint ? fuzzyScore(action.hint, query) : -1
    const idScore    = fuzzyScore(action.id, query)
    const score = Math.max(labelScore, hintScore, idScore)

    if (score >= 0) {
      results.push({ ...action, _score: score })
    }
  }

  // Sort by score descending, then by label alphabetically as tiebreaker
  results.sort((a, b) => {
    if (b._score !== a._score) return b._score - a._score
    return a.label.localeCompare(b.label)
  })

  return results.slice(0, limit)
}

/**
 * Map (pane, view) to the context string used for action filtering.
 *
 * @param {string} pane  — e.g. 'prs', 'issues', 'branches'
 * @param {string} view  — e.g. 'list', 'detail', 'diff'
 * @returns {string}
 */
export function resolveContext(pane, view) {
  if (view === 'diff')    return 'diff'
  if (view === 'detail')  return pane === 'prs' ? 'pr-detail' : `${pane}-detail`
  if (view === 'list')    return pane === 'prs' ? 'pr-list'   : pane
  return view
}

// ─── Action registry ──────────────────────────────────────────────────────────

/**
 * Build the full action list. Called with app-level callbacks so actions can
 * navigate, change theme, and call executor functions.
 *
 * @param {object} callbacks
 * @param {Function} callbacks.onNavigate  — ({ pane, view, itemNumber, filter })
 * @param {Function} callbacks.onTheme     — (themeName)
 * @param {Function} callbacks.onClose     — close palette
 * @param {Function} callbacks.onQuit      — exit app
 * @param {string[]} callbacks.themes      — available theme names
 * @returns {object[]}
 */
export function buildActions({ onNavigate, onTheme, onClose, onQuit, themes = [] }) {
  const actions = []

  // ── Global actions (always visible) ────────────────────────────────────────

  actions.push({
    id:       'global.quit',
    label:    'Quit',
    hint:     'Exit the application',
    category: 'global',
    context:  'global',
    keys:     ['q'],
    run:      () => { onClose(); onQuit() },
  })

  actions.push({
    id:       'global.help',
    label:    'Show Help',
    hint:     'Toggle keyboard reference overlay',
    category: 'global',
    context:  'global',
    keys:     ['?'],
    run:      (ctx) => { onClose(); ctx.onHelp?.() },
  })

  actions.push({
    id:       'global.refresh',
    label:    'Refresh',
    hint:     'Refresh current view, bypass cache',
    category: 'global',
    context:  'global',
    keys:     ['r'],
    run:      (ctx) => { onClose(); ctx.onRefresh?.() },
  })

  actions.push({
    id:       'global.theme.cycle',
    label:    'Cycle Theme',
    hint:     'Switch to next available theme',
    category: 'global',
    context:  'global',
    keys:     [],
    run:      (ctx) => {
      const idx = themes.indexOf(ctx.themeName || '')
      const next = themes[(idx + 1) % Math.max(themes.length, 1)]
      if (next) { onTheme(next); onClose() }
    },
  })

  // Theme switchers — one per theme
  for (const name of themes) {
    actions.push({
      id:       `theme.${name}`,
      label:    `Switch theme: ${name}`,
      hint:     `Apply the ${name} colour scheme`,
      category: 'theme',
      context:  'global',
      keys:     [],
      run:      () => { onTheme(name); onClose() },
    })
  }

  // Pane navigation
  for (const p of ['prs', 'issues', 'branches', 'actions', 'notifications']) {
    const label = { prs: 'Pull Requests', issues: 'Issues', branches: 'Branches', actions: 'Actions', notifications: 'Notifications' }[p]
    actions.push({
      id:       `pane.${p}`,
      label:    `Go to ${label}`,
      hint:     `Switch to the ${label} pane`,
      category: 'navigation',
      context:  'global',
      keys:     [],
      run:      () => { onNavigate({ pane: p }); onClose() },
    })
  }

  // ── PR list context ─────────────────────────────────────────────────────────

  actions.push({
    id:       'pr.open-selected',
    label:    'Open PR Detail',
    hint:     'Open the focused pull request',
    category: 'pr',
    context:  'pr-list',
    keys:     ['Enter'],
    run:      (ctx) => {
      if (ctx.selectedItem) {
        onNavigate({ pane: 'prs', view: 'detail', itemNumber: ctx.selectedItem.number })
        onClose()
      }
    },
  })

  actions.push({
    id:       'pr.open-diff',
    label:    'Open PR Diff',
    hint:     'Open diff view for the focused pull request',
    category: 'pr',
    context:  ['pr-list', 'pr-detail'],
    keys:     ['d'],
    run:      (ctx) => {
      if (ctx.selectedItem) {
        onNavigate({ pane: 'prs', view: 'diff', itemNumber: ctx.selectedItem.number })
        onClose()
      }
    },
  })

  actions.push({
    id:       'pr.merge',
    label:    'Merge PR',
    hint:     'Merge the focused pull request (default strategy)',
    category: 'pr',
    context:  ['pr-list', 'pr-detail'],
    keys:     ['m'],
    run:      (ctx) => {
      if (ctx.selectedItem?.number && ctx.repo) {
        onClose()
        return mergePR(ctx.repo, ctx.selectedItem.number, 'merge')
      }
    },
  })

  actions.push({
    id:       'pr.merge.squash',
    label:    'Merge PR (squash)',
    hint:     'Squash-merge the focused pull request',
    category: 'pr',
    context:  ['pr-list', 'pr-detail'],
    keys:     [],
    run:      (ctx) => {
      if (ctx.selectedItem?.number && ctx.repo) {
        onClose()
        return mergePR(ctx.repo, ctx.selectedItem.number, 'squash')
      }
    },
  })

  actions.push({
    id:       'pr.merge.rebase',
    label:    'Merge PR (rebase)',
    hint:     'Rebase-merge the focused pull request',
    category: 'pr',
    context:  ['pr-list', 'pr-detail'],
    keys:     [],
    run:      (ctx) => {
      if (ctx.selectedItem?.number && ctx.repo) {
        onClose()
        return mergePR(ctx.repo, ctx.selectedItem.number, 'rebase')
      }
    },
  })

  actions.push({
    id:       'pr.approve',
    label:    'Approve PR',
    hint:     'Submit an approving review for the focused pull request',
    category: 'pr',
    context:  ['pr-list', 'pr-detail'],
    keys:     ['a'],
    run:      (ctx) => {
      if (ctx.selectedItem?.number && ctx.repo) {
        onClose()
        return reviewPR(ctx.repo, ctx.selectedItem.number, 'approve')
      }
    },
  })

  actions.push({
    id:       'pr.request-changes',
    label:    'Request Changes on PR',
    hint:     'Submit a request-changes review for the focused pull request',
    category: 'pr',
    context:  ['pr-list', 'pr-detail'],
    keys:     ['x'],
    run:      (ctx) => {
      if (ctx.selectedItem?.number && ctx.repo) {
        onClose()
        return reviewPR(ctx.repo, ctx.selectedItem.number, 'request-changes')
      }
    },
  })

  actions.push({
    id:       'pr.checkout',
    label:    'Checkout PR Branch',
    hint:     'Checkout the pull request branch locally',
    category: 'pr',
    context:  ['pr-list', 'pr-detail'],
    keys:     ['c'],
    run:      (ctx) => {
      if (ctx.selectedItem?.number && ctx.repo) {
        onClose()
        return checkoutBranch(ctx.repo, ctx.selectedItem.number)
      }
    },
  })

  actions.push({
    id:       'pr.copy-url',
    label:    'Copy PR URL',
    hint:     'Copy the pull request URL to clipboard',
    category: 'pr',
    context:  ['pr-list', 'pr-detail'],
    keys:     ['y'],
    run:      (ctx) => {
      if (ctx.selectedItem?.url) {
        onClose()
        // Use pbcopy/xclip/xsel depending on platform
        import('execa').then(({ execa }) => {
          const url = ctx.selectedItem.url
          if (process.platform === 'darwin') {
            execa('pbcopy', [], { input: url }).catch(() => {})
          } else {
            execa('xclip', ['-selection', 'clipboard'], { input: url }).catch(() =>
              execa('xsel', ['--clipboard', '--input'], { input: url }).catch(() => {})
            )
          }
        }).catch(() => {})
      }
    },
  })

  actions.push({
    id:       'pr.close',
    label:    'Close PR',
    hint:     'Close the focused pull request without merging',
    category: 'pr',
    context:  ['pr-list', 'pr-detail'],
    keys:     [],
    run:      (ctx) => {
      if (ctx.selectedItem?.number && ctx.repo) {
        onClose()
        return closePR(ctx.repo, ctx.selectedItem.number)
      }
    },
  })

  actions.push({
    id:       'pr.scope.cycle',
    label:    'Cycle PR Scope',
    hint:     'Cycle filter: all → own → reviewing',
    category: 'pr',
    context:  'pr-list',
    keys:     [],
    run:      (ctx) => {
      const scopes = ['all', 'own', 'reviewing']
      const cur = ctx.prScope || 'all'
      const next = scopes[(scopes.indexOf(cur) + 1) % scopes.length]
      onNavigate({ pane: 'prs', filter: next })
      onClose()
    },
  })

  // Goto by number
  actions.push({
    id:       'pr.goto',
    label:    'Go to PR #…',
    hint:     'Jump to a specific pull request by number',
    category: 'navigation',
    context:  'global',
    keys:     [],
    run:      (ctx) => {
      // The palette's Tab-complete fills in the action name; user appends number.
      // This run() is called with ctx.args from the palette.
      const num = parseInt(ctx._args, 10)
      if (!isNaN(num)) {
        onNavigate({ pane: 'prs', view: 'detail', itemNumber: num })
        onClose()
      }
    },
  })

  actions.push({
    id:       'issue.goto',
    label:    'Go to Issue #…',
    hint:     'Jump to a specific issue by number',
    category: 'navigation',
    context:  'global',
    keys:     [],
    run:      (ctx) => {
      const num = parseInt(ctx._args, 10)
      if (!isNaN(num)) {
        onNavigate({ pane: 'issues', view: 'detail', itemNumber: num })
        onClose()
      }
    },
  })

  return actions
}
