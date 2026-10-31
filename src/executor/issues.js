// @ts-nocheck
// TODO(#197): typed gh issue payload shapes should replace broad JS destructuring.
import { getRepo, runGh } from './core.js'
/**
 * List issues with optional filters.
 * @param repo
 * @param filter
 */
export async function listIssues(repo, filter = {}) {
  const base = [
    'issue', 'list',
    '--repo', getRepo(repo),
    '--limit', String(filter.limit || 50),
  ]
  if (filter.state)     base.push('--state',     filter.state)
  if (filter.author)    base.push('--author',    filter.author)
  if (filter.label)     base.push('--label',     filter.label)
  if (filter.assignee)  base.push('--assignee',  filter.assignee)
  if (filter.milestone) base.push('--milestone', filter.milestone)

  // No `comments`: the full array grows with every issue; the list never needs it (#506).
  return runGh([...base, '--json', 'number,title,state,author,labels,assignees,updatedAt,body,milestone,url'])
}

const ISSUE_PAGE_MAX = 100
const ISSUE_STATES = new Set(['open', 'closed', 'all'])

function q(value) {
  return String(value || '').replace(/"/g, '\\"').trim()
}

// An unquoted search qualifier value: a login, a bot login or @me. Anything else
// (spaces, quotes, colons) could smuggle extra qualifiers into the query.
const SEARCH_LOGIN = /^(?:@me|[A-Za-z0-9][A-Za-z0-9_.-]*(?:\[bot\])?)$/
function searchLogin(value) {
  const login = String(value || '').trim()
  if (!SEARCH_LOGIN.test(login)) throw new Error(`Invalid login for an issue search: ${JSON.stringify(login)}`)
  return login
}

/**
 * One cursor page of issues (GraphQL search). Never refetches earlier pages:
 * pass the previous page's `endCursor` as `filter.after`.
 * @param {string} repo
 * @param {object} filter  state, author, label, assignee, milestone, limit, after
 * @returns {Promise<{items: object[], hasNextPage: boolean, endCursor: string|null, totalCount: number}>}
 */
export async function listIssuesPage(repo, filter = {}) {
  const r = getRepo(repo)
  const state = ISSUE_STATES.has(filter.state) ? filter.state : 'open'
  // Newest first by creation, like `gh issue list`; 'oldest' is server-side so the
  // list never re-sorts under the cursor as pages arrive.
  const sort = filter.sort === 'oldest' ? 'sort:created-asc' : 'sort:created-desc'
  const parts = [`repo:${r}`, 'is:issue', sort]
  if (state !== 'all') parts.push(`state:${state}`)
  if (filter.author)    parts.push(`author:${searchLogin(filter.author)}`)
  if (filter.assignee)  parts.push(`assignee:${searchLogin(filter.assignee)}`)
  if (filter.label)     parts.push(`label:"${q(filter.label)}"`)
  if (filter.milestone) parts.push(`milestone:"${q(filter.milestone)}"`)
  const limit = Math.max(1, Math.min(Number(filter.limit || 50), ISSUE_PAGE_MAX))
  const query = `
    query($searchQuery: String!, $limit: Int!, $after: String) {
      search(type: ISSUE, first: $limit, after: $after, query: $searchQuery) {
        issueCount
        pageInfo { hasNextPage endCursor }
        nodes {
          __typename
          ... on Issue {
            number title state url updatedAt body
            author { login }
            labels(first: 20) { nodes { name color } }
            assignees(first: 10) { nodes { login name } }
            milestone { title }
            comments { totalCount }
          }
        }
      }
    }
  `
  const result = await runGh([
    'api', 'graphql',
    '-f', `query=${query}`,
    '-f', `searchQuery=${parts.join(' ')}`,
    '-F', `limit=${limit}`,
    ...(filter.after ? ['-f', `after=${filter.after}`] : []),
  ])
  const search = result?.data?.search
  const items = (search?.nodes || []).filter(n => n && n.number).map(n => ({
    number: n.number,
    title: n.title,
    state: n.state,
    url: n.url,
    updatedAt: n.updatedAt,
    body: n.body,
    author: n.author,
    labels: n.labels?.nodes || [],
    assignees: n.assignees?.nodes || [],
    milestone: n.milestone,
    commentCount: n.comments?.totalCount ?? 0,
  }))
  return {
    items,
    hasNextPage: Boolean(search?.pageInfo?.hasNextPage && search.pageInfo.endCursor),
    endCursor: search?.pageInfo?.endCursor || null,
    totalCount: Number(search?.issueCount ?? items.length),
  }
}

/**
 * Get a single issue by number.
 * @param repo
 * @param number
 */
export async function getIssue(repo, number) {
  const args = [
    'issue', 'view', String(number),
    '--repo', getRepo(repo),
    '--json', 'number,title,state,author,body,labels,assignees,updatedAt,milestone,comments,url',
  ]
  return runGh(args)
}

/**
 * One issue as a list row (the listIssuesPage shape), without its comments, so the
 * list can patch a row after a write instead of refetching every page (D16).
 * @param {string} repo
 * @param {number} number
 */
export async function getIssueRow(repo, number) {
  const n = await runGh([
    'issue', 'view', String(number),
    '--repo', getRepo(repo),
    '--json', 'number,title,state,url,updatedAt,body,author,labels,assignees,milestone',
  ])
  return {
    number: n.number, title: n.title, state: n.state, url: n.url, updatedAt: n.updatedAt, body: n.body,
    author: n.author, labels: n.labels || [], assignees: n.assignees || [], milestone: n.milestone,
  }
}

/**
 * Create a new issue.
 * @param repo
 * @param root0
 * @param root0.title
 * @param root0.body
 * @param root0.labels
 * @param root0.assignees
 * @param root0.milestone
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
  return runGh(args)
}

/**
 * Close an issue.
 * @param repo
 * @param number
 */
export async function closeIssue(repo, number) {
  const args = [
    'issue', 'close', String(number),
    '--repo', getRepo(repo),
  ]
  return runGh(args)
}

// ─── Label functions ──────────────────────────────────────────────────────────

/**
 * List all labels in a repo.
 * @param repo
 */
export async function listLabels(repo) {
  const args = [
    'label', 'list',
    '--repo', getRepo(repo),
    '--json', 'name,color,description',
    '--limit', '100',
  ]
  return runGh(args)
}

/**
 * Add labels to a PR or issue.
 * @param repo
 * @param number
 * @param labels
 * @param type
 */
export async function addLabels(repo, number, labels, type = 'issue') {
  const args = [
    type === 'pr' ? 'pr' : 'issue',
    'edit', String(number),
    '--repo', getRepo(repo),
    '--add-label', labels.join(','),
  ]
  return runGh(args)
}

/**
 * Remove labels from a PR or issue.
 * @param repo
 * @param number
 * @param labels
 * @param type
 */
export async function removeLabels(repo, number, labels, type = 'issue') {
  const args = [
    type === 'pr' ? 'pr' : 'issue',
    'edit', String(number),
    '--repo', getRepo(repo),
    '--remove-label', labels.join(','),
  ]
  return runGh(args)
}

// ─── Collaborator / reviewer functions ───────────────────────────────────────

const COLLAB_PAGE_SIZE = 100
/** Safety ceiling on collaborator pages (5000 people); every earlier page is fetched exactly once. */
export const COLLAB_MAX_PAGES = 50

/**
 * List collaborators for a repo, following pages until a short page (D16: a
 * picker must offer everyone, not just the first 30 or 100).
 * @param repo
 */
export async function listCollaborators(repo) {
  const r = getRepo(repo)
  const all = []
  for (let page = 1; page <= COLLAB_MAX_PAGES; page++) {
    const args = [
      'api', `repos/${encodeURIComponent(r).replace('%2F', '/')}/collaborators?per_page=${COLLAB_PAGE_SIZE}&page=${page}`,
      '--jq', '[.[] | {login: .login, name: .name}]',
    ]
    const rows = await runGh(args)
    if (!Array.isArray(rows)) return page === 1 ? rows : all
    all.push(...rows)
    if (rows.length < COLLAB_PAGE_SIZE) break
  }
  return all
}

/**
 * Add and remove labels or assignees on an issue in ONE edit call, so a
 * partial failure cannot leave only half of the user's change applied.
 * @param {string} repo
 * @param {number} number
 * @param {'label'|'assignee'} kind
 * @param {{add?: string[], remove?: string[]}} change
 */
export async function editIssueMembers(repo, number, kind, { add = [], remove = [] }) {
  if (!add.length && !remove.length) return undefined
  const args = ['issue', 'edit', String(number), '--repo', getRepo(repo)]
  if (add.length) args.push(`--add-${kind}`, add.join(','))
  if (remove.length) args.push(`--remove-${kind}`, remove.join(','))
  return runGh(args)
}

/**
 * Add a general comment to an issue.
 * @param repo
 * @param number
 * @param body
 */
export async function addIssueComment(repo, number, body) {
  const args = [
    'issue', 'comment', String(number),
    '--repo', getRepo(repo),
    '--body', body,
  ]
  return runGh(args)
}

/**
 * Add assignees to an issue.
 * @param repo
 * @param number
 * @param assignees
 */
export async function addIssueAssignees(repo, number, assignees) {
  const args = ['issue', 'edit', String(number), '--repo', getRepo(repo), '--add-assignee', assignees.join(',')]
  return runGh(args)
}

/**
 * Remove assignees from an issue.
 * @param repo
 * @param number
 * @param assignees
 */
export async function removeIssueAssignees(repo, number, assignees) {
  const args = ['issue', 'edit', String(number), '--repo', getRepo(repo), '--remove-assignee', assignees.join(',')]
  return runGh(args)
}
