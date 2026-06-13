import { GhError } from './gh-error.js'
import { getRepo, runGh } from './core.js'

/**
 * List pull requests for a repo with optional filters.
 * @param repo
 * @param filter
 */
export async function listPRs(repo, filter = {}) {
  const base = [
    'pr', 'list',
    '--repo', getRepo(repo),
    '--limit', String(filter.limit || 50),
  ]
  if (filter.state)    base.push('--state',    filter.state)
  if (filter.author)   base.push('--author',   filter.author)
  if (filter.reviewer) base.push('--reviewer', filter.reviewer)
  if (filter.label)    base.push('--label',    filter.label)
  if (filter.assignee) base.push('--assignee', filter.assignee)
  if (!filter.author) {
    if (filter.scope === 'own')       base.push('--author',   '@me')
    if (filter.scope === 'reviewing') base.push('--reviewer', '@me')
  }

  // Try with all fields first; fall back to a reduced set for GHE instances
  // where statusCheckRollup / mergeable are not in the GraphQL schema.
  try {
    return await runGh([...base, '--json', 'number,title,state,author,labels,reviewRequests,statusCheckRollup,reviewDecision,updatedAt,isDraft,headRefName,baseRefName,assignees,body,mergeable,autoMergeRequest,url'])
  } catch (err) {
    if (!/unknown|field|not found/i.test(err.message)) throw err
    return runGh([...base, '--json', 'number,title,state,author,labels,reviewRequests,reviewDecision,updatedAt,isDraft,headRefName,baseRefName,assignees,body,url'])
  }
}

/**
 * Get a single PR by number.
 * @param repo
 * @param number
 */
export async function getPR(repo, number) {
  const args = [
    'pr', 'view', String(number),
    '--repo', getRepo(repo),
    '--json', 'number,title,state,author,body,labels,reviewRequests,reviews,statusCheckRollup,updatedAt,isDraft,headRefName,baseRefName,headRefOid,assignees,files,additions,deletions,changedFiles,mergeStateStatus,mergeable,autoMergeRequest,url',
  ]
  return runGh(args)
}

/**
 * Merge a PR.
 * strategy: 'merge' | 'squash' | 'rebase'
 * @param repo
 * @param number
 * @param strategy
 * @param commitMessage
 */
export async function mergePR(repo, number, strategy = 'merge', commitMessage) {
  const args = [
    'pr', 'merge', String(number),
    '--repo', getRepo(repo),
  ]
  // strategy may be 'admin-merge' | 'admin-squash' | 'admin-rebase' (admin + method)
  // or plain 'merge' | 'squash' | 'rebase'
  if (strategy.startsWith('admin-')) {
    args.push('--admin')
    args.push(`--${strategy.slice('admin-'.length)}`)
  } else {
    args.push(`--${strategy}`)
  }
  if (commitMessage) args.push('--subject', commitMessage)
  return runGh(args)
}

/**
 * Close (not merge) a pull request.
 * @param repo
 * @param number
 */
export async function closePR(repo, number) {
  const args = ['pr', 'close', String(number), '--repo', getRepo(repo)]
  return runGh(args)
}

/**
 * Mark a PR as ready for review (remove draft status).
 * @param repo
 * @param number
 */
export async function markPRReady(repo, number) {
  const args = ['pr', 'ready', String(number), '--repo', getRepo(repo)]
  return runGh(args)
}

/**
 * Convert an open PR to draft status.
 * @param repo
 * @param number
 */
export async function convertPRToDraft(repo, number) {
  const args = ['pr', 'ready', '--undo', String(number), '--repo', getRepo(repo)]
  return runGh(args)
}

/**
 * Change the base branch of a PR.
 * @param repo
 * @param number
 * @param newBase
 */
export async function editPRBase(repo, number, newBase) {
  const args = ['pr', 'edit', String(number), '--repo', getRepo(repo), '--base', newBase]
  return runGh(args)
}

/**
 * Create a PR review (approve or request-changes).
 * @param repo
 * @param number
 * @param event
 * @param body
 */
export async function reviewPR(repo, number, event, body = '') {
  // event: 'approve' | 'request-changes' | 'comment'
  const args = [
    'pr', 'review', String(number),
    '--repo', getRepo(repo),
    `--${event}`,
  ]
  if (body) args.push('--body', body)
  return runGh(args)
}

// ─── Issue functions ──────────────────────────────────────────────────────────

/**
 * Get the unified diff for a PR.
 * @param repo
 * @param number
 */
export async function getPRDiff(repo, number) {
  const args = [
    'pr', 'diff', String(number),
    '--repo', getRepo(repo),
  ]
  return runGh(args)
}

/**
 * Add a general comment to a PR.
 * @param repo
 * @param number
 * @param body
 */
export async function addPRComment(repo, number, body) {
  const args = [
    'pr', 'comment', String(number),
    '--repo', getRepo(repo),
    '--body', body,
  ]
  return runGh(args)
}

/**
 * Add assignees to a PR.
 * @param repo
 * @param number
 * @param assignees
 */
export async function addPRAssignees(repo, number, assignees) {
  const args = ['pr', 'edit', String(number), '--repo', getRepo(repo), '--add-assignee', assignees.join(',')]
  return runGh(args)
}

/**
 * Remove assignees from a PR.
 * @param repo
 * @param number
 * @param assignees
 */
export async function removePRAssignees(repo, number, assignees) {
  const args = ['pr', 'edit', String(number), '--repo', getRepo(repo), '--remove-assignee', assignees.join(',')]
  return runGh(args)
}

/**
 * Add a line-level review comment to a PR.
 * @param repo
 * @param number
 * @param root0
 * @param root0.body
 * @param root0.path
 * @param root0.line
 * @param root0.side
 * @param root0.commitId
 */
export async function addPRLineComment(repo, number, { body, path, line, side = 'RIGHT', commitId }) {
  const r = getRepo(repo)
  const payload = JSON.stringify({ body, path, line, side, commit_id: commitId })
  const args = [
    'api', `repos/${encodeURIComponent(r).replace('%2F', '/')}/pulls/${encodeURIComponent(number)}/comments`,
    '--method', 'POST',
    '--input', '-',
  ]
  // Routes through the runGh chokepoint; the JSON body is piped via stdin
  // (never argv) per the subprocess-discipline invariant.
  return runGh(args, { stdin: payload })
}

/**
 * List review comments on a PR.
 */
const REPO_PART_RE = /^[a-zA-Z0-9._-]+$/

/**
 *
 * @param repo
 * @param number
 */
export async function listPRComments(repo, number) {
  const r = getRepo(repo)
  const [owner, name] = r.split('/')
  if (!REPO_PART_RE.test(owner) || !REPO_PART_RE.test(name)) {
    throw new GhError({ message: `Invalid repository format: ${r}`, stderr: '', exitCode: 1, args: [] })
  }
  // Use GraphQL so we can get the ReviewThread node ID (needed for resolveReviewThread mutation)
  const query = `
    query($owner: String!, $name: String!, $number: Int!) {
      repository(owner: $owner, name: $name) {
        pullRequest(number: $number) {
          reviewThreads(first: 100) {
            nodes {
              id
              isResolved
              comments(first: 50) {
                nodes {
                  databaseId
                  body
                  path
                  line
                  originalLine
                  author { login }
                  createdAt
                  replyTo { databaseId }
                  pullRequestReview { databaseId }
                }
              }
            }
          }
        }
      }
    }
  `
  const result = await runGh([
    'api', 'graphql',
    '-f', `owner=${owner}`,
    '-f', `name=${name}`,
    '-F', `number=${number}`,
    '-f', `query=${query}`,
  ])
  const threads = result?.data?.repository?.pullRequest?.reviewThreads?.nodes || []
  return threads.flatMap(thread =>
    thread.comments.nodes.map(c => ({
      id: c.databaseId,
      body: c.body,
      path: c.path,
      line: c.line,
      originalLine: c.originalLine,
      side: 'RIGHT', // Default to RIGHT as diffSide is missing from schema
      user: { login: c.author?.login },
      createdAt: c.createdAt,
      inReplyToId: c.replyTo?.databaseId || null,
      pullRequestReviewId: c.pullRequestReview?.databaseId || null,
      threadId: thread.id,
      threadResolved: thread.isResolved,
    }))
  )
}

/**
 * Reply to an existing PR review comment thread.
 * Uses the dedicated replies endpoint — no path/line/commitId needed.
 * @param repo
 * @param prNumber
 * @param commentId
 * @param body
 */
export async function replyToComment(repo, prNumber, commentId, body) {
  const r = getRepo(repo)
  if (!Number.isInteger(Number(commentId)) || Number(commentId) <= 0) {
    throw new Error(`Invalid comment ID: ${commentId}`)
  }
  const args = [
    'api', `repos/${encodeURIComponent(r).replace('%2F', '/')}/pulls/${encodeURIComponent(prNumber)}/comments/${encodeURIComponent(commentId)}/replies`,
    '--method', 'POST',
    '--raw-field', `body=${body}`,
  ]
  return runGh(args)
}

/**
 * Edit (update) a PR review comment body.
 * @param repo
 * @param commentId
 * @param body
 */
export async function editPRComment(repo, commentId, body) {
  const r = getRepo(repo)
  if (!Number.isInteger(Number(commentId)) || Number(commentId) <= 0) {
    throw new Error(`Invalid comment ID: ${commentId}`)
  }
  const args = [
    'api', `repos/${encodeURIComponent(r).replace('%2F', '/')}/pulls/comments/${encodeURIComponent(commentId)}`,
    '--method', 'PATCH',
    '--raw-field', `body=${body}`,
  ]
  return runGh(args)
}

/**
 * Delete a PR review comment.
 * @param repo
 * @param commentId
 */
export async function deletePRComment(repo, commentId) {
  const r = getRepo(repo)
  if (!Number.isInteger(Number(commentId)) || Number(commentId) <= 0) {
    throw new Error(`Invalid comment ID: ${commentId}`)
  }
  const args = [
    'api', `repos/${encodeURIComponent(r).replace('%2F', '/')}/pulls/comments/${encodeURIComponent(commentId)}`,
    '--method', 'DELETE',
  ]
  return runGh(args)
}

/**
 * Resolve (hide as resolved) a PR review thread.
 * Uses the GraphQL API via gh api graphql.
 * @param threadId
 */
export async function resolveThread(threadId) {
  const query = 'mutation($threadId: ID!) { resolveReviewThread(input: { threadId: $threadId }) { thread { id isResolved } } }'
  const args = [
    'api', 'graphql',
    '-f', `query=${query}`,
    '-f', `threadId=${threadId}`,
  ]
  return runGh(args)
}

// ─── IPC-facing review functions (Phase 2) ───────────────────────────────────

/**
 * Get PR review comments shaped for the IPC `review-comments` response.
 * Uses GraphQL to retrieve thread node IDs and resolution status.
 *
 * @param {string} repo       - "owner/name" (falls back to GHUI_REPO)
 * @param {number|string} prNumber
 * @returns {Promise<Array<{id, threadId, path, line, body, user, resolved}>>}
 */
export async function getPRReviewComments(repo, prNumber) {
  const r = getRepo(repo)
  const [owner, name] = r.split('/')
  if (!REPO_PART_RE.test(owner) || !REPO_PART_RE.test(name)) {
    throw new GhError({ message: `Invalid repository format: ${r}`, stderr: '', exitCode: 1, args: [] })
  }
  const query = `
    query($owner: String!, $name: String!, $number: Int!) {
      repository(owner: $owner, name: $name) {
        pullRequest(number: $number) {
          reviewThreads(first: 100) {
            nodes {
              id
              isResolved
              comments(first: 50) {
                nodes {
                  databaseId
                  body
                  path
                  line
                  originalLine
                  author { login }
                }
              }
            }
          }
        }
      }
    }
  `
  const result = await runGh([
    'api', 'graphql',
    '-f', `owner=${owner}`,
    '-f', `name=${name}`,
    '-F', `number=${Number(prNumber)}`,
    '-f', `query=${query}`,
  ])
  const threads = result?.data?.repository?.pullRequest?.reviewThreads?.nodes || []
  // Flatten: one entry per comment, carrying threadId + resolved from the parent thread
  return threads.flatMap(thread =>
    thread.comments.nodes.map(c => ({
      id:       c.databaseId,
      threadId: thread.id,
      path:     c.path,
      line:     c.line ?? c.originalLine ?? null,
      body:     c.body,
      user:     c.author?.login || null,
      resolved: thread.isResolved,
    }))
  )
}

/**
 * Reply to a PR review thread via GraphQL `addPullRequestReviewThreadReply`.
 *
 * @param {string} threadId  - node ID of the review thread (e.g. "PRRT_...")
 * @param {string} body      - reply text
 * @returns {Promise<{ok: true, commentId: number}>}
 */
export async function addPRReviewThreadReply(threadId, body) {
  // threadId is a GraphQL node ID (ID!); body is a String!
  const mutation = 'mutation($threadId: ID!, $body: String!) { addPullRequestReviewThreadReply(input: { pullRequestReviewThreadId: $threadId, body: $body }) { comment { databaseId } } }'
  const result = await runGh([
    'api', 'graphql',
    '-f', `query=${mutation}`,
    '-f', `threadId=${threadId}`,
    '-f', `body=${body}`,
  ])
  const commentId = result?.data?.addPullRequestReviewThreadReply?.comment?.databaseId
  return { ok: true, commentId: commentId || null }
}

/**
 * Resolve a PR review thread via GraphQL `resolveReviewThread`.
 *
 * @param {string} threadId  - node ID of the review thread (e.g. "PRRT_...")
 * @returns {Promise<{ok: true}>}
 */
export async function resolvePRReviewThread(threadId) {
  const mutation = 'mutation($threadId: ID!) { resolveReviewThread(input: { threadId: $threadId }) { thread { id isResolved } } }'
  await runGh([
    'api', 'graphql',
    '-f', `query=${mutation}`,
    '-f', `threadId=${threadId}`,
  ])
  return { ok: true }
}

/**
 * Get basic repo info including allowed merge methods.
 * @param repo
 */
export async function getRepoInfo(repo) {
  const args = [
    'repo', 'view', getRepo(repo),
    '--json', 'name,owner,defaultBranchRef,squashMergeAllowed,mergeCommitAllowed,rebaseMergeAllowed,deleteBranchOnMerge,viewerPermission',
  ]
  return runGh(args)
}

/**
 * Enable auto-merge on a PR.
 * @param repo
 * @param number
 * @param mergeMethod
 */
export async function enableAutoMerge(repo, number, mergeMethod = 'merge') {
  const args = [
    'pr', 'merge', String(number),
    '--repo', getRepo(repo),
    `--${mergeMethod}`,
    '--auto',
  ]
  return runGh(args)
}

/**
 * Disable auto-merge on a PR.
 * @param repo
 * @param number
 */
export async function disableAutoMerge(repo, number) {
  const r = getRepo(repo)
  const args = [
    'api', `repos/${encodeURIComponent(r).replace('%2F', '/')}/pulls/${encodeURIComponent(number)}`,
    '--method', 'PATCH',
    '-f', 'auto_merge=',
  ]
  return runGh(args)
}

/**
 * Get diff stats (additions/deletions/changedFiles) for a PR.
 * @param repo
 * @param number
 */
export async function getPRDiffStats(repo, number) {
  const args = [
    'pr', 'view', String(number),
    '--repo', getRepo(repo),
    '--json', 'additions,deletions,changedFiles',
  ]
  return runGh(args)
}

// ─── Gist functions ───────────────────────────────────────────────────────────

/**
 * Create a new PR.
 * @param repo
 * @param root0
 * @param root0.title
 * @param root0.body
 * @param root0.head
 * @param root0.base
 * @param root0.draft
 * @param root0.labels
 * @param root0.assignees
 * @param root0.reviewers
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
  return runGh(args)
}

// ─── Repo info / branch protection functions ─────────────────────────────────
