// @ts-check
/**
 * src/features/prs/remembered-filter.js -- the PR list state filter, remembered per repository (#314).
 * Stored in [state] prFilters (owner/name -> ["open", "merged"]); read once when the list mounts.
 */

import { loadState, saveState } from '../../config.js'

const STATES = new Set(['open', 'closed', 'merged'])

/**
 * @param {string} [repo]  owner/name
 * @returns {string[] | null}  the states last shown in this repository, or null
 */
export function rememberedPRFilter(repo) {
  const saved = repo ? loadState().prFilters?.[repo] : undefined
  if (!Array.isArray(saved)) return null
  const states = saved.filter(s => typeof s === 'string' && STATES.has(s))
  return states.length ? states : null
}

/**
 * @param {string | undefined} repo  owner/name
 * @param {string[]} states
 */
export function rememberPRFilter(repo, states) {
  if (!repo) return
  const clean = [...new Set(states)].filter(s => STATES.has(s)).sort()
  if (!clean.length) return
  const previous = loadState().prFilters
  const same = Array.isArray(previous?.[repo]) && [...previous[repo]].sort().join() === clean.join()
  if (same) return
  saveState({ prFilters: { ...(previous && typeof previous === 'object' ? previous : {}), [repo]: clean } })
}
