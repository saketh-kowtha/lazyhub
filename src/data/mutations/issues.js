/**
 * Declared writes for the Issues list (V2a, #597).
 * Close patches the row's state in the cached page at once (rolled back on failure); the view then
 * re-reads that one issue (`getIssueRow`, one call) to reconcile it. Create and the label/assignee
 * edit invalidate nothing themselves: the view re-reads the one issue it touched. No list refetch.
 * The issue DETAIL view's own writes belong to V2b.
 */

import { defineMutation, runMutation } from './core.js'
import { closeIssue, createIssue, editIssueMembers } from '../../executor.js'

/**
 * @param {string} repo
 * @param {unknown[]} listKey  the key `useGh(listIssuesPage, [repo, {...}])` reads under
 */
export function closeIssueMutation(repo, listKey) {
  return defineMutation({
    name: 'issues.close',
    run: (/** @type {number} */ number) => closeIssue(repo, number),
    label: number => `Closing #${number}`,
    success: (_r, number) => `Closed #${number}`,
    optimistic: number => [{
      key: listKey,
      update: (/** @type {any} */ prev) => (prev && Array.isArray(prev.items)
        ? { ...prev, items: prev.items.map((/** @type {any} */ i) => (i.number === number ? { ...i, state: 'CLOSED' } : i)) }
        : prev),
    }],
    invalidates: () => [],
  })
}

/** @param {string} repo */
export function createIssueMutation(repo) {
  return defineMutation({
    name: 'issues.create',
    run: (/** @type {{ title: string, body?: string }} */ values) => createIssue(repo, /** @type {any} */ ({ title: values.title, body: values.body })),
    label: 'Creating issue',
    success: 'Issue created',
    invalidates: () => [],
  })
}

const editMembersMutation = defineMutation({
  name: 'issues.editMembers',
  run: (repo, number, kind, change) => editIssueMembers(repo, number, kind, change),
  invalidates: () => [],
})

/**
 * Add/remove labels or assignees on one issue. The caller re-reads that issue itself.
 * @param {string} repo
 * @param {number} number
 * @param {'labels' | 'assignees'} kind
 * @param {{ add: string[], remove: string[] }} change
 */
export function editIssueMembersDeclared(repo, number, kind, change) {
  return runMutation(editMembersMutation, [repo, number, kind, change])
}
