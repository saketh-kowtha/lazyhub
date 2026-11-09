/**
 * freshness.js — how long a cached read counts as fresh (V1, #597).
 *
 * Inside the window a mount, focus or back-navigation makes zero gh calls. Outside it the
 * cached data renders at once and revalidates in the background (never a blank frame).
 * `immutable` is for reads keyed by something that changes when the content changes (a head
 * SHA, a run attempt): they are fresh for as long as the key is unchanged. A view opts in
 * with `useGh(fn, deps, { freshness: 'immutable' })` only once its key carries that id;
 * `listPRFilesPage` is keyed by PR number alone today, so it stays on the 30 s window.
 */

export const FRESHNESS = Object.freeze({
  list: 30_000,
  detail: 30_000,
  conversation: 15_000,
  notifications: 15_000,
  immutable: Infinity,
})

/** @typedef {keyof typeof FRESHNESS} FreshnessClass */

/** @type {Record<string, FreshnessClass>} Default class by `gh` fetch function name. */
const BY_OP = {
  listPRTimelinePage: 'conversation',
  listIssueTimelinePage: 'conversation',
  listPRCommentsPage: 'conversation',
  listNotifications: 'notifications',
}

/**
 * The freshness window (ms) for a fetch function name; anything not listed is 30 s.
 * @param {string} op
 * @returns {number}
 */
export function freshnessForOp(op) {
  return FRESHNESS[BY_OP[op] ?? 'list']
}

/** Unused cache entries are kept at least this long before the lazy sweep may drop them. */
export const GC_MIN_UNUSED_MS = 5 * 60_000
