// @ts-nocheck
// TODO(#197): typed gh PR review payload shapes should replace broad JS destructuring.
import { GhError } from './gh-error.js'
import { getRepo, runGh } from './core.js'

const REPO_PART_RE = /^[a-zA-Z0-9._-]+$/

/**
 * Get the unified diff for a PR.
 * @param repo
 * @param number
 */
export async function getPRDiff(repo, number) {
  return runGh(['pr', 'diff', String(number), '--repo', getRepo(repo)])
}

/**
 * Add a general comment to a PR.
 * @param repo
 * @param number
 * @param body
 */
export async function addPRComment(repo, number, body) {
  return runGh(['pr', 'comment', String(number), '--repo', getRepo(repo), '--body', body])
}

/**
 * Add assignees to a PR.
 * @param repo
 * @param number
 * @param assignees
 */
export async function addPRAssignees(repo, number, assignees) {
  return runGh(['pr', 'edit', String(number), '--repo', getRepo(repo), '--add-assignee', assignees.join(',')])
}

/**
 * Remove assignees from a PR.
 * @param repo
 * @param number
 * @param assignees
 */
export async function removePRAssignees(repo, number, assignees) {
  return runGh(['pr', 'edit', String(number), '--repo', getRepo(repo), '--remove-assignee', assignees.join(',')])
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
  return runGh([
    'api', `repos/${encodeURIComponent(r).replace('%2F', '/')}/pulls/${encodeURIComponent(number)}/comments`,
    '--method', 'POST',
    '--input', '-',
  ], { stdin: payload })
}

/**
 * List review comments on a PR.
 * @param repo
 * @param number
 */
export async function listPRComments(repo, number) {
  const r = getRepo(repo)
  const [owner, name] = r.split('/')
  assertRepoParts(r, owner, name)
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
      side: 'RIGHT',
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
 * Reply to an existing PR review comment.
 * @param repo
 * @param prNumber
 * @param commentId
 * @param body
 */
export async function replyToComment(repo, prNumber, commentId, body) {
  const r = getRepo(repo)
  assertPositiveId(commentId)
  return runGh([
    'api', `repos/${encodeURIComponent(r).replace('%2F', '/')}/pulls/${encodeURIComponent(prNumber)}/comments/${encodeURIComponent(commentId)}/replies`,
    '--method', 'POST',
    '--raw-field', `body=${body}`,
  ])
}

/**
 * Edit a PR review comment body.
 * @param repo
 * @param commentId
 * @param body
 */
export async function editPRComment(repo, commentId, body) {
  const r = getRepo(repo)
  assertPositiveId(commentId)
  return runGh([
    'api', `repos/${encodeURIComponent(r).replace('%2F', '/')}/pulls/comments/${encodeURIComponent(commentId)}`,
    '--method', 'PATCH',
    '--raw-field', `body=${body}`,
  ])
}

/**
 * Delete a PR review comment.
 * @param repo
 * @param commentId
 */
export async function deletePRComment(repo, commentId) {
  const r = getRepo(repo)
  assertPositiveId(commentId)
  return runGh([
    'api', `repos/${encodeURIComponent(r).replace('%2F', '/')}/pulls/comments/${encodeURIComponent(commentId)}`,
    '--method', 'DELETE',
  ])
}

/**
 * Resolve a PR review thread.
 * @param threadId
 */
export async function resolveThread(threadId) {
  const query = 'mutation($threadId: ID!) { resolveReviewThread(input: { threadId: $threadId }) { thread { id isResolved } } }'
  return runGh(['api', 'graphql', '-f', `query=${query}`, '-f', `threadId=${threadId}`])
}

/**
 * Get PR review comments shaped for IPC.
 * @param repo
 * @param prNumber
 */
export async function getPRReviewComments(repo, prNumber) {
  const r = getRepo(repo)
  const [owner, name] = r.split('/')
  assertRepoParts(r, owner, name)
  const query = `
    query($owner: String!, $name: String!, $number: Int!) {
      repository(owner: $owner, name: $name) {
        pullRequest(number: $number) {
          reviewThreads(first: 100) {
            nodes {
              id
              isResolved
              comments(first: 50) {
                nodes { databaseId body path line originalLine author { login } }
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
  return threads.flatMap(thread =>
    thread.comments.nodes.map(c => ({
      id: c.databaseId,
      threadId: thread.id,
      path: c.path,
      line: c.line ?? c.originalLine ?? null,
      body: c.body,
      user: c.author?.login || null,
      resolved: thread.isResolved,
    }))
  )
}

/**
 * Reply to a PR review thread.
 * @param threadId
 * @param body
 */
export async function addPRReviewThreadReply(threadId, body) {
  const mutation = 'mutation($threadId: ID!, $body: String!) { addPullRequestReviewThreadReply(input: { pullRequestReviewThreadId: $threadId, body: $body }) { comment { databaseId } } }'
  const result = await runGh(['api', 'graphql', '-f', `query=${mutation}`, '-f', `threadId=${threadId}`, '-f', `body=${body}`])
  return { ok: true, commentId: result?.data?.addPullRequestReviewThreadReply?.comment?.databaseId || null }
}

/**
 * Resolve a PR review thread from IPC.
 * @param threadId
 */
export async function resolvePRReviewThread(threadId) {
  const mutation = 'mutation($threadId: ID!) { resolveReviewThread(input: { threadId: $threadId }) { thread { id isResolved } } }'
  await runGh(['api', 'graphql', '-f', `query=${mutation}`, '-f', `threadId=${threadId}`])
  return { ok: true }
}

function assertRepoParts(repo, owner, name) {
  if (!REPO_PART_RE.test(owner) || !REPO_PART_RE.test(name)) {
    throw new GhError({ message: `Invalid repository format: ${repo}`, stderr: '', exitCode: 1, args: [] })
  }
}

function assertPositiveId(id) {
  if (!Number.isInteger(Number(id)) || Number(id) <= 0) {
    throw new Error(`Invalid comment ID: ${id}`)
  }
}
