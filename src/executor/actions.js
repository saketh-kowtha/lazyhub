import { getRepo, runGh } from './core.js'

/**
 * List workflow runs.
 * @param repo
 * @param filter
 */
export async function listRuns(repo, filter = {}) {
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
 */
export async function getRunLogs(repo, runId) {
  const args = [
    'run', 'view', String(runId),
    '--repo', getRepo(repo),
    '--log',
  ]
  return runGh(args)
}

/**
 * Re-run a workflow run (failed jobs only).
 * @param repo
 * @param runId
 */
export async function rerunRun(repo, runId) {
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
export async function cancelRun(repo, runId) {
  const args = [
    'run', 'cancel', String(runId),
    '--repo', getRepo(repo),
  ]
  return runGh(args)
}

// ─── Release functions ────────────────────────────────────────────────────────

/**
 * List releases.
 * @param repo
 */
export async function listReleases(repo) {
  const args = [
    'release', 'list',
    '--repo', getRepo(repo),
    '--json', 'name,tagName,isPrerelease,isDraft,publishedAt,url',
    '--limit', '20',
  ]
  return runGh(args)
}

// ─── Notification functions ───────────────────────────────────────────────────

/**
 * Get check runs / status checks for a PR.
 * @param repo
 * @param number
 */
export async function getPRChecks(repo, number) {
  const r = getRepo(repo)
  // Use the PR view to get the head SHA first, then fetch checks
  try {
    const pr = await runGh([
      'pr', 'view', String(number),
      '--repo', r,
      '--json', 'headRefOid',
    ])
    if (!pr?.headRefOid) return []
    const checkArgs = [
      'api', `repos/${encodeURIComponent(r).replace('%2F', '/')}/commits/${encodeURIComponent(pr.headRefOid)}/check-runs`,
      '--jq', '[.check_runs[] | {id: .id, name: .name, status: .status, conclusion: .conclusion, appName: .app.name, url: .html_url}]',
    ]
    return runGh(checkArgs)
  } catch {
    return []
  }
}

/**
 * Re-run a specific check run via its check run ID.
 * @param repo
 * @param checkRunId
 */
export async function rerunCheckRun(repo, checkRunId) {
  const r = getRepo(repo)
  return runGh([
    'api', `repos/${encodeURIComponent(r).replace('%2F', '/')}/check-runs/${checkRunId}/rerequest`,
    '--method', 'POST',
  ])
}

/**
 * Get annotations for a check run (errors/warnings with file/line info).
 * @param repo
 * @param checkRunId
 */
export async function getCheckRunAnnotations(repo, checkRunId) {
  const r = getRepo(repo)
  try {
    return await runGh([
      'api', `repos/${encodeURIComponent(r).replace('%2F', '/')}/check-runs/${checkRunId}/annotations`,
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
export async function getBranchProtection(repo, branch) {
  if (!branch) return null
  const r = getRepo(repo)
  const args = [
    'api', `repos/${encodeURIComponent(r).replace('%2F', '/')}/branches/${encodeURIComponent(branch)}/protection`,
    '--jq', '{requiredReviews: (.required_pull_request_reviews.required_approving_review_count // 0), requireCodeOwnerReviews: (.required_pull_request_reviews.require_code_owner_reviews // false), requireStatusChecks: (.required_status_checks != null), requiredChecks: ([(.required_status_checks.contexts // []), (.required_status_checks.checks // [] | map(.context))] | add // [])}',
  ]
  try {
    return runGh(args)
  } catch {
    return null
  }
}
