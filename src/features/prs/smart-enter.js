// @ts-check
/**
 * src/features/prs/smart-enter.js -- where Enter on a PR row goes (#314).
 *
 * One pure, deterministic rule, first match wins, for an OPEN PR only:
 *   1. CI is failing                      -> the failed check's log
 *   2. a review is requested of you       -> Files changed (the diff)
 *   3. the PR has merge conflicts         -> the conflict summary (Merge row of the detail)
 *   4. anything else                      -> Conversation (the plain detail view)
 * Closed and merged PRs always open the plain detail. The reason is returned so the UI can say it.
 *
 * "Review requested of you" is known exactly only in the `reviewing` scope (GitHub search
 * `review-requested:@me`); the list rows carry no viewer login, so other scopes never claim it.
 */

/** @typedef {'checks-log' | 'files' | 'conflict' | 'conversation'} SmartTarget */

/**
 * @param {{state?: string, isDraft?: boolean, mergeable?: string, checkSummary?: {failing?: number}, statusCheckRollup?: Array<{state?: string, conclusion?: string, status?: string}>} | null | undefined} pr  list row
 * @param {{scope?: string, enabled?: boolean}} [opts]
 * @returns {{target: SmartTarget, reason: string}}
 */
export function smartEnterTarget(pr, opts = {}) {
  /** @type {{target: SmartTarget, reason: string}} */
  const plain = { target: 'conversation', reason: '' }
  if (!pr || opts.enabled === false || String(pr.state || 'OPEN').toUpperCase() !== 'OPEN') return plain

  const rollup = Array.isArray(pr.statusCheckRollup) ? pr.statusCheckRollup : []
  const failing = pr.checkSummary?.failing
    ?? rollup.filter(c => /failure|error/i.test(c.conclusion || c.state || c.status || '')).length
  if (failing > 0) {
    return { target: 'checks-log', reason: `CI failing (${failing} check${failing === 1 ? '' : 's'}): opened the failed check log` }
  }
  if (opts.scope === 'reviewing' && !pr.isDraft) {
    return { target: 'files', reason: 'review requested of you: opened Files changed' }
  }
  if (pr.mergeable === 'CONFLICTING') {
    return { target: 'conflict', reason: 'merge conflicts: opened the conflict summary' }
  }
  return plain
}
