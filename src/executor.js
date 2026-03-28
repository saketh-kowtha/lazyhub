/**
 * executor.js — the ONLY place `gh` CLI is invoked in lazyhub.
 * All calls go through run(args), which handles JSON parsing and error typing.
 */

import { execa } from 'execa'

// ─── GhError ─────────────────────────────────────────────────────────────────

export class GhError extends Error {
  constructor({ message, stderr, exitCode, args }) {
    super(message)
    this.name = 'GhError'
    this.stderr = stderr
    this.exitCode = exitCode
    this.args = args
  }
}

// ─── Internal run() helper ───────────────────────────────────────────────────

/**
 * run(args) — executes `gh` with the given args.
 * On exit code 0: parses stdout as JSON and returns.
 * On non-zero: throws GhError.
 * If stdout is not JSON (e.g. plain text diff), returns raw stdout string.
 */
export async function run(args) {
  // GHE support: prepend --hostname when GH_HOST is set
  const fullArgs = process.env.GH_HOST
    ? ['--hostname', process.env.GH_HOST, ...args]
    : args

  let result
  try {
    result = await execa('gh', fullArgs, { reject: false })
  } catch (err) {
    throw new GhError({
      message: err.message,
      stderr: err.stderr || '',
      exitCode: err.exitCode ?? 1,
      args,
    })
  }

  if (result.exitCode !== 0) {
    const stderr = result.stderr || ''
    let message = `gh ${args.slice(0, 3).join(' ')} failed`

    if (stderr.includes('rate limit')) {
      message = 'GitHub API rate limit exceeded'
    } else if (result.exitCode === 404 || stderr.includes('not found') || stderr.includes('Could not resolve')) {
      message = 'Resource not found'
    } else if (stderr) {
      // Basic sanitization of stderr to prevent leaking potentially sensitive data in error messages
      message = stderr.split('\n')[0].trim().replace(/[a-zA-Z0-9_-]{20,}/g, '[REDACTED]')
    }

    throw new GhError({
      message,
      stderr: stderr.replace(/[a-zA-Z0-9_-]{20,}/g, '[REDACTED]'),
      exitCode: result.exitCode,
      args: args.map(arg => typeof arg === 'string' ? arg.replace(/[a-zA-Z0-9_-]{40,}/g, '[REDACTED]') : arg),
    })
  }

  const stdout = result.stdout?.trim()
  if (!stdout) return null

  try {
    return JSON.parse(stdout)
  } catch {
    // Not JSON — return raw string (e.g. diff output)
    return stdout
  }
}

// ─── Helper: get current repo from env ───────────────────────────────────────

function getRepo(overrideRepo) {
  return overrideRepo || process.env.GHUI_REPO
}

// ─── PR functions ─────────────────────────────────────────────────────────────

/**
 * List pull requests for a repo with optional filters.
 */
export async function listPRs(repo, filter = {}) {
  const args = [
    'pr', 'list',
    '--repo', getRepo(repo),
    '--json', 'number,title,state,author,labels,reviewRequests,statusCheckRollup,updatedAt,isDraft,headRefName,assignees,body',
    '--limit', String(filter.limit || 50),
  ]
  if (filter.state)  args.push('--state',    filter.state)
  if (filter.author) args.push('--author',   filter.author)
  if (filter.label)  args.push('--label',    filter.label)
  if (filter.assignee) args.push('--assignee', filter.assignee)
  // scope: 'own' → @me author, 'reviewing' → review-requested
  if (!filter.author) {
    if (filter.scope === 'own')       args.push('--author', '@me')
    if (filter.scope === 'reviewing') args.push('--reviewer', '@me')
  }
  return run(args)
}

/**
 * Get a single PR by number.
 */
export async function getPR(repo, number) {
  const args = [
    'pr', 'view', String(number),
    '--repo', getRepo(repo),
    '--json', 'number,title,state,author,body,labels,reviewRequests,reviews,statusCheckRollup,updatedAt,isDraft,headRefName,baseRefName,assignees,files,additions,deletions,changedFiles,mergeStateStatus,mergeable,url',
  ]
  return run(args)
}

/**
 * Merge a PR.
 * strategy: 'merge' | 'squash' | 'rebase'
 */
export async function mergePR(repo, number, strategy = 'merge', commitMessage) {
  const args = [
    'pr', 'merge', String(number),
    '--repo', getRepo(repo),
    `--${strategy}`,
  ]
  if (commitMessage) args.push('--subject', commitMessage)
  return run(args)
}

/**
 * Close (not merge) a pull request.
 */
export async function closePR(repo, number) {
  const args = ['pr', 'close', String(number), '--repo', getRepo(repo)]
  return run(args)
}

/**
 * Create a PR review (approve or request-changes).
 */
export async function reviewPR(repo, number, event, body = '') {
  // event: 'approve' | 'request-changes' | 'comment'
  const args = [
    'pr', 'review', String(number),
    '--repo', getRepo(repo),
    `--${event}`,
  ]
  if (body) args.push('--body', body)
  return run(args)
}

// ─── Issue functions ──────────────────────────────────────────────────────────

/**
 * List issues with optional filters.
 */
export async function listIssues(repo, filter = {}) {
  const args = [
    'issue', 'list',
    '--repo', getRepo(repo),
    '--json', 'number,title,state,author,labels,assignees,updatedAt,body,milestone,comments',
    '--limit', String(filter.limit || 50),
  ]
  if (filter.state) args.push('--state', filter.state)
  if (filter.author) args.push('--author', filter.author)
  if (filter.label) args.push('--label', filter.label)
  if (filter.assignee) args.push('--assignee', filter.assignee)
  if (filter.milestone) args.push('--milestone', filter.milestone)
  return run(args)
}

/**
 * Get a single issue by number.
 */
export async function getIssue(repo, number) {
  const args = [
    'issue', 'view', String(number),
    '--repo', getRepo(repo),
    '--json', 'number,title,state,author,body,labels,assignees,updatedAt,milestone,comments,url',
  ]
  return run(args)
}

/**
 * Create a new issue.
 */
export async function createIssue(repo, { title, body, labels = [], assignees = [], milestone } = {}) {
  const args = [
    'issue', 'create',
    '--repo', getRepo(repo),
    '--title', title,
  ]
  args.push('--body', body || '')
  if (labels.length) args.push('--label', labels.join(','))
  if (assignees.length) args.push('--assignee', assignees.join(','))
  if (milestone) args.push('--milestone', milestone)
  return run(args)
}

/**
 * Close an issue.
 */
export async function closeIssue(repo, number) {
  const args = [
    'issue', 'close', String(number),
    '--repo', getRepo(repo),
  ]
  return run(args)
}

// ─── Label functions ──────────────────────────────────────────────────────────

/**
 * List all labels in a repo.
 */
export async function listLabels(repo) {
  const args = [
    'label', 'list',
    '--repo', getRepo(repo),
    '--json', 'name,color,description',
    '--limit', '100',
  ]
  return run(args)
}

/**
 * Add labels to a PR or issue.
 */
export async function addLabels(repo, number, labels, type = 'issue') {
  const args = [
    type === 'pr' ? 'pr' : 'issue',
    'edit', String(number),
    '--repo', getRepo(repo),
    '--add-label', labels.join(','),
  ]
  return run(args)
}

/**
 * Remove labels from a PR or issue.
 */
export async function removeLabels(repo, number, labels, type = 'issue') {
  const args = [
    type === 'pr' ? 'pr' : 'issue',
    'edit', String(number),
    '--repo', getRepo(repo),
    '--remove-label', labels.join(','),
  ]
  return run(args)
}

// ─── Collaborator / reviewer functions ───────────────────────────────────────

/**
 * List collaborators for a repo.
 */
export async function listCollaborators(repo) {
  const r = getRepo(repo)
  const args = [
    'api', `repos/${encodeURIComponent(r).replace('%2F', '/')}/collaborators`,
    '--jq', '[.[] | {login: .login, name: .name}]',
  ]
  return run(args)
}

/**
 * Request reviewers for a PR.
 */
export async function requestReviewers(repo, number, reviewers) {
  const args = [
    'pr', 'edit', String(number),
    '--repo', getRepo(repo),
    '--add-reviewer', reviewers.join(','),
  ]
  return run(args)
}

// ─── Branch functions ─────────────────────────────────────────────────────────

/**
 * List branches in a repo.
 */
export async function listBranches(repo) {
  const r = getRepo(repo)
  const args = [
    'api', `repos/${encodeURIComponent(r).replace('%2F', '/')}/branches`,
    '--jq', '[.[] | {name: .name, protected: .protected, commit: {sha: .commit.sha}}]',
  ]
  return run(args)
}

/**
 * Checkout a PR's branch.
 */
export async function checkoutBranch(repo, number) {
  const args = ['pr', 'checkout', String(number), '--repo', getRepo(repo)]
  return run(args)
}

/**
 * Delete a branch.
 */
export async function deleteBranch(repo, branchName) {
  const r = getRepo(repo)
  const args = [
    'api', `repos/${encodeURIComponent(r).replace('%2F', '/')}/git/refs/heads/${encodeURIComponent(branchName)}`,
    '--method', 'DELETE',
  ]
  return run(args)
}

// ─── Actions / runs functions ─────────────────────────────────────────────────

/**
 * List workflow runs.
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
  return run(args)
}

/**
 * Get logs for a workflow run.
 */
export async function getRunLogs(repo, runId) {
  const args = [
    'run', 'view', String(runId),
    '--repo', getRepo(repo),
    '--log',
  ]
  return run(args)
}

/**
 * Re-run a workflow run (failed jobs only).
 */
export async function rerunRun(repo, runId) {
  const args = [
    'run', 'rerun', String(runId),
    '--repo', getRepo(repo),
    '--failed-only',
  ]
  return run(args)
}

/**
 * Cancel a workflow run.
 */
export async function cancelRun(repo, runId) {
  const args = [
    'run', 'cancel', String(runId),
    '--repo', getRepo(repo),
  ]
  return run(args)
}

// ─── Release functions ────────────────────────────────────────────────────────

/**
 * List releases.
 */
export async function listReleases(repo) {
  const args = [
    'release', 'list',
    '--repo', getRepo(repo),
    '--json', 'name,tagName,isPrerelease,isDraft,publishedAt,url',
    '--limit', '20',
  ]
  return run(args)
}

// ─── Notification functions ───────────────────────────────────────────────────

/**
 * List notifications.
 */
export async function listNotifications(filter = {}) {
  const args = [
    'api', 'notifications',
    '--jq', '[.[] | {id: .id, unread: .unread, reason: .reason, subject: {title: .subject.title, type: .subject.type, url: .subject.url}, repository: {fullName: .repository.full_name, name: .repository.name}, updatedAt: .updated_at}]',
  ]
  if (filter.all) {
    args.push('-f', 'all=true')
  }
  return run(args)
}

/**
 * Mark a notification as read.
 */
export async function markNotificationRead(notificationId) {
  const args = [
    'api', `notifications/threads/${encodeURIComponent(notificationId)}`,
    '--method', 'PATCH',
  ]
  return run(args)
}

// ─── PR diff and comment functions ───────────────────────────────────────────

/**
 * Get the unified diff for a PR.
 */
export async function getPRDiff(repo, number) {
  const args = [
    'pr', 'diff', String(number),
    '--repo', getRepo(repo),
  ]
  return run(args)
}

/**
 * Add a general comment to a PR.
 */
export async function addPRComment(repo, number, body) {
  const args = [
    'pr', 'comment', String(number),
    '--repo', getRepo(repo),
    '--body', body,
  ]
  return run(args)
}

/**
 * Add a line-level review comment to a PR.
 */
export async function addPRLineComment(repo, number, { body, path, line, side = 'RIGHT', commitId }) {
  const r = getRepo(repo)
  const payload = JSON.stringify({ body, path, line, side, commit_id: commitId })
  const args = [
    'api', `repos/${encodeURIComponent(r).replace('%2F', '/')}/pulls/${encodeURIComponent(number)}/comments`,
    '--method', 'POST',
    '--input', '-',
  ]
  // We use gh api with --input - to read JSON from stdin
  const proc = execa('gh', args, { reject: false })
  proc.stdin.write(payload)
  proc.stdin.end()
  const result = await proc

  if (result.exitCode !== 0) {
    throw new GhError({
      message: (result.stderr?.split('\n')[0] || 'Failed to add line comment').replace(/[a-zA-Z0-9_-]{20,}/g, '[REDACTED]'),
      stderr: (result.stderr || '').replace(/[a-zA-Z0-9_-]{20,}/g, '[REDACTED]'),
      exitCode: result.exitCode,
      args: args.map(arg => typeof arg === 'string' ? arg.replace(/[a-zA-Z0-9_-]{40,}/g, '[REDACTED]') : arg),
    })
  }
  try {
    return JSON.parse(result.stdout)
  } catch {
    return result.stdout
  }
}

/**
 * List review comments on a PR.
 */
export async function listPRComments(repo, number) {
  const r = getRepo(repo)
  const args = [
    'api', `repos/${encodeURIComponent(r).replace('%2F', '/')}/pulls/${encodeURIComponent(number)}/comments`,
    '--jq', '[.[] | {id: .id, body: .body, path: .path, line: .line, originalLine: .original_line, side: .side, user: {login: .user.login}, createdAt: .created_at, inReplyToId: .in_reply_to_id, pullRequestReviewId: .pull_request_review_id}]',
  ]
  return run(args)
}

/**
 * Resolve (hide as resolved) a PR review thread.
 * Uses the GraphQL API via gh api graphql.
 */
export async function resolveThread(threadId) {
  const query = 'mutation($threadId: ID!) { resolveReviewThread(input: { threadId: $threadId }) { thread { id isResolved } } }'
  const args = [
    'api', 'graphql',
    '-f', `query=${query}`,
    '-f', `threadId=${threadId}`,
  ]
  return run(args)
}

/**
 * Get a single remote branch (returns null if not found).
 */
export async function getRemoteBranch(repo, branch) {
  if (!branch) return null
  try {
    const r = getRepo(repo)
    return await run(['api', `repos/${encodeURIComponent(r).replace('%2F', '/')}/branches/${encodeURIComponent(branch)}`])
  } catch {
    return null
  }
}

/**
 * Compare two refs: how many commits head is ahead/behind base on GitHub.
 * Returns { ahead_by, behind_by, commits: [{sha, commit:{message}}] } or null.
 */
export async function compareBranches(repo, base, head) {
  if (!base || !head) return null
  try {
    const r = getRepo(repo)
    return await run(['api', `repos/${encodeURIComponent(r).replace('%2F', '/')}/compare/${encodeURIComponent(base)}...${encodeURIComponent(head)}`])
  } catch {
    return null
  }
}

/**
 * Get local commits on `branch` not yet pushed to origin/branch.
 * Returns array of {sha, message} or null if origin/branch doesn't exist.
 */
export async function getUnpushedCommits(branch) {
  if (!branch) return []
  try {
    const result = await execa('git', [
      'log', `origin/${branch}..${branch}`,
      '--pretty=format:%h\t%s',
    ], { cwd: process.cwd(), reject: false })
    if (result.exitCode !== 0) return null  // remote tracking branch absent
    if (!result.stdout.trim()) return []
    return result.stdout.trim().split('\n').map(line => {
      const tab = line.indexOf('\t')
      return { sha: line.slice(0, tab), message: line.slice(tab + 1) }
    })
  } catch {
    return null
  }
}

/**
 * Get the current local git branch name.
 */
export async function getCurrentBranch() {
  try {
    const result = await execa('git', ['branch', '--show-current'], { cwd: process.cwd() })
    return result.stdout.trim() || null
  } catch {
    return null
  }
}

/**
 * Push a branch to origin.
 */
export async function pushBranch(branch) {
  const result = await execa('git', ['push', 'origin', branch], {
    cwd: process.cwd(),
    reject: false,
  })
  if (result.exitCode !== 0) {
    throw new Error((result.stderr || 'git push failed').split('\n')[0].trim())
  }
  return result.stdout
}

/**
 * Create a new PR.
 */
export async function createPR(repo, { title, body, head, base, draft = false, labels = [], assignees = [], reviewers = [] } = {}) {
  const args = [
    'pr', 'create',
    '--repo', getRepo(repo),
    '--title', title,
    '--head', head,
    '--base', base,
    '--body', body || '',
  ]
  if (draft) args.push('--draft')
  if (labels.length) args.push('--label', labels.join(','))
  if (assignees.length) args.push('--assignee', assignees.join(','))
  if (reviewers.length) args.push('--reviewer', reviewers.join(','))
  return run(args)
}

// ─── Repo info / branch protection functions ─────────────────────────────────

/**
 * Get basic repo info including allowed merge methods.
 */
export async function getRepoInfo(repo) {
  const args = [
    'repo', 'view', getRepo(repo),
    '--json', 'name,owner,defaultBranchRef,squashMergeAllowed,mergeCommitAllowed,rebaseMergeAllowed,autoMergeAllowed,deleteBranchOnMerge',
  ]
  return run(args)
}

/**
 * Get check runs / status checks for a PR.
 */
export async function getPRChecks(repo, number) {
  const r = getRepo(repo)
  // Use the PR view to get the head SHA first, then fetch checks
  try {
    const pr = await run([
      'pr', 'view', String(number),
      '--repo', r,
      '--json', 'headRefOid',
    ])
    if (!pr?.headRefOid) return []
    const checkArgs = [
      'api', `repos/${encodeURIComponent(r).replace('%2F', '/')}/commits/${encodeURIComponent(pr.headRefOid)}/check-runs`,
      '--jq', '[.check_runs[] | {id: .id, name: .name, status: .status, conclusion: .conclusion, appName: .app.name, url: .html_url}]',
    ]
    return run(checkArgs)
  } catch {
    return []
  }
}

/**
 * Get branch protection rules for a branch.
 */
export async function getBranchProtection(repo, branch) {
  if (!branch) return null
  const r = getRepo(repo)
  const args = [
    'api', `repos/${encodeURIComponent(r).replace('%2F', '/')}/branches/${encodeURIComponent(branch)}/protection`,
    '--jq', '{requiredReviews: (.required_pull_request_reviews.required_approving_review_count // 0), requireCodeOwnerReviews: (.required_pull_request_reviews.require_code_owner_reviews // false), requireStatusChecks: (.required_status_checks != null), requiredChecks: ([(.required_status_checks.contexts // []), (.required_status_checks.checks // [] | map(.context))] | add // [])}',
  ]
  try {
    return run(args)
  } catch {
    return null
  }
}

/**
 * Enable auto-merge on a PR.
 */
export async function enableAutoMerge(repo, number, mergeMethod = 'merge') {
  const args = [
    'pr', 'merge', String(number),
    '--repo', getRepo(repo),
    `--${mergeMethod}`,
    '--auto',
  ]
  return run(args)
}

/**
 * Disable auto-merge on a PR.
 */
export async function disableAutoMerge(repo, number) {
  const r = getRepo(repo)
  const args = [
    'api', `repos/${encodeURIComponent(r).replace('%2F', '/')}/pulls/${encodeURIComponent(number)}`,
    '--method', 'PATCH',
    '-f', 'auto_merge=',
  ]
  return run(args)
}

/**
 * Get diff stats (additions/deletions/changedFiles) for a PR.
 */
export async function getPRDiffStats(repo, number) {
  const args = [
    'pr', 'view', String(number),
    '--repo', getRepo(repo),
    '--json', 'additions,deletions,changedFiles',
  ]
  return run(args)
}

// ─── Gist functions ───────────────────────────────────────────────────────────

/**
 * List the authenticated user's gists.
 */
export async function listGists() {
  return run(['gist', 'list', '--json', 'id,description,public,updatedAt,files', '--limit', '30'])
}

/**
 * View raw content of a gist.
 */
export async function getGist(id) {
  return run(['gist', 'view', id, '--raw'])
}

/**
 * Create a new gist via the GitHub API.
 * files: { filename: content }
 */
export async function createGist(description, files, isPublic = false) {
  const payload = { description, public: isPublic, files: {} }
  Object.entries(files).forEach(([name, content]) => { payload.files[name] = { content } })

  const gheArgs = process.env.GH_HOST ? ['--hostname', process.env.GH_HOST] : []
  const proc = execa('gh', [...gheArgs, 'api', 'gists', '--method', 'POST', '--input', '-'], { reject: false })
  proc.stdin.write(JSON.stringify(payload))
  proc.stdin.end()
  const result = await proc

  if (result.exitCode !== 0) {
    throw new GhError({
      message: result.stderr?.split('\n')[0] || 'gist create failed',
      stderr: result.stderr || '',
      exitCode: result.exitCode,
      args: ['gist', 'create'],
    })
  }
  try { return JSON.parse(result.stdout) } catch { return result.stdout }
}

/**
 * Delete a gist by ID.
 */
export async function deleteGist(id) {
  return run(['gist', 'delete', id, '--yes'])
}
