// @ts-nocheck
// TODO(#197): typed gh issue timeline payload shapes should replace broad JS destructuring.
/**
 * src/executor/issue-timeline.js — the issue conversation as a cursor-paged timeline (#565).
 *
 * Mirrors listPRTimelinePage: one GraphQL `timelineItems` connection per page, `after:` cursors,
 * and no page is ever fetched twice. Comments and the events people read an issue for (labels,
 * assignment, close/reopen, rename, cross references, linked PRs) arrive interleaved in order.
 */

import { GhError } from './gh-error.js'
import { getRepo, runGh } from './core.js'

const REPO_PART_RE = /^[a-zA-Z0-9._-]+$/

/** Timeline item types shown in the issue view (everything else is noise for a reader). */
const ITEM_TYPES = [
  'ISSUE_COMMENT', 'LABELED_EVENT', 'UNLABELED_EVENT', 'ASSIGNED_EVENT', 'UNASSIGNED_EVENT',
  'CLOSED_EVENT', 'REOPENED_EVENT', 'RENAMED_TITLE_EVENT', 'CROSS_REFERENCED_EVENT',
  'CONNECTED_EVENT', 'DISCONNECTED_EVENT',
].join(', ')

const SUBJECT = `
  __typename
  ... on Issue { number title url repository { nameWithOwner } }
  ... on PullRequest { number title url repository { nameWithOwner } }
`

const NODE_FIELDS = `
  __typename
  ... on IssueComment {
    id databaseId body url createdAt lastEditedAt authorAssociation
    isMinimized minimizedReason viewerCanUpdate viewerCanDelete
    author { login }
    reactionGroups { content reactors { totalCount } }
  }
  ... on LabeledEvent { id createdAt actor { login } label { name color } }
  ... on UnlabeledEvent { id createdAt actor { login } label { name color } }
  ... on AssignedEvent { id createdAt actor { login } assignee { ... on Actor { login } } }
  ... on UnassignedEvent { id createdAt actor { login } assignee { ... on Actor { login } } }
  ... on ClosedEvent {
    id createdAt stateReason actor { login }
    closer { __typename ... on PullRequest { number title url } ... on Commit { abbreviatedOid url } }
  }
  ... on ReopenedEvent { id createdAt actor { login } }
  ... on RenamedTitleEvent { id createdAt actor { login } previousTitle currentTitle }
  ... on CrossReferencedEvent { id createdAt actor { login } willCloseTarget source { ${SUBJECT} } }
  ... on ConnectedEvent { id createdAt actor { login } subject { ${SUBJECT} } source { ${SUBJECT} } }
  ... on DisconnectedEvent { id createdAt actor { login } subject { ${SUBJECT} } source { ${SUBJECT} } }
`

const REACTION_EMOJI = {
  THUMBS_UP: '+1', THUMBS_DOWN: '-1', LAUGH: 'laugh', HOORAY: 'hooray',
  CONFUSED: 'confused', HEART: 'heart', ROCKET: 'rocket', EYES: 'eyes',
}

/**
 * Page info that never loops: a connection that claims a next page but returns the cursor we
 * just sent is reported as `stalled`, not retried forever.
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
 * The other end of a reference: the issue or PR that is not this issue.
 * @param nodes  candidate subjects
 * @param issueNumber
 */
function otherSubject(nodes, issueNumber) {
  const subject = nodes.filter(Boolean).find(n => n.number != null && Number(n.number) !== Number(issueNumber)) || nodes.find(n => n?.number != null)
  if (!subject) return null
  return {
    type: subject.__typename === 'PullRequest' ? 'pr' : 'issue',
    number: subject.number,
    title: subject.title || '',
    url: subject.url || '',
    repo: subject.repository?.nameWithOwner || '',
  }
}

const mapComment = (node) => ({
  key: node.id,
  kind: 'comment',
  id: node.databaseId,
  body: typeof node.body === 'string' ? node.body : '',
  url: node.url || '',
  author: node.author?.login || '',
  authorAssociation: node.authorAssociation || 'NONE',
  createdAt: node.createdAt || null,
  lastEditedAt: node.lastEditedAt || null,
  isMinimized: !!node.isMinimized,
  minimizedReason: node.minimizedReason || null,
  viewerCanUpdate: !!node.viewerCanUpdate,
  viewerCanDelete: !!node.viewerCanDelete,
  reactions: (node.reactionGroups || [])
    .map(g => ({ content: g.content, label: REACTION_EMOJI[g.content] || String(g.content || '').toLowerCase(), count: g.reactors?.totalCount || 0 }))
    .filter(r => r.count > 0),
})

const mapCloser = (closer) => {
  if (!closer) return null
  return closer.__typename === 'PullRequest'
    ? { type: 'pr', number: closer.number, title: closer.title || '', url: closer.url || '' }
    : { type: 'commit', oid: closer.abbreviatedOid || '', url: closer.url || '' }
}

/** Event mappers by GraphQL type: the part of the event that differs from the shared base. */
const EVENT_MAPPERS = {
  LabeledEvent: n => ({ type: 'labeled', label: n.label?.name || '', color: n.label?.color || '' }),
  UnlabeledEvent: n => ({ type: 'unlabeled', label: n.label?.name || '', color: n.label?.color || '' }),
  AssignedEvent: n => ({ type: 'assigned', assignee: n.assignee?.login || '' }),
  UnassignedEvent: n => ({ type: 'unassigned', assignee: n.assignee?.login || '' }),
  ClosedEvent: n => ({ type: 'closed', stateReason: n.stateReason || null, closer: mapCloser(n.closer) }),
  ReopenedEvent: () => ({ type: 'reopened' }),
  RenamedTitleEvent: n => ({ type: 'renamed', from: n.previousTitle || '', to: n.currentTitle || '' }),
  CrossReferencedEvent: (n, num) => ({ type: 'cross-referenced', source: otherSubject([n.source], num), willClose: !!n.willCloseTarget }),
  ConnectedEvent: (n, num) => ({ type: 'connected', source: otherSubject([n.source, n.subject], num) }),
  DisconnectedEvent: (n, num) => ({ type: 'disconnected', source: otherSubject([n.source, n.subject], num) }),
}

/**
 * Map one GraphQL timeline node to the view's item shape (null for a type we do not render).
 * Strings are passed through untouched; the view sanitizes them when drawing.
 * @param node
 * @param issueNumber
 */
export function mapIssueTimelineNode(node, issueNumber) {
  if (!node) return null
  if (node.__typename === 'IssueComment') return mapComment(node)
  const mapper = EVENT_MAPPERS[node.__typename]
  if (!mapper) return null
  return { key: node.id, createdAt: node.createdAt || null, actor: node.actor?.login || '', kind: 'event', ...mapper(node, issueNumber) }
}

/**
 * One cursor page of an issue's timeline (comments and events, oldest first).
 * `total` is the number of timeline items, so "N of M" and the live "new comments" count need
 * no extra request. A later page is fetched with the previous page's `endCursor`; an earlier
 * page is never fetched again.
 * @param repo
 * @param number
 * @param root0
 * @param root0.after  cursor returned by the previous page
 * @param root0.pageSize
 */
export async function listIssueTimelinePage(repo, number, { after = null, pageSize = 50 } = {}) {
  const r = getRepo(repo)
  const [owner, name] = r.split('/')
  if (!REPO_PART_RE.test(owner || '') || !REPO_PART_RE.test(name || '')) {
    throw new GhError({ message: `Invalid repository format: ${r}`, stderr: '', exitCode: 1, args: [] })
  }
  const query = `
    query($owner: String!, $name: String!, $number: Int!, $size: Int!, $after: String) {
      viewer { login }
      repository(owner: $owner, name: $name) {
        issue(number: $number) {
          timelineItems(first: $size, after: $after, itemTypes: [${ITEM_TYPES}]) {
            totalCount
            pageInfo { hasNextPage endCursor }
            nodes { ${NODE_FIELDS} }
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
  ]
  if (after) args.push('-f', `after=${after}`)
  args.push('-f', `query=${query}`)
  const result = await runGh(args)
  const conn = result?.data?.repository?.issue?.timelineItems
  const items = (conn?.nodes || []).map(n => mapIssueTimelineNode(n, number)).filter(Boolean)
  return { items, page: pageOf(conn, after), viewer: result?.data?.viewer?.login || '' }
}

/**
 * The issue header without its comments: the conversation comes from listIssueTimelinePage,
 * so opening a 500-comment issue no longer reads every comment in one call (#565).
 * @param repo
 * @param number
 */
export async function getIssueHeader(repo, number) {
  return runGh([
    'issue', 'view', String(number),
    '--repo', getRepo(repo),
    '--json', 'number,title,state,author,body,labels,assignees,updatedAt,milestone,url',
  ])
}

function assertCommentId(id) {
  if (!Number.isInteger(Number(id)) || Number(id) <= 0) throw new Error(`Invalid comment ID: ${id}`)
}

const commentPath = (repo, id) => `repos/${encodeURIComponent(getRepo(repo)).replace('%2F', '/')}/issues/comments/${encodeURIComponent(id)}`

/**
 * Edit an issue comment body. Allowed by GitHub only for the viewer's own comments (or a maintainer).
 * @param repo
 * @param commentId  numeric databaseId
 * @param body
 */
export async function editIssueComment(repo, commentId, body) {
  assertCommentId(commentId)
  return runGh(['api', commentPath(repo, commentId), '--method', 'PATCH', '--raw-field', `body=${body}`])
}

/**
 * Delete an issue comment.
 * @param repo
 * @param commentId  numeric databaseId
 */
export async function deleteIssueComment(repo, commentId) {
  assertCommentId(commentId)
  return runGh(['api', commentPath(repo, commentId), '--method', 'DELETE'])
}
