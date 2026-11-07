/**
 * src/features/prs/merge-methods.js — merge method wording, availability and default (#468).
 * Pure helpers shared by the PR list and PR detail merge flows.
 */

import { loadState, saveState } from '../../config.js'

export const MERGE_OPTIONS = [
  { value: 'merge',  label: 'Create a merge commit', description: 'All commits are kept and joined with a merge commit' },
  { value: 'squash', label: 'Squash and merge',      description: 'Combine all commits into one commit on the base branch' },
  { value: 'rebase', label: 'Rebase and merge',      description: 'Replay each commit onto the base branch' },
]

/** Administrator-only entries: merge although branch protection is not satisfied. */
export const ADMIN_MERGE_OPTIONS = MERGE_OPTIONS.map(o => ({
  value: `admin-${o.value}`,
  label: mergeMethodLabel(`admin-${o.value}`),
  description: `Administrator override: ${o.value} even though protection rules are not met`,
}))

/**
 * Human wording for a merge strategy value (never the raw CLI flag).
 * @param {string} strategy  'merge' | 'squash' | 'rebase' | 'admin-<method>'
 */
export function mergeMethodLabel(strategy) {
  const admin = String(strategy).startsWith('admin-')
  const base = admin ? String(strategy).slice('admin-'.length) : strategy
  const label = MERGE_OPTIONS.find(o => o.value === base)?.label ?? String(strategy)
  return admin ? `${label} (bypass branch protection)` : label
}

/**
 * Merge methods the repository allows; unknown repo info allows all of them.
 * @param {object} [repoInfo]  getRepoInfo result
 */
export function allowedMergeOptions(repoInfo) {
  const flag = { merge: 'mergeCommitAllowed', squash: 'squashMergeAllowed', rebase: 'rebaseMergeAllowed' }
  const allowed = MERGE_OPTIONS.filter(o => repoInfo?.[flag[o.value]] !== false)
  return allowed.length ? allowed : MERGE_OPTIONS
}

/**
 * Index of the method last used in this repository, or -1.
 * @param {Array<{value: string}>} options  picker options
 * @param {string} [repo]  owner/name
 */
export function rememberedMergeIndex(options, repo) {
  const last = repo ? loadState().mergeMethods?.[repo] : undefined
  return options.findIndex(o => o.value === last)
}

/**
 * Index of the preferred method: the one last used in this repository (#314) when it is still
 * allowed, otherwise squash when the repository allows it, otherwise the first allowed one.
 * @param {Array<{value: string}>} options  result of allowedMergeOptions
 * @param {string} [repo]  owner/name, to look up the remembered method
 */
export function preferredMergeIndex(options, repo) {
  const remembered = rememberedMergeIndex(options, repo)
  if (remembered >= 0) return remembered
  const squash = options.findIndex(o => o.value === 'squash')
  return squash >= 0 ? squash : 0
}

/**
 * Remember the merge method chosen for a repository, so the picker opens on it next time.
 * Bypass and auto-merge entries are never remembered: they must be chosen on purpose each time.
 * @param {string} repo  owner/name
 * @param {string} strategy  picker value
 */
export function rememberMergeMethod(repo, strategy) {
  if (!repo || !['merge', 'squash', 'rebase'].includes(strategy)) return
  const previous = loadState().mergeMethods
  if (previous?.[repo] === strategy) return
  saveState({ mergeMethods: { ...(previous && typeof previous === 'object' ? previous : {}), [repo]: strategy } })
}

/**
 * One-line merge readiness for the picker title: mergeability, CI and approvals.
 * @param {object} pr  getPR result
 * @param {Array} [checks]  getPRChecks result
 */
export function mergeStatusLine(pr, checks) {
  const state = String(pr?.mergeStateStatus || pr?.mergeable || 'UNKNOWN').toLowerCase().replace(/_/g, ' ')
  const list = Array.isArray(checks) ? checks : []
  const failing = list.filter(c => /failure|error|cancel|timed/i.test(c.conclusion || c.state || '')).length
  const pending = list.filter(c => !(c.conclusion || c.state) || /pending|queued|progress/i.test(c.status || c.conclusion || c.state || '')).length
  const ci = list.length === 0 ? 'no CI' : failing ? `CI ${failing} failing` : pending ? `CI ${pending} pending` : 'CI passing'
  const reviews = Array.isArray(pr?.reviews) ? pr.reviews : []
  const approvals = new Set(reviews.filter(r => r.state === 'APPROVED').map(r => r.author?.login)).size
  const changes = reviews.some(r => r.state === 'CHANGES_REQUESTED')
  return `${state} · ${ci} · ${changes ? 'changes requested' : `${approvals} approval${approvals === 1 ? '' : 's'}`}`
}
