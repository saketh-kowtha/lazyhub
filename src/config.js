/**
 * config.js — loads ~/.config/ghui/config.json
 *
 * Full example:
 * {
 *   "panes": ["prs", "issues", "branches", "actions", "notifications"],
 *   "defaultPane": "prs",
 *   "theme": { "ui": { "selected": "#ff9900" } },
 *   "customPanes": {
 *     "my-deploys": {
 *       "label": "Deployments",
 *       "icon": "▶",
 *       "command": "gh api repos/{repo}/deployments --jq '[.[] | {title:.environment,number:.id,state:.task,updatedAt:.created_at,url:.url}]'",
 *       "actions": { "o": "open" }
 *     }
 *   },
 *   "pr": {
 *     "defaultFilter": "open",
 *     "defaultScope": "all",
 *     "pageSize": 100,
 *     "keys": {
 *       "filterOpen":   "O",
 *       "filterClosed": "C",
 *       "filterMerged": "M"
 *     }
 *   },
 *   "issues": {
 *     "defaultFilter": "open",
 *     "pageSize": 50,
 *     "keys": {
 *       "filterOpen":   "O",
 *       "filterClosed": "C"
 *     }
 *   },
 *   "actions": {
 *     "pageSize": 30
 *   },
 *   "diff": {
 *     "defaultView": "unified",
 *     "syntaxHighlight": true,
 *     "maxLines": 2000
 *   }
 * }
 *
 * Built-in pane ids: prs, issues, branches, actions, notifications
 * Custom pane ids:   any string NOT matching a built-in id
 *
 * Command placeholders: {repo}, {owner}, {name}
 * Expected output: JSON array; recommended fields: title, number, state, updatedAt, url
 */

import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'fs'
import { join, dirname } from 'path'
import { homedir } from 'os'

export const BUILTIN_PANES = ['prs', 'issues', 'branches', 'actions', 'notifications']
/** @deprecated use BUILTIN_PANES */
export const ALL_PANES = BUILTIN_PANES

export const CONFIG_PATH = join(homedir(), '.config', 'ghui', 'config.json')

// ─── Section defaults ─────────────────────────────────────────────────────────

const DEFAULT_PR = {
  defaultFilter: 'open',   // 'open' | 'closed' | 'merged'
  defaultScope:  'all',    // 'all' | 'own' | 'reviewing'
  pageSize:      100,
  keys: {
    filterOpen:   'O',
    filterClosed: 'C',
    filterMerged: 'M',
  },
}

const DEFAULT_ISSUES = {
  defaultFilter: 'open',   // 'open' | 'closed'
  pageSize:      50,
  keys: {
    filterOpen:   'O',
    filterClosed: 'C',
  },
}

const DEFAULT_ACTIONS = {
  pageSize: 30,
}

const DEFAULT_DIFF = {
  defaultView:      'unified',  // 'unified' | 'split'
  syntaxHighlight:  true,
  maxLines:         2000,
}

const DEFAULTS = {
  panes:       BUILTIN_PANES,
  defaultPane: 'prs',
  theme:       {},
  customPanes: {},
  pr:          DEFAULT_PR,
  issues:      DEFAULT_ISSUES,
  actions:     DEFAULT_ACTIONS,
  diff:        DEFAULT_DIFF,
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function mergeSection(defaults, user) {
  if (!user || typeof user !== 'object' || Array.isArray(user)) return defaults
  const merged = { ...defaults }
  for (const [k, v] of Object.entries(user)) {
    if (k in defaults) {
      if (typeof defaults[k] === 'object' && !Array.isArray(defaults[k]) && typeof v === 'object' && !Array.isArray(v)) {
        merged[k] = { ...defaults[k], ...v }
      } else if (typeof v === typeof defaults[k]) {
        merged[k] = v
      }
    }
  }
  return merged
}

function validateCustomPane(id, def) {
  if (!def || typeof def !== 'object') return null
  if (!def.command || typeof def.command !== 'string') return null
  return {
    id,
    label:   typeof def.label === 'string' ? def.label : id,
    icon:    typeof def.icon  === 'string' ? def.icon  : '◈',
    command: def.command,
    actions: (typeof def.actions === 'object' && !Array.isArray(def.actions))
      ? def.actions : {},
  }
}

// ─── loadConfig ───────────────────────────────────────────────────────────────

export function loadConfig() {
  if (!existsSync(CONFIG_PATH)) return { ...DEFAULTS }
  try {
    const user = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'))

    // Custom panes
    const customPanes = {}
    if (typeof user.customPanes === 'object' && !Array.isArray(user.customPanes)) {
      for (const [id, def] of Object.entries(user.customPanes)) {
        if (BUILTIN_PANES.includes(id)) continue
        const valid = validateCustomPane(id, def)
        if (valid) customPanes[id] = valid
      }
    }

    const allKnown = [...BUILTIN_PANES, ...Object.keys(customPanes)]

    const panes = Array.isArray(user.panes)
      ? user.panes.filter(p => allKnown.includes(p))
      : BUILTIN_PANES
    if (panes.length === 0) panes.push('prs')

    const defaultPane = panes.includes(user.defaultPane) ? user.defaultPane : panes[0]

    const theme = (typeof user.theme === 'object' && !Array.isArray(user.theme))
      ? user.theme : {}

    return {
      panes,
      defaultPane,
      theme,
      customPanes,
      pr:      mergeSection(DEFAULT_PR,      user.pr),
      issues:  mergeSection(DEFAULT_ISSUES,  user.issues),
      actions: mergeSection(DEFAULT_ACTIONS, user.actions),
      diff:    mergeSection(DEFAULT_DIFF,    user.diff),
    }
  } catch {
    return { ...DEFAULTS }
  }
}

// ─── writeDefaultConfig — creates config file with comments if missing ────────

export function writeDefaultConfig() {
  if (existsSync(CONFIG_PATH)) return
  try {
    mkdirSync(dirname(CONFIG_PATH), { recursive: true })
    const template = {
      panes: BUILTIN_PANES,
      defaultPane: 'prs',
      pr: {
        defaultFilter: 'open',
        defaultScope: 'all',
        pageSize: 100,
        keys: { filterOpen: 'O', filterClosed: 'C', filterMerged: 'M' },
      },
      issues: {
        defaultFilter: 'open',
        pageSize: 50,
        keys: { filterOpen: 'O', filterClosed: 'C' },
      },
      actions: { pageSize: 30 },
      diff: { defaultView: 'unified', syntaxHighlight: true, maxLines: 2000 },
      theme: {},
      customPanes: {},
    }
    writeFileSync(CONFIG_PATH, JSON.stringify(template, null, 2) + '\n', 'utf8')
  } catch { /* non-fatal */ }
}
