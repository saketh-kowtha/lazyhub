/**
 * src/features/prs/merge-methods.js — merge method wording, availability and default (#468).
 * Pure helpers shared by the PR list and PR detail merge flows.
 */

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
 * Index of the preferred method: squash when the repository allows it, otherwise the first allowed one.
 * @param {Array<{value: string}>} options  result of allowedMergeOptions
 */
export function preferredMergeIndex(options) {
  const squash = options.findIndex(o => o.value === 'squash')
  return squash >= 0 ? squash : 0
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
