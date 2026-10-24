/**
 * executor/activity.js — typed READ-ONLY GitHub activity methods for watch-only mode.
 *
 * Every call goes through runGh() (the single gh chokepoint) and is a GraphQL
 * `query` or a `gh repo view`; nothing here mutates. One GraphQL round-trip
 * returns, per pull request, the force-push timeline, reviews, commits and the
 * head commit's check suites/runs, plus `rateLimit`, so observing N PRs does not
 * cost N*4 REST calls. Integers go via -F, strings via -f; pagination is
 * explicit (`first`/`last` on every connection, PR pages via cursor).
 */

import { runGh } from './core.js'
import { isOwnerName } from '../config/schema.js'
import { EVIDENCE_SCHEMA_VERSION, QUEUE_GROUPS, UNKNOWN, normalizePullRequestEvidence } from './evidence.js'

const PR_ACTIVITY_QUERY = `
query($owner: String!, $name: String!, $limit: Int!, $after: String) {
  rateLimit { cost remaining resetAt }
  repository(owner: $owner, name: $name) {
    nameWithOwner
    pullRequests(first: $limit, after: $after, orderBy: {field: UPDATED_AT, direction: DESC}) {
      pageInfo { hasNextPage endCursor }
      nodes {
        number updatedAt headRefOid baseRefName merged mergedAt
        author { login __typename }
        mergedBy { login __typename }
        timelineItems(first: 50, itemTypes: [HEAD_REF_FORCE_PUSHED_EVENT]) {
          pageInfo { hasNextPage }
          nodes {
            __typename
            ... on HeadRefForcePushedEvent {
              createdAt
              actor { login __typename }
              beforeCommit { oid }
              afterCommit { oid }
            }
          }
        }
        reviews(first: 50) {
          pageInfo { hasNextPage }
          nodes { id state submittedAt author { login __typename } commit { oid } }
        }
        commits(last: 30) {
          pageInfo { hasPreviousPage }
          nodes { commit {
            oid committedDate
            author { name email user { login } }
            authors(first: 5) { pageInfo { hasNextPage } nodes { name email user { login } } }
          } }
        }
        headCommit: commits(last: 1) {
          nodes { commit {
            oid
            checkSuites(first: 10) {
              pageInfo { hasNextPage }
              nodes {
                app { slug name }
                checkRuns(first: 20) {
                  pageInfo { hasNextPage }
                  nodes { name conclusion completedAt }
                }
              }
            }
          } }
        }
      }
    }
  }
}`

/**
 * Fetch one page of recent pull requests with their activity.
 *
 * @param {string} repo      "owner/name"
 * @param {object} [opts]
 * @param {number} [opts.limit=20]   PRs per page (GraphQL `first`)
 * @param {string|null} [opts.after] cursor from the previous page
 * @returns {Promise<{rateLimit: object|null, pullRequests: {nodes: object[], pageInfo: {hasNextPage: boolean, endCursor: string|null}}}>}
 */
export async function fetchPullRequestActivityPage(repo, { limit = 20, after = null } = {}) {
  const [owner, name] = String(repo || '').split('/')
  if (!owner || !name) throw new Error(`invalid repo "${repo}", expected owner/name`)
  const args = [
    'api', 'graphql',
    '-f', `query=${PR_ACTIVITY_QUERY}`,
    '-f', `owner=${owner}`,
    '-f', `name=${name}`,
    '-F', `limit=${limit}`,
  ]
  if (after) args.push('-f', `after=${after}`)
  const result = await runGh(args)
  const data = result?.data
  if (!data?.repository?.pullRequests) {
    const reason = result?.errors?.[0]?.message || 'repository not found or not readable'
    throw new Error(`could not read pull request activity for ${repo}: ${reason}`)
  }
  return { rateLimit: data.rateLimit || null, pullRequests: data.repository.pullRequests }
}

/**
 * Resolve the repository of the current directory via the user's gh session.
 * @returns {Promise<string>} "owner/name"
 */
export async function resolveCurrentRepo() {
  const result = await runGh(['repo', 'view', '--json', 'nameWithOwner'])
  const name = result?.nameWithOwner
  if (!name) throw new Error('could not determine repository; pass --repo owner/name')
  return name
}

// ─── Review evidence reads (#175) ─────────────────────────────────────────────
// Account-wide queue and per-PR detail for human inspection. Read-only; the
// pure model (facts, attention reasons, partitioning) lives in evidence.js.

const QUEUE_DEFAULT_LIMIT = 30
const QUEUE_MAX_LIMIT = 50

// Shared node selection. Every connection is explicitly bounded; truncation is
// read back from pageInfo/totalCount rather than assumed absent.
const EVIDENCE_FIELDS = `
fragment EvidenceFields on PullRequest {
  number title url state isDraft updatedAt headRefOid baseRefName mergeable reviewDecision
  additions deletions changedFiles
  repository { nameWithOwner }
  author { login __typename }
  reviewRequests(first: 10) {
    pageInfo { hasNextPage }
    nodes { requestedReviewer { __typename ... on User { login } ... on Team { slug } } }
  }
  latestOpinionatedReviews(first: 30) {
    pageInfo { hasNextPage }
    nodes { state author { login } commit { oid } }
  }
  reviewThreads(first: 50) {
    totalCount
    pageInfo { hasNextPage }
    nodes { isResolved path comments(first: 1) { nodes { bodyText author { login } } } }
  }
  commits(last: 1) {
    nodes { commit {
      oid
      statusCheckRollup {
        state
        contexts(first: 50) {
          totalCount
          nodes {
            __typename
            ... on CheckRun { status conclusion }
            ... on StatusContext { state }
          }
        }
      }
    } }
  }
}`

const EVIDENCE_QUEUE_QUERY = `
query($reviewQuery: String!, $authoredQuery: String!, $limit: Int!, $reviewAfter: String, $authoredAfter: String) {
  viewer { login }
  rateLimit { cost remaining resetAt }
  reviewRequested: search(type: ISSUE, query: $reviewQuery, first: $limit, after: $reviewAfter) {
    issueCount
    pageInfo { hasNextPage endCursor }
    nodes { __typename ... on PullRequest { ...EvidenceFields } }
  }
  authored: search(type: ISSUE, query: $authoredQuery, first: $limit, after: $authoredAfter) {
    issueCount
    pageInfo { hasNextPage endCursor }
    nodes { __typename ... on PullRequest { ...EvidenceFields } }
  }
}
${EVIDENCE_FIELDS}`

// The detail read adds the PR body (untrusted prose) to the shared selection.
const EVIDENCE_DETAIL_QUERY = `
query($owner: String!, $name: String!, $number: Int!) {
  viewer { login }
  rateLimit { cost remaining resetAt }
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) { ...EvidenceFields body }
  }
}
${EVIDENCE_FIELDS}`

function evidenceHost() {
  return process.env.GH_HOST || 'github.com'
}

function normalizeRateLimit(rl) {
  if (!rl) return { remaining: UNKNOWN, cost: UNKNOWN, reset_at: UNKNOWN, low: UNKNOWN }
  return { remaining: rl.remaining, cost: rl.cost, reset_at: rl.resetAt, low: rl.remaining <= rl.cost * 5 }
}

// Scope values become search qualifiers, so each must be a well-formed owner or
// owner/name (config/schema.js isOwnerName): no spaces, no extra qualifiers.
function scopeQualifiers(scope = {}) {
  const org = scope.org
  if (org && !isOwnerName(`${org}/x`)) throw new Error(`invalid scope org "${org}"`)
  const repos = scope.repos || []
  for (const r of repos) if (!isOwnerName(String(r))) throw new Error(`invalid scope repo "${r}", expected owner/name`)
  return [...(org ? [`org:${org}`] : []), ...repos.map(r => `repo:${r}`)].join(' ')
}

/**
 * Account-wide review queue evidence: PRs the signed-in account can see that
 * request its review or that it authored, in ONE GraphQL round trip (two
 * aliased searches, no per-PR calls). Bounded by `limit` per group; more
 * results are reported under `truncation`, with cursors to continue.
 *
 * @param {object} [opts]
 * @param {number} [opts.limit=30]   PRs per group (max 50)
 * @param {{org?: string, repos?: string[]}} [opts.scope] narrow to an org or repositories
 * @param {{reviewRequested?: string, authored?: string}} [opts.after] cursors from a previous `truncation`
 * @param {{set: Function}} [opts.cache] createEvidenceCache() instance
 * @param {() => number} [opts.now]
 * @returns {Promise<object>} `{schema_version, kind, host, account, fetched_at, items, group_counts, truncation, rate_limit}`
 */
export async function fetchReviewQueueEvidence({ limit = QUEUE_DEFAULT_LIMIT, scope, after = {}, cache, now = Date.now } = {}) {
  const host = evidenceHost()
  const bound = Math.max(1, Math.min(Math.trunc(Number(limit)) || QUEUE_DEFAULT_LIMIT, QUEUE_MAX_LIMIT))
  const base = `is:pr is:open archived:false sort:updated-desc ${scopeQualifiers(scope)}`.trim()
  const args = [
    'api', 'graphql',
    '-f', `query=${EVIDENCE_QUEUE_QUERY}`,
    '-f', `reviewQuery=${base} review-requested:@me`,
    '-f', `authoredQuery=${base} author:@me`,
    '-F', `limit=${bound}`,
  ]
  // Cursors travel as GraphQL variables (-f is a literal string), never inside the search text.
  if (typeof after.reviewRequested === 'string' && after.reviewRequested) args.push('-f', `reviewAfter=${after.reviewRequested}`)
  if (typeof after.authored === 'string' && after.authored) args.push('-f', `authoredAfter=${after.authored}`)
  const result = await runGh(args)
  const data = result?.data
  if (!data?.reviewRequested || !data?.authored) {
    throw new Error(`could not read review queue: ${result?.errors?.[0]?.message || 'no data returned'}`)
  }
  const fetchedAt = new Date(now()).toISOString()
  const account = data.viewer?.login || null
  const byKey = new Map()
  const collect = (group, membership, source) => {
    for (const node of group.nodes || []) {
      if (node?.__typename !== 'PullRequest') continue
      const key = `${node.repository?.nameWithOwner}#${node.number}`
      const existing = byKey.get(key)
      if (existing) { existing.membership.push(membership); continue }
      const item = normalizePullRequestEvidence(node, { host, account, fetchedAt, reviewRequestedOfMe: membership === 'review_requested', source })
      byKey.set(key, { ...item, membership: [membership] })
    }
  }
  collect(data.reviewRequested, 'review_requested', 'github.graphql.search(review-requested:@me)')
  collect(data.authored, 'authored', 'github.graphql.search(author:@me)')
  const items = [...byKey.values()]
  for (const item of items) cache?.set({ host, account: account || UNKNOWN, repo: item.identity.repo, number: item.identity.number }, item, now())
  const truncation = group => ({
    total: group.issueCount ?? UNKNOWN,
    returned: (group.nodes || []).length,
    has_more: Boolean(group.pageInfo?.hasNextPage),
    next_cursor: group.pageInfo?.hasNextPage ? group.pageInfo.endCursor : null,
  })
  return {
    schema_version: EVIDENCE_SCHEMA_VERSION,
    kind: 'review_queue',
    host,
    account: account || UNKNOWN,
    fetched_at: fetchedAt,
    items,
    group_counts: Object.fromEntries(QUEUE_GROUPS.map(g => [g, items.filter(i => i.group.group === g).length])),
    truncation: { review_requested: truncation(data.reviewRequested), authored: truncation(data.authored) },
    rate_limit: normalizeRateLimit(data.rateLimit),
  }
}

/**
 * Evidence for one PR (detail view), one GraphQL round trip. Serves a cached
 * record for the same host/account/repo when `cache` holds one younger than its
 * TTL; a stale hit is refetched, and `force` always refetches.
 *
 * @param {string} repo "owner/name"
 * @param {number} number
 * @param {object} [opts]
 * @param {{get: Function, set: Function, knownAccount: Function}} [opts.cache]
 * @param {boolean} [opts.force]
 * @param {() => number} [opts.now]
 * @returns {Promise<object>} evidence record (see normalizePullRequestEvidence) plus `rate_limit`
 */
export async function fetchPRReviewEvidence(repo, number, { cache, force = false, now = Date.now } = {}) {
  const [owner, name] = String(repo || '').split('/')
  if (!owner || !name || !isOwnerName(repo)) throw new Error(`invalid repo "${repo}", expected owner/name`)
  const n = Number(number)
  if (!Number.isInteger(n) || n < 1) throw new Error(`invalid pull request number "${number}"`)
  const host = evidenceHost()
  const known = cache?.knownAccount(host)
  if (cache && known && !force) {
    const hit = cache.get({ host, account: known, repo, number: n }, now())
    if (hit && !hit.stale) return { ...hit.value, cache: { hit: true, age_ms: hit.age_ms } }
  }
  const result = await runGh([
    'api', 'graphql',
    '-f', `query=${EVIDENCE_DETAIL_QUERY}`,
    '-f', `owner=${owner}`,
    '-f', `name=${name}`,
    '-F', `number=${n}`,
  ])
  const node = result?.data?.repository?.pullRequest
  if (!node) throw new Error(`could not read review evidence for ${repo}#${n}: ${result?.errors?.[0]?.message || 'not found or not readable'}`)
  const account = result.data.viewer?.login || null
  const fetchedAt = new Date(now()).toISOString()
  const evidence = {
    ...normalizePullRequestEvidence({ ...node, repository: { nameWithOwner: repo } }, { host, account, fetchedAt, source: 'github.graphql.pullRequest' }),
    rate_limit: normalizeRateLimit(result.data.rateLimit),
  }
  cache?.set({ host, account: account || UNKNOWN, repo, number: n }, evidence, now())
  return evidence
}
