/**
 * config.js — loads ~/.config/ghui/config.json
 *
 * Example config:
 * {
 *   "panes": ["prs", "issues", "actions"],
 *   "defaultPane": "prs"
 * }
 */

import { readFileSync, existsSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'

export const ALL_PANES = ['prs', 'issues', 'branches', 'actions', 'notifications']

export const CONFIG_PATH = join(homedir(), '.config', 'ghui', 'config.json')

const DEFAULTS = {
  panes: ALL_PANES,
  defaultPane: 'prs',
}

export function loadConfig() {
  if (!existsSync(CONFIG_PATH)) return { ...DEFAULTS }
  try {
    const user = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'))

    // Validate panes — only keep known values, always keep at least one
    const panes = Array.isArray(user.panes)
      ? user.panes.filter(p => ALL_PANES.includes(p))
      : DEFAULTS.panes
    if (panes.length === 0) panes.push('prs')

    const defaultPane = panes.includes(user.defaultPane)
      ? user.defaultPane
      : panes[0]

    return { panes, defaultPane }
  } catch {
    return { ...DEFAULTS }
  }
}
