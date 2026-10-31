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

const COMMENT_FIELDS = `
  databaseId
  body
  path
  line
  originalLine
  author { login }
  createdAt
  replyTo { databaseId }
  pullRequestReview { databaseId }
`
const THREAD_FIELDS = `
  id
  isResolved
  comments(first: 50) {
    totalCount
    pageInfo { hasNextPage endCursor }
    nodes { ${COMMENT_FIELDS} }
  }
`
// Hard stop for runaway loops (a malformed pageInfo that never ends). 200 pages is 10k+ items.
const MAX_PAGES = 200

function mapReviewComment(c, thread) {
  return {
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
  }
}

/**
 * Fetch the replies of a thread beyond its first 50, by cursor (#507). Returns every comment
 * node of the thread, first page included.
 * @param thread
 */
async function completeThreadComments(thread) {
  const nodes = [...(thread.comments?.nodes || [])]
  let info = thread.comments?.pageInfo
  const query = `
    query($id: ID!, $after: String) {
      node(id: $id) { ... on PullRequestReviewThread { comments(first: 50, after: $after) {
        pageInfo { hasNextPage endCursor }
        nodes { ${COMMENT_FIELDS} }
      } } }
    }
  `
  for (let i = 0; info?.hasNextPage && info.endCursor && i < MAX_PAGES; i++) {
    const res = await runGh(['api', 'graphql', '-f', `id=${thread.id}`, '-f', `after=${info.endCursor}`, '-f', `query=${query}`])
    const page = res?.data?.node?.comments
    nodes.push(...(page?.nodes || []))
    info = page?.pageInfo
  }
  return nodes
}

/**
 * One cursor page of review threads and/or PR conversation (issue) comments (#507).
 * Replies beyond a thread's first 50 are fetched by cursor so a thread is never cut short.
 * `threads: false` / `conversation: false` skip that half (load-more of one side only).
 * @param repo
 * @param number
 * @param root0
 * @param root0.threadsAfter  cursor for the next page of threads
 * @param root0.conversationAfter  cursor for the next page of conversation comments
 * @param root0.threads  include review threads (default true)
 * @param root0.conversation  include conversation comments (default true)
 * @param root0.pageSize
 */
export async function listPRTimelinePage(repo, number, {
  threadsAfter = null, conversationAfter = null, threads = true, conversation = true, pageSize = 50,
} = {}) {
  const r = getRepo(repo)
  const [owner, name] = r.split('/')
  assertRepoParts(r, owner, name)
  const query = `
    query($owner: String!, $name: String!, $number: Int!, $size: Int!, $tAfter: String, $cAfter: String, $withThreads: Boolean!, $withConversation: Boolean!) {
      repository(owner: $owner, name: $name) {
        pullRequest(number: $number) {
          reviewThreads(first: $size, after: $tAfter) @include(if: $withThreads) {
            totalCount
            pageInfo { hasNextPage endCursor }
            nodes { ${THREAD_FIELDS} }
          }
          comments(first: $size, after: $cAfter) @include(if: $withConversation) {
            totalCount
            pageInfo { hasNextPage endCursor }
            nodes { databaseId body author { login } createdAt }
          }
        }
      }
    }
  `
  const args = [
    'api', 'graphql',
    '-f', `owner=${owner}`,
    '-f', `name=${name}`,
    '-F', `number=${Number(number)}`,
    '-F', `size=${Number(pageSize)}`,
    '-F', `withThreads=${threads ? 'true' : 'false'}`,
    '-F', `withConversation=${conversation ? 'true' : 'false'}`,
  ]
  if (threadsAfter) args.push('-f', `tAfter=${threadsAfter}`)
  if (conversationAfter) args.push('-f', `cAfter=${conversationAfter}`)
  args.push('-f', `query=${query}`)
  const result = await runGh(args)
  const pr = result?.data?.repository?.pullRequest
  const tConn = pr?.reviewThreads
  const cConn = pr?.comments
  const reviewComments = []
  for (const thread of tConn?.nodes || []) {
    const nodes = await completeThreadComments(thread)
    for (const c of nodes) reviewComments.push(mapReviewComment(c, thread))
  }
  const conversationComments = (cConn?.nodes || []).map(c => ({
    id: c.databaseId,
    body: c.body,
    path: '',
    line: null,
    originalLine: null,
    side: null,
    user: { login: c.author?.login },
    createdAt: c.createdAt,
    inReplyToId: null,
    pullRequestReviewId: null,
    threadId: null,
    threadResolved: false,
    kind: 'conversation',
  }))
  const pageOf = (conn) => ({
    total: conn?.totalCount ?? (conn?.nodes?.length || 0),
    hasNextPage: !!conn?.pageInfo?.hasNextPage,
    endCursor: conn?.pageInfo?.endCursor || null,
  })
  return { comments: reviewComments, conversation: conversationComments, threads: pageOf(tConn), conversationPage: pageOf(cConn) }
}

/**
 * List every review comment on a PR (all threads, all replies, paged by cursor).
 * @param repo
 * @param number
 */
export async function listPRComments(repo, number) {
  const out = []
  let after = null
  for (let i = 0; i < MAX_PAGES; i++) {
    const page = await listPRTimelinePage(repo, number, { threadsAfter: after, conversation: false, pageSize: 100 })
    out.push(...page.comments)
    if (!page.threads.hasNextPage || !page.threads.endCursor) break
    after = page.threads.endCursor
  }
  return out
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
  const all = await listPRComments(repo, prNumber)
  return all.map(c => ({
    id: c.id,
    threadId: c.threadId,
    path: c.path,
    line: c.line ?? c.originalLine ?? null,
    body: c.body,
    user: c.user?.login || null,
    resolved: c.threadResolved,
  }))
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
