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
 * Page info that never loops: a connection that claims a next page but returns the cursor we
 * just sent is reported as `stalled` (the caller shows "incomplete"), not retried forever.
 * @param conn
 * @param requestedAfter
 */
function pageOf(conn, requestedAfter = null) {
  const hasNext = !!conn?.pageInfo?.hasNextPage
  const endCursor = conn?.pageInfo?.endCursor || null
  const stalled = hasNext && (!endCursor || endCursor === requestedAfter)
  return {
    total: conn?.totalCount ?? (conn?.nodes?.length || 0),
    hasNextPage: hasNext && !stalled,
    endCursor,
    stalled,
  }
}

/**
 * The next page of replies of one review thread (#507). Used on demand, when the user reaches
 * a thread's "N more replies" row.
 * @param threadId
 * @param after  cursor returned by the previous page
 */
export async function listPRThreadReplies(threadId, after = null) {
  const query = `
    query($id: ID!, $after: String) {
      node(id: $id) { ... on PullRequestReviewThread {
        id
        isResolved
        comments(first: 50, after: $after) {
          totalCount
          pageInfo { hasNextPage endCursor }
          nodes { ${COMMENT_FIELDS} }
        }
      } }
    }
  `
  const args = ['api', 'graphql', '-f', `id=${threadId}`]
  if (after) args.push('-f', `after=${after}`)
  args.push('-f', `query=${query}`)
  const res = await runGh(args)
  const thread = res?.data?.node
  return {
    comments: (thread?.comments?.nodes || []).map(c => mapReviewComment(c, { id: threadId, isResolved: !!thread?.isResolved })),
    page: pageOf(thread?.comments, after),
  }
}

/**
 * One cursor page of review threads and/or PR conversation (issue) comments (#507).
 * Each thread carries its first 50 comments; a thread with more is listed in `partialThreads`
 * so the view can show "N more replies" and call `listPRThreadReplies` on demand. No per-thread
 * request is made here, so the first render never waits on them.
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
  const partialThreads = []
  for (const thread of tConn?.nodes || []) {
    for (const c of thread.comments?.nodes || []) reviewComments.push(mapReviewComment(c, thread))
    const info = pageOf(thread.comments)
    if (info.hasNextPage || info.stalled) {
      partialThreads.push({ threadId: thread.id, total: info.total, endCursor: info.endCursor, stalled: info.stalled })
    }
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
  return {
    comments: reviewComments,
    conversation: conversationComments,
    partialThreads,
    threads: pageOf(tConn, threadsAfter),
    conversationPage: pageOf(cConn, conversationAfter),
  }
}

/**
 * Review comments for the diff view and the AI tool: the first page of threads (100) with each
 * thread's first 50 comments, in one request. Never walks every thread. `truncated` is an explicit
 * field of the payload (`{ threads, replies }` or `false`) so it survives the JSON disk cache and
 * list edits; the comments view pages through the rest.
 * @param repo
 * @param number
 * @returns {Promise<{ comments: any[], truncated: false | { threads: boolean, replies: boolean } }>}
 */
export async function listPRCommentsPage(repo, number) {
  const page = await listPRTimelinePage(repo, number, { conversation: false, pageSize: 100 })
  const truncated = page.threads.hasNextPage || page.threads.stalled || page.partialThreads.length > 0
    ? { threads: page.threads.hasNextPage || page.threads.stalled, replies: page.partialThreads.length > 0 }
    : false
  return { comments: page.comments, truncated }
}

/**
 * The comments of `listPRCommentsPage`, as a plain array.
 * @param repo
 * @param number
 */
export async function listPRComments(repo, number) {
  return (await listPRCommentsPage(repo, number)).comments
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
 * Get every PR review comment shaped for IPC: all thread pages and all replies, by cursor.
 * `truncated` is true if GitHub returned a cursor that does not advance, so the caller can say the
 * list is incomplete instead of looping forever or hiding it.
 * @param repo
 * @param prNumber
 * @returns {Promise<{ comments: any[], truncated: boolean }>}
 */
export async function getPRReviewCommentsPage(repo, prNumber) {
  const all = []
  let after = null
  let stalled = false
  for (;;) {
    const page = await listPRTimelinePage(repo, prNumber, { threadsAfter: after, conversation: false, pageSize: 100 })
    all.push(...page.comments)
    for (const part of page.partialThreads) {
      let cursor = part.stalled ? null : part.endCursor
      if (part.stalled) stalled = true
      while (cursor) {
        const more = await listPRThreadReplies(part.threadId, cursor)
        all.push(...more.comments)
        if (more.page.stalled) stalled = true
        cursor = more.page.hasNextPage ? more.page.endCursor : null
      }
    }
    if (page.threads.stalled) stalled = true
    if (!page.threads.hasNextPage) break
    after = page.threads.endCursor
  }
  const shaped = all.map(c => ({
    id: c.id,
    threadId: c.threadId,
    path: c.path,
    line: c.line ?? c.originalLine ?? null,
    body: c.body,
    user: c.user?.login || null,
    resolved: c.threadResolved,
  }))
  return { comments: shaped, truncated: stalled }
}

/**
 * The comments of `getPRReviewCommentsPage`, as a plain array.
 * @param repo
 * @param prNumber
 */
export async function getPRReviewComments(repo, prNumber) {
  return (await getPRReviewCommentsPage(repo, prNumber)).comments
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
