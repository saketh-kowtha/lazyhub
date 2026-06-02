/**
 * features/tabs/registry.js — TOML custom tab registry.
 */

import { loadConfig } from '../../config/loader.js'

const BUILTIN = new Set(['prs', 'issues', 'branches', 'actions', 'notifications'])

/**
 *
 * @param config
 */
export function getTabs(config = loadConfig()) {
  const warnings = []
  const seen = new Set()
  const tabs = []
  for (const tab of config.tabs || []) {
    if (!tab?.id) continue
    if (BUILTIN.has(tab.id)) {
      warnings.push(`custom tab "${tab.id}" collides with a built-in pane`)
      continue
    }
    if (seen.has(tab.id)) {
      warnings.push(`duplicate custom tab "${tab.id}" ignored`)
      continue
    }
    seen.add(tab.id)
    tabs.push({ ...tab, order: Number.isInteger(tab.order) ? tab.order : 999 })
  }
  tabs.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))
  return { tabs, warnings }
}
