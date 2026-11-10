import { getRepo, repoPath, runGh } from './core.js'
import { encodeRefPath } from './branches.js'

/**
 * List workflow runs.
 * @param repo
 * @param filter
 */
export async function listRuns(/** @type {any} */ repo, /** @type {Record<string, any>} */ filter = {}) {
  const args = [
    'run', 'list',
    '--repo', getRepo(repo),
    '--json', 'databaseId,name,status,conclusion,workflowName,headBranch,event,createdAt,updatedAt,url',
    '--limit', '30',
  ]
  if (filter.workflow) args.push('--workflow', filter.workflow)
  if (filter.branch) args.push('--branch', filter.branch)
  if (filter.status) args.push('--status', filter.status)
  return runGh(args)
}

/**
 * Get logs for a workflow run.
 * @param repo
 * @param runId
 * @param attempt  re-run attempt (1-based); only attempts after the first are named, so the first
 *                 attempt keeps the plain command and a log read is pinned to the attempt it was keyed by
 */
export async function getRunLogs(/** @type {any} */ repo, /** @type {any} */ runId, /** @type {any} */ attempt = null) {
  const args = [
    'run', 'view', String(runId),
    '--repo', getRepo(repo),
    '--log',
    ...(Number.isInteger(attempt) && attempt > 1 ? ['--attempt', String(attempt)] : []),
  ]
  return runGh(args)
}

/**
 * Re-run a workflow run (failed jobs only).
 * @param repo
 * @param runId
 */
export async function rerunRun(/** @type {any} */ repo, /** @type {any} */ runId) {
  const args = [
    'run', 'rerun', String(runId),
    '--repo', getRepo(repo),
    '--failed-only',
  ]
  return runGh(args)
}

/**
 * Cancel a workflow run.
 * @param repo
 * @param runId
 */
export async function cancelRun(/** @type {any} */ repo, /** @type {any} */ runId) {
  const args = [
    'run', 'cancel', String(runId),
    '--repo', getRepo(repo),
  ]
  return runGh(args)
}

// ─── Notification functions ───────────────────────────────────────────────────

const CHECK_PAGE_SIZE = 100
// 2,000 check runs on one commit is far past anything real; the ceiling only bounds a runaway walk.
const CHECK_MAX_PAGES = 20

/**
 * Get check runs / status checks for a PR. Pages through every check-run page by hand
 * (no gh version floor). When the page ceiling is hit, or a later page fails, the checks
 * already fetched are kept and a trailing "incomplete" row is added, so CI never looks
 * empty or complete when it is not. The array also carries `truncated` / `error`.
 * @param repo
 * @param number
 * @returns {Promise<any>}
 */
export async function getPRChecks(/** @type {any} */ repo, /** @type {any} */ number) {
  const r = getRepo(repo)
  // Use the PR view to get the head SHA first, then fetch checks
  let pr
  try {
    pr = await runGh(['pr', 'view', String(number), '--repo', r, '--json', 'headRefOid'])
  } catch {
    return []
  }
  if (!pr?.headRefOid) return []
  const base = `repos/${repoPath(r)}/commits/${encodeURIComponent(pr.headRefOid)}/check-runs`
  const jq = '[.check_runs[] | {id: .id, name: .name, status: .status, conclusion: .conclusion, appName: .app.name, url: .html_url, startedAt: .started_at, completedAt: .completed_at}]'
  const checks = []
  let truncated = false
  let error = null
  for (let page = 1; ; page++) {
    let rows
    try {
      rows = await runGh(['api', `${base}?per_page=${CHECK_PAGE_SIZE}&page=${page}`, '--jq', jq])
    } catch (err) {
      // Nothing fetched yet: keep the long-standing "no checks" fallback. Otherwise keep the pages we have.
      if (page === 1) return []
      error = err
      break
    }
    const list = Array.isArray(rows) ? rows : []
    checks.push(...list)
    if (list.length < CHECK_PAGE_SIZE) break
    if (page >= CHECK_MAX_PAGES) { truncated = true; break }
  }
  if (truncated || error) {
    const why = error ? `a page failed: ${String(error.message || error).split('\n')[0].slice(0, 60)}` : `page limit ${CHECK_MAX_PAGES * CHECK_PAGE_SIZE}`
    checks.push({ name: `⚠ checks incomplete (${why})`, status: 'incomplete' })
  }
  return Object.assign(checks, { truncated, error: error ? String(error.message || error) : null })
}

/**
 * Re-run a specific check run via its check run ID.
 * @param repo
 * @param checkRunId
 */
export async function rerunCheckRun(/** @type {any} */ repo, /** @type {any} */ checkRunId) {
  const r = getRepo(repo)
  return runGh([
    'api', `repos/${repoPath(r)}/check-runs/${checkRunId}/rerequest`,
    '--method', 'POST',
  ])
}

/**
 * Get annotations for a check run (errors/warnings with file/line info).
 * @param repo
 * @param checkRunId
 */
export async function getCheckRunAnnotations(/** @type {any} */ repo, /** @type {any} */ checkRunId) {
  const r = getRepo(repo)
  try {
    return await runGh([
      'api', `repos/${repoPath(r)}/check-runs/${checkRunId}/annotations`,
      '--jq', '[.[] | {path: .path, line: .start_line, level: .annotation_level, message: .message, title: .title}]',
    ])
  } catch {
    return []
  }
}

/**
 * Get branch protection rules for a branch.
 * @param repo
 * @param branch
 */
export async function getBranchProtection(/** @type {any} */ repo, /** @type {any} */ branch) {
  if (!branch) return null
  const r = getRepo(repo)
  const args = [
    'api', `repos/${repoPath(r)}/branches/${encodeRefPath(branch)}/protection`,
    '--jq', '{requiredReviews: (.required_pull_request_reviews.required_approving_review_count // 0), requireCodeOwnerReviews: (.required_pull_request_reviews.require_code_owner_reviews // false), requireStatusChecks: (.required_status_checks != null), requiredChecks: ([(.required_status_checks.contexts // []), (.required_status_checks.checks // [] | map(.context))] | add // [])}',
  ]
  try {
    return await runGh(args)
  } catch {
    return null
  }
}
