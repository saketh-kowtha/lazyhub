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
 *
 * Key bindings are NOT defined here. They live in the TOML action table
 * (`[actions.*]` in defaultConfig.toml, rebindable through `[keymaps.*]`); this
 * module reads the effective bindings so the footer, `?` help, the palette and
 * the which-key popup all show what the keyboard really does (#312).
 */

import {
  mergePR,
  checkoutBranch,
  closePR,
  reviewPR,
} from '../executor.js'
import { getActionConfig } from '../config/actions.js'
import { sanitize } from '../utils.js'
import { actionScopeMatches, buildEffectiveActionKeys } from '../config/keymap.js'

// ─── Effective bindings (single source: TOML action table) ───────────────────

/**
 * Effective keys for a registry action id, after `[keymaps.*]` rebinds/unbinds.
 * @param {string} id registry action id (e.g. 'pr.approve')
 * @param {object} [config] effective config
 * @returns {string[]} key tokens, e.g. ['a'] or ['g p']
 */
export function boundKeys(id, config = getActionConfig()) {
  return effectiveKeys(config)[id] || []
}

// buildEffectiveActionKeys walks every action; key handlers call this per press.
const effectiveKeysCache = new WeakMap()
function effectiveKeys(config) {
  let keys = effectiveKeysCache.get(config)
  if (!keys) {
    keys = buildEffectiveActionKeys(config)
    effectiveKeysCache.set(config, keys)
  }
  return keys
}

/**
 * Keymap scopes live for a (pane, view) pair, most general first.
 * @param {string} pane pane id
 * @param {string} view 'list' | 'detail' | 'diff' | 'comments'
 * @returns {string[]} keymap scopes live in that context
 */
export function contextScopes(pane, view = 'list') {
  if (view === 'diff') return ['global', 'diff']
  if (view === 'comments') return ['global', 'pr-comments']
  if (view === 'detail') return ['global', pane === 'issues' ? 'issue-detail' : 'pr-detail']
  const listScope = {
    prs: 'pr-list', issues: 'issue-list', branches: 'branch-list',
    actions: 'workflow-list', notifications: 'notification-list',
  }[pane]
  return listScope ? ['global', listScope] : ['global']
}

// Preconditions that hide an action from footer/help when it cannot run. `ctx`
// is what the active view reports (onPaneState({ actionCtx })); a missing field
// means "unknown", which keeps the action visible.
const WHEN = {
  'pr.merge':            c => c.prOpen !== false,
  'pr.approve':          c => c.prOpen !== false,
  'pr.request-changes':  c => c.prOpen !== false,
  'pr.close':            c => c.prOpen !== false,
  'pr.reviewers':        c => c.prOpen !== false,
  'pr.draft':            c => c.prOpen !== false,
  'pr.base':             c => c.prOpen !== false,
  'pr.auto-merge':       c => c.prOpen !== false && c.isDraft !== true,
  'pr.checks':           c => c.hasChecks !== false,
  'diff.edit-comment':   c => c.lineHasThread !== false,
  'diff.delete-comment': c => c.lineHasThread !== false,
}

// Footer priority per scope: ids only. Keys and labels come from the registry.
const FOOTER_IDS = {
  'pr-list': ['cursor.down', 'pr.open-selected', 'pr.diff', 'pr.approve', 'pr.merge', 'pr.filter-cycle', 'list.search'],
  'issue-list': ['cursor.down', 'issue.open-selected', 'issue.new', 'issue.filter-cycle', 'list.search'],
  'branch-list': ['cursor.down', 'branch.checkout', 'branch.new', 'branch.delete', 'branch.push'],
  'workflow-list': ['cursor.down', 'workflow.logs', 'workflow.rerun', 'workflow.cancel'],
  'notification-list': ['cursor.down', 'notification.open', 'notification.mark-read', 'notification.mark-all'],
  'pr-detail': ['cursor.down', 'pr.diff', 'pr.checks', 'pr.approve', 'pr.merge', 'pr.comments', 'pr.open-browser', 'app.back'],
  'issue-detail': ['cursor.down', 'issue.reply', 'issue.labels', 'issue.assignees', 'issue.open-browser', 'app.back'],
  'diff': ['cursor.down', 'diff.next-file', 'diff.next-thread', 'diff.comment', 'diff.file-jump', 'diff.split', 'list.search', 'app.back'],
  global: ['cursor.down'],
  'pr-comments': ['cursor.down', 'comment.reply', 'comment.resolve', 'comment.jump', 'comment.filter', 'app.back'],
}

const FOOTER_GROUP = { nav: 1, meta: 3 }

// Shared 'list' verbs a full-screen view does not implement (kept out of its help).
const UNSUPPORTED = {
  'pr-comments': new Set(['list.search']),
  'issue-detail': new Set(['list.search']),
}

function visibleIn(id, ctx) {
  const when = WHEN[id]
  return !when || when(ctx || {})
}

function describeAction(id, config) {
  const action = config?.actions?.[id]
  const keys = boundKeys(id, config)
  if (!action || keys.length === 0) return null
  return { key: action.hint && keys.length > 1 ? action.hint : keys[0], label: action.label || id, group: action.group || '' }
}

/**
 * Footer hints for a context, generated from the registry. Actions whose
 * precondition fails, or that have no key, are left out. `?` is last.
 * @param {string} pane pane id
 * @param {string} view view id
 * @param {object} [ctx] view-reported state used by action preconditions
 * @param {object} [config] effective config
 * @returns {{key: string, label: string}[]} footer items
 */
export function contextFooterHints(pane, view, ctx = {}, config = getActionConfig()) {
  const scope = contextScopes(pane, view).at(-1)
  const isList = view === 'list'
  const ids = [
    ...(FOOTER_IDS[scope] || ['cursor.down']),
    ...(isList ? ['app.next-pane', 'list.refresh', 'app.settings'] : []),
  ]
  const seen = new Set()
  const hints = []
  for (const id of ids) {
    if (!visibleIn(id, ctx)) continue
    const hint = describeAction(id, config)
    if (!hint) continue
    const sig = `${hint.key}:${hint.label}`
    if (seen.has(sig)) continue
    seen.add(sig)
    // List footers are grouped: navigation | actions | meta (FooterKeys draws the separators).
    const item = { key: hint.key, label: hint.label }
    if (isList) item.group = FOOTER_GROUP[hint.group] ?? 2
    hints.push(item)
  }
  const help = describeAction('app.help', config)
  if (help) hints.push({ key: help.key, label: help.label })
  return hints
}

/**
 * Every key valid in a context (for the `?` overlay), generated from the registry.
 * @param {string} pane pane id
 * @param {string} view view id
 * @param {object} [ctx] view-reported state used by action preconditions
 * @param {object} [config] effective config
 * @returns {{key: string, label: string, group: string}[]} help rows
 */
export function contextHelpRows(pane, view, ctx = {}, config = getActionConfig()) {
  const scopes = contextScopes(pane, view).filter(s => s !== 'global')
  const rows = []
  const seen = new Set()
  for (const [id, action] of Object.entries(config?.actions || {})) {
    if (!scopes.some(s => actionScopeMatches(action.scope, s))) continue
    if (scopes.some(s => UNSUPPORTED[s]?.has(id))) continue
    if (!visibleIn(id, ctx)) continue
    const hint = describeAction(id, config)
    if (!hint) continue
    const sig = `${hint.key}:${hint.label}`
    if (seen.has(sig)) continue
    seen.add(sig)
    rows.push({ key: hint.key, label: action.description || hint.label, group: hint.group })
  }
  return rows
}

/**
 * Continuations of a prefix key (e.g. `g`) valid in a context, for the which-key popup.
 * @param {string} prefix prefix key
 * @param {string} pane pane id
 * @param {string} view view id
 * @param {object} [config] effective config
 * @returns {{key: string, label: string, actionId: string, global: boolean}[]} continuations
 */
export function prefixContinuations(prefix, pane, view, config = getActionConfig()) {
  const scopes = contextScopes(pane, view)
  const out = []
  for (const [id, action] of Object.entries(config?.actions || {})) {
    if (!scopes.some(s => actionScopeMatches(action.scope, s))) continue
    for (const token of boundKeys(id, config)) {
      const m = token.match(/^(\S) (\S)$/)
      if (m && m[1] === prefix) {
        out.push({ key: m[2], label: action.label || id, actionId: id, global: action.scope === 'global' })
      }
    }
  }
  if (boundKeys('cursor.top', config).includes(`${prefix}${prefix}`)) {
    out.unshift({ key: prefix, label: 'top of list', actionId: 'cursor.top', global: false })
  }
  return out
}

/**
 * Prefix keys in use by the registry (first half of any two-key `x y` binding).
 * @param {object} [config] effective config
 * @returns {Set<string>} prefix keys
 */
export function registeredPrefixes(config = getActionConfig()) {
  let prefixes = prefixCache.get(config)
  if (!prefixes) {
    prefixes = new Set()
    for (const id of Object.keys(config?.actions || {})) {
      for (const token of boundKeys(id, config)) {
        const m = token.match(/^(\S) \S$/)
        if (m) prefixes.add(m[1])
      }
    }
    prefixCache.set(config, prefixes)
  }
  return prefixes
}

const prefixCache = new WeakMap()

// ─── Recent use (session scope) ──────────────────────────────────────────────

const recentUse = new Map()
let useCounter = 0

/**
 * Remember that an action ran, so the palette ranks it higher next time.
 * @param {string} id action id
 */
export function recordActionUse(id) {
  recentUse.set(id, ++useCounter)
}

/** Forget recent use (tests). */
export function resetActionUse() {
  recentUse.clear()
  useCounter = 0
}

// Bonus 9 for the most recent action, one less per later action, floor 1.
function recencyBonus(id) {
  const at = recentUse.get(id)
  return at == null ? 0 : Math.max(1, 9 - (useCounter - at))
}

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
 * @param {number}   [limit=8] max results to return
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
      results.push({ ...action, _score: score + recencyBonus(action.id) })
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
    write:    true,
    confirmText: (ctx) => `Merge PR #${ctx.selectedItem?.number} using the default strategy?`,
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
    write:    true,
    confirmText: (ctx) => `Squash-merge PR #${ctx.selectedItem?.number}?`,
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
    write:    true,
    confirmText: (ctx) => `Rebase-merge PR #${ctx.selectedItem?.number}?`,
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
    write:    true,
    confirmText: (ctx) => `Approve PR #${ctx.selectedItem?.number}?`,
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
    write:    true,
    confirmText: (ctx) => `Request changes on PR #${ctx.selectedItem?.number}?`,
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
    write:    true,
    confirmText: (ctx) => `Check out the branch of PR #${ctx.selectedItem?.number} in the current directory?`,
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
    write:    true,
    confirmText: (ctx) => `Close PR #${ctx.selectedItem?.number} without merging?`,
    destructive: true,
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

  return actions.map(withRegistryKeys).map(guardWrite)
}

/**
 * Confirmation is a property of the action: every write-classified action
 * (`write: true`) needs the user's yes before it runs, whatever invoked it.
 * The palette asks via confirmationFor(); guardWrite() makes run() fail closed
 * for any caller that skipped the question.
 * @param {object} action palette action
 * @param {object} ctx run context ({ selectedItem, ... })
 * @returns {{ message: string, destructive: boolean }|null} null when no confirmation is needed
 */
export function confirmationFor(action, ctx = {}) {
  if (!action?.write) return null
  const title = ctx.selectedItem?.title ? ` (${sanitize(String(ctx.selectedItem.title))})` : ''
  const message = typeof action.confirmText === 'function' ? action.confirmText(ctx) : `${action.label}?`
  return { message: `${message}${title}`, destructive: !!action.destructive }
}

function guardWrite(action) {
  if (!action.write) return action
  const run = action.run
  return {
    ...action,
    run: (ctx = {}) => {
      if (ctx._confirmed !== true) throw new Error(`${action.label} needs confirmation`)
      return run(ctx)
    },
  }
}

// Palette ids that stand for a registry action under a different id.
const REGISTRY_ID = {
  'global.help': 'app.help',
  'global.refresh': 'list.refresh',
  'global.quit': 'app.back',
  'pr.open-diff': 'pr.diff',
  'pr.scope.cycle': 'pr.scope-cycle',
  'pane.prs': 'go.prs',
  'pane.issues': 'go.issues',
  'pane.branches': 'go.branches',
  'pane.actions': 'go.actions',
  'pane.notifications': 'go.notifications',
}

// Show the bindings the keyboard really has (rebinds included), not literals.
function withRegistryKeys(action) {
  const config = getActionConfig()
  const id = REGISTRY_ID[action.id] || action.id
  if (!config?.actions?.[id]) return action
  return { ...action, keys: boundKeys(id, config) }
}
