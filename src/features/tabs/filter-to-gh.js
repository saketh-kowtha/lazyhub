/**
 * features/tabs/filter-to-gh.js — translate TOML pane filters to executor args.
 */

const VALID = new Set([
  'author', 'reviewer', 'assignee', 'state', 'label', 'repo', 'search',
  'is_draft', 'has_changes_requested', 'merged_after', 'merged_before',
])

/**
 *
 * @param filter
 * @param root0
 * @param root0.limit
 */
export function filterToGh(filter = {}, { limit = 25 } = {}) {
  const warnings = []
  const out = { limit }
  for (const [key, value] of Object.entries(filter || {})) {
    if (!VALID.has(key)) {
      warnings.push(`unsupported filter key "${key}"`)
      continue
    }
    if (typeof value !== 'string' && typeof value !== 'boolean') {
      warnings.push(`filter "${key}" must be a string or boolean`)
      continue
    }
    if (key === 'is_draft') out.isDraft = value
    else if (key === 'has_changes_requested') out.hasChangesRequested = value
    else out[key] = value
  }
  return { filter: out, warnings }
}
