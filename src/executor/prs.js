// @ts-nocheck
// TODO(#197): typed gh PR payload shapes should replace broad JS destructuring.
import { getRepo, runGh } from './core.js'

const PR_LIST_MAX_GRAPHQL_NODES = 100
const PR_SEARCH_STATES = new Set(['open', 'closed', 'merged'])

function compact(value) {
  return String(value || '').replace(/"/g, '\\"').trim()
}

function prSearchQuery(repo, filter) {
  const state = PR_SEARCH_STATES.has(filter.state) ? filter.state : 'open'
  const parts = [`repo:${repo}`, 'is:pr']
  if (state === 'merged') {
    parts.push('is:merged')
  } else {
    parts.push(`state:${state}`)
  }
  if (filter.author) parts.push(`author:${compact(filter.author)}`)
  if (filter.reviewer) parts.push(`review-requested:${compact(filter.reviewer)}`)
  if (filter.assignee) parts.push(`assignee:${compact(filter.assignee)}`)
  if (filter.label) parts.push(`label:"${compact(filter.label)}"`)
  if (!filter.author) {
    if (filter.scope === 'own') parts.push('author:@me')
    if (filter.scope === 'reviewing') parts.push('review-requested:@me')
  }
  return parts.join(' ')
}

function normalizeReviewRequests(reviewRequests) {
  return (reviewRequests?.nodes || [])
    .map(node => node?.requestedReviewer)
    .filter(Boolean)
    .map(reviewer => ({
      login: reviewer.login || reviewer.name || '',
      name: reviewer.name || reviewer.login || '',
    }))
}

function normalizeStatusCheck(node) {
  if (!node) return null
  if (node.__typename === 'CheckRun') {
    return {
      name: node.name,
      state: node.status,
      status: node.status,
      conclusion: node.conclusion,
      startedAt: node.startedAt,
      completedAt: node.completedAt,
    }
  }
  if (node.__typename === 'StatusContext') {
    return {
      name: node.context,
      context: node.context,
      state: node.state,
      status: node.state,
      conclusion: node.state,
    }
  }
  return node
}

/**
 * Normalize the PR list GraphQL response to the legacy gh `pr list --json`
 * shape consumed by the list pane.
 *
 * @param {object} result
 * @returns {object[]}
 */
export function normalizePRListGraphQL(result) {
  const nodes = result?.data?.search?.nodes || []
  return nodes
    .filter(node => node?.__typename === 'PullRequest')
    .map(pr => ({
      number: pr.number,
      title: pr.title,
      state: pr.state,
      author: pr.author ? { login: pr.author.login } : null,
      labels: pr.labels?.nodes || [],
      reviewRequests: normalizeReviewRequests(pr.reviewRequests),
      statusCheckRollup: (pr.statusCheckRollup?.nodes || []).map(normalizeStatusCheck).filter(Boolean),
      reviewDecision: pr.reviewDecision,
      updatedAt: pr.updatedAt,
      isDraft: Boolean(pr.isDraft),
      headRefName: pr.headRefName,
      baseRefName: pr.baseRefName,
      assignees: pr.assignees?.nodes || [],
      body: pr.body || '',
      mergeable: pr.mergeable,
      autoMergeRequest: pr.autoMergeRequest,
      url: pr.url,
    }))
}

/**
 * List pull requests for a repo with optional filters.
 * @param repo
 * @param filter
 */
export async function listPRs(repo, filter = {}) {
  const r = getRepo(repo)
  const [owner, name] = r.split('/')
  const limit = Math.max(1, Math.min(Number(filter.limit || PR_LIST_MAX_GRAPHQL_NODES), PR_LIST_MAX_GRAPHQL_NODES))
  const queryText = prSearchQuery(r, filter)
  const query = `
    query($owner: String!, $name: String!, $searchQuery: String!, $limit: Int!) {
      search(type: ISSUE, first: $limit, query: $searchQuery) {
        nodes {
          __typename
          ... on PullRequest {
            number
            title
            state
            author { login }
            labels(first: 20) { nodes { name color } }
            reviewRequests(first: 10) {
              nodes {
                requestedReviewer {
                  __typename
                  ... on User { login name }
                  ... on Team { name }
                }
              }
            }
            statusCheckRollup(first: 50) {
              nodes {
                __typename
                ... on CheckRun { name status conclusion startedAt completedAt }
                ... on StatusContext { context state }
              }
            }
            reviewDecision
            updatedAt
            isDraft
            headRefName
            baseRefName
            assignees(first: 10) { nodes { login name } }
            body
            mergeable
            autoMergeRequest { enabledAt }
            url
          }
        }
      }
      repository(owner: $owner, name: $name) { id }
    }
  `
  const result = await runGh([
    'api', 'graphql',
    '-f', `query=${query}`,
    '-f', `owner=${owner}`,
    '-f', `name=${name}`,
    '-f', `searchQuery=${queryText}`,
    '-F', `limit=${limit}`,
  ])
  return normalizePRListGraphQL(result)
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
