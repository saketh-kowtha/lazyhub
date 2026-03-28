/**
 * config.js — loads ~/.config/ghui/config.json
 *
 * Full example:
 * {
 *   "panes": ["prs", "issues", "my-deploys"],
 *   "defaultPane": "prs",
 *   "theme": { "ui": { "selected": "#ff9900" } },
 *   "customPanes": {
 *     "my-deploys": {
 *       "label": "Deployments",
 *       "icon": "▶",
 *       "command": "gh api repos/{repo}/deployments --jq '[.[] | {title:.environment,number:.id,state:.task,updatedAt:.created_at,url:.url}]'",
 *       "actions": { "o": "open" }
 *     }
 *   }
 * }
 *
 * Built-in pane ids: prs, issues, branches, actions, notifications
 * Custom pane ids:   any string NOT matching a built-in id
 *
 * Command placeholders: {repo} = "owner/name", {owner}, {name}
 * Expected output: JSON array; recommended fields: title, number, state, updatedAt, url
 */

import { readFileSync, existsSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'

export const BUILTIN_PANES = ['prs', 'issues', 'branches', 'actions', 'notifications']
/** @deprecated use BUILTIN_PANES */
export const ALL_PANES = BUILTIN_PANES

export const CONFIG_PATH = join(homedir(), '.config', 'ghui', 'config.json')

const DEFAULTS = {
  panes: BUILTIN_PANES,
  defaultPane: 'prs',
  theme: {},
  customPanes: {},
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

export function loadConfig() {
  if (!existsSync(CONFIG_PATH)) return { ...DEFAULTS }
  try {
    const user = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'))

    // Parse custom panes first so we know all valid ids
    const customPanes = {}
    if (typeof user.customPanes === 'object' && !Array.isArray(user.customPanes)) {
      for (const [id, def] of Object.entries(user.customPanes)) {
        if (BUILTIN_PANES.includes(id)) continue  // can't shadow a built-in
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

    return { panes, defaultPane, theme, customPanes }
  } catch {
    return { ...DEFAULTS }
  }
}
