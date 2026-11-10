/**
 * Declared writes for the Actions view (V2a, #597): rerun and cancel.
 * The run row shows its new state at once. The run list of that repo is the one call that carries the
 * run, so it is refetched (mounted queries only; one gh call); other repos, PRs and branches are untouched.
 */

import { defineMutation } from './core.js'
import { ghQueryKey } from '../ghKeys.js'
import { listRuns, rerunRun, cancelRun } from '../../executor.js'

/**
 * @param {unknown[]} listKey  the key the view's `useGh(listRuns, [repo, filter])` reads under
 * @param {number} databaseId
 * @param {Record<string, any>} fields  fields the row shows until the refetch lands
 */
const patchRun = (listKey, databaseId, fields) => ({
  key: listKey,
  update: (/** @type {any} */ prev) => (Array.isArray(prev) ? prev.map(r => (r.databaseId === databaseId ? { ...r, ...fields } : r)) : prev),
})

/**
 * Every cached `listRuns` read for this repo (any branch filter).
 * @param {string} repo
 */
const runsOfRepo = repo => ghQueryKey(listRuns, [repo])

/**
 * @param {string} repo
 * @param {unknown[]} listKey
 */
export function rerunRunMutation(repo, listKey) {
  return defineMutation({
    name: 'actions.rerun',
    run: (/** @type {any} */ run) => rerunRun(repo, run.databaseId),
    label: 'Re-running',
    success: 'Re-run triggered',
    optimistic: (run) => [patchRun(listKey, run.databaseId, { status: 'queued', conclusion: '' })],
    invalidates: () => [runsOfRepo(repo)],
  })
}

/**
 * @param {string} repo
 * @param {unknown[]} listKey
 */
export function cancelRunMutation(repo, listKey) {
  return defineMutation({
    name: 'actions.cancel',
    run: (/** @type {any} */ run) => cancelRun(repo, run.databaseId),
    label: 'Cancelling',
    success: 'Run cancelled',
    optimistic: (run) => [patchRun(listKey, run.databaseId, { status: 'cancelling' })],
    invalidates: () => [runsOfRepo(repo)],
  })
}
