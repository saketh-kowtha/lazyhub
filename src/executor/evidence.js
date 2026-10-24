/**
 * executor/evidence.js — pure review-evidence model (issue #175). No I/O.
 *
 * Turns one GraphQL PullRequest node into an evidence record for HUMAN
 * inspection. Observation never grants authority (ARCHITECT_DECISIONS D1,
 * THREAT_MODEL T1/T3/T7): nothing here is an approval input, and a cached
 * record must never be treated as one. Exact binding and revalidation stay with
 * the approval work (#235/#244/#278).
 *
 * Rules the shape enforces:
 *   - every computed fact is `{value, source, fetched_at}`; a field GitHub did
 *     not return is the literal `'unknown'`, never inferred safe;
 *   - attention reasons are deterministic and cite the fact they came from;
 *     there are no scores;
 *   - prose written by the PR author, agents or commenters lives only under
 *     `untrusted`, apart from `facts`; actor attribution is `unverified`.
 */

import { createHash } from 'crypto'
import { sanitize } from '../utils-core.js'
import { createLruCache } from '../cache.js'

export const EVIDENCE_SCHEMA_VERSION = 1
export const UNKNOWN = 'unknown'

/** Queue groups in precedence order (first match wins; see queueGroup()). */
export const QUEUE_GROUPS = Object.freeze(['needs_my_review', 'ci_failing', 'changes_requested', 'waiting', 'ready', 'unknown'])

const TITLE_MAX = 300
const BODY_MAX = 4000
const EXCERPT_MAX = 300
const FAILING_CONCLUSIONS = new Set(['FAILURE', 'TIMED_OUT', 'CANCELLED', 'STARTUP_FAILURE', 'ACTION_REQUIRED'])
const PASSING_CONCLUSIONS = new Set(['SUCCESS', 'NEUTRAL', 'SKIPPED'])

/**
 * One computed fact. Missing data is explicit, never defaulted to a safe value.
 *
 * @param {unknown} value
 * @param {string} source   where the value came from (GraphQL field path)
 * @param {string} fetchedAt ISO time of the read
 */
export function fact(value, source, fetchedAt) {
  return { value: value === undefined || value === null ? UNKNOWN : value, source, fetched_at: fetchedAt }
}

const bounded = (value, max) => {
  const text = sanitize(value == null ? '' : String(value))
  return text.length > max ? { text: text.slice(0, max), truncated: true } : { text, truncated: false }
}

function summarizeChecks(commitNode) {
  const rollup = commitNode?.statusCheckRollup
  if (!commitNode) return { state: UNKNOWN, total: UNKNOWN, passed: UNKNOWN, failed: UNKNOWN, pending: UNKNOWN, truncated: false }
  // A head commit with no rollup means GitHub reports no checks at all (a known, distinct state).
  if (!rollup) return { state: 'none_reported', total: 0, passed: 0, failed: 0, pending: 0, truncated: false }
  const nodes = rollup.contexts?.nodes || []
  let passed = 0
  let failed = 0
  let pending = 0
  for (const n of nodes) {
    const outcome = n.__typename === 'StatusContext' ? n.state : (n.status === 'COMPLETED' ? n.conclusion : 'PENDING')
    if (FAILING_CONCLUSIONS.has(outcome) || outcome === 'FAILURE' || outcome === 'ERROR') failed += 1
    else if (PASSING_CONCLUSIONS.has(outcome)) passed += 1
    else pending += 1
  }
  const total = rollup.contexts?.totalCount ?? nodes.length
  return {
    state: rollup.state || UNKNOWN,
    total,
    // Counts cover only the fetched contexts; `truncated` marks them as lower bounds.
    passed,
    failed,
    pending,
    truncated: total > nodes.length,
  }
}

function summarizeReviews(node, viewer) {
  const latest = node.latestOpinionatedReviews
  if (!latest) return { approvals: UNKNOWN, staleApprovals: UNKNOWN, changesRequested: UNKNOWN, truncated: false }
  const rows = latest.nodes || []
  const approved = rows.filter(r => r.state === 'APPROVED')
  return {
    approvals: approved.length,
    // Stale means the approval was given on a commit other than the current head.
    // A review with no commit oid cannot be judged, so it counts as stale-unknown.
    staleApprovals: approved.filter(r => !r.commit?.oid || r.commit.oid !== node.headRefOid).length,
    changesRequested: rows.filter(r => r.state === 'CHANGES_REQUESTED').length,
    mine: viewer ? rows.find(r => r.author?.login === viewer)?.state ?? 'NONE' : UNKNOWN,
    truncated: Boolean(latest.pageInfo?.hasNextPage),
  }
}

function summarizeRequests(node, viewer) {
  const nodes = node.reviewRequests?.nodes
  if (!nodes) return { via: UNKNOWN, teams: [], truncated: false }
  const reviewers = nodes.map(n => n?.requestedReviewer).filter(Boolean)
  const teams = reviewers.filter(r => r.__typename === 'Team').map(r => r.slug).filter(Boolean)
  let via = 'none'
  if (viewer && reviewers.some(r => r.__typename === 'User' && r.login === viewer)) via = 'direct'
  // GitHub does not say which of the user's teams matched; only that a team was requested.
  else if (teams.length > 0) via = 'team_unverified'
  return { via, teams, truncated: Boolean(node.reviewRequests?.pageInfo?.hasNextPage) }
}

function summarizeThreads(node) {
  const threads = node.reviewThreads
  if (!threads) return { unresolved: UNKNOWN, total: UNKNOWN, truncated: false }
  const rows = threads.nodes || []
  return {
    unresolved: rows.filter(t => !t.isResolved).length,
    total: threads.totalCount ?? rows.length,
    // Unresolved is a lower bound when more threads exist than were fetched.
    truncated: Boolean(threads.pageInfo?.hasNextPage) || (threads.totalCount ?? 0) > rows.length,
  }
}

/**
 * Deterministic attention reasons, ordered, each citing its fact. A reason is a
 * pointer to evidence a human should look at, not a verdict about safety.
 *
 * @param {object} facts
 * @param {boolean} reviewRequestedOfMe
 */
export function attentionReasons(facts, reviewRequestedOfMe) {
  const out = []
  const add = (code, factPath, f, detail) => out.push({ code, fact: factPath, value: f.value, source: f.source, ...(detail ? { detail } : {}) })
  if (reviewRequestedOfMe) add('review_requested', 'review_requests', facts.review_requests)
  if (facts.checks.value.state === UNKNOWN) add('checks_unavailable', 'checks', facts.checks)
  else if (facts.checks.value.failed > 0 || ['FAILURE', 'ERROR'].includes(facts.checks.value.state)) add('ci_failing', 'checks', facts.checks)
  else if (facts.checks.value.state === 'PENDING' || facts.checks.value.state === 'EXPECTED') add('ci_pending', 'checks', facts.checks)
  if (facts.review_decision.value === 'CHANGES_REQUESTED') add('changes_requested', 'review_decision', facts.review_decision)
  const reviews = facts.reviews.value
  if (reviews.staleApprovals > 0) add('stale_approval', 'reviews', facts.reviews, 'approval was given on an earlier head commit')
  if (facts.unresolved_threads.value.unresolved > 0) add('unresolved_threads', 'unresolved_threads', facts.unresolved_threads)
  if (facts.mergeable.value === 'CONFLICTING') add('merge_conflict', 'mergeable', facts.mergeable)
  else if (facts.mergeable.value === UNKNOWN) add('mergeability_unknown', 'mergeable', facts.mergeable)
  if (facts.is_draft.value === true) add('draft', 'is_draft', facts.is_draft)
  return out
}

/**
 * Queue group for the sidebar. Precedence is fixed and every group names the
 * reason it came from. A PR with unavailable key facts is `unknown`, never
 * `ready`.
 *
 * @param {object[]} reasons from attentionReasons()
 * @param {object} facts
 */
export function queueGroup(reasons, facts) {
  const has = code => reasons.some(r => r.code === code)
  if (has('review_requested')) return { group: 'needs_my_review', because: 'review_requested' }
  if (has('ci_failing')) return { group: 'ci_failing', because: 'ci_failing' }
  if (has('changes_requested')) return { group: 'changes_requested', because: 'changes_requested' }
  if (has('checks_unavailable') || has('mergeability_unknown') || facts.review_decision.value === UNKNOWN) {
    return { group: 'unknown', because: has('checks_unavailable') ? 'checks_unavailable' : has('mergeability_unknown') ? 'mergeability_unknown' : 'review_decision_unknown' }
  }
  const ci = facts.checks.value.state
  if (facts.review_decision.value === 'APPROVED' && facts.mergeable.value === 'MERGEABLE' && !has('draft') && (ci === 'SUCCESS' || ci === 'none_reported')) {
    return { group: 'ready', because: 'approved_checks_passing_mergeable' }
  }
  return { group: 'waiting', because: has('ci_pending') ? 'ci_pending' : 'awaiting_review' }
}

/**
 * Normalize one GraphQL PullRequest node into an evidence record.
 *
 * @param {object} node GraphQL PullRequest (see EVIDENCE_FIELDS in activity.js)
 * @param {object} ctx
 * @param {string} ctx.host
 * @param {string|null} ctx.account  viewer login, or null when not returned
 * @param {string} ctx.fetchedAt     ISO time of the read
 * @param {boolean} [ctx.reviewRequestedOfMe] true when the node came from a review-requested:@me search
 * @param {string} [ctx.source]      provenance label for the read
 */
export function normalizePullRequestEvidence(node, { host, account, fetchedAt, reviewRequestedOfMe = false, source = 'github.graphql' }) {
  const s = path => `${source}:${path}`
  const f = (value, path) => fact(value, s(path), fetchedAt)
  const headCommit = node.commits?.nodes?.[0]?.commit || null
  const requests = summarizeRequests(node, account)

  const facts = {
    state: f(node.state, 'pullRequest.state'),
    is_draft: f(typeof node.isDraft === 'boolean' ? node.isDraft : null, 'pullRequest.isDraft'),
    mergeable: f(node.mergeable, 'pullRequest.mergeable'),
    review_decision: f(node.reviewDecision ?? (node.reviewDecision === null ? 'NONE' : null), 'pullRequest.reviewDecision'),
    checks: f(headCommit ? summarizeChecks(headCommit) : null, 'pullRequest.commits.last.statusCheckRollup'),
    reviews: f(node.latestOpinionatedReviews ? summarizeReviews(node, account) : null, 'pullRequest.latestOpinionatedReviews'),
    review_requests: f(node.reviewRequests ? requests : null, 'pullRequest.reviewRequests'),
    unresolved_threads: f(node.reviewThreads ? summarizeThreads(node) : null, 'pullRequest.reviewThreads'),
    diff: f(node.additions == null ? null : { additions: node.additions, deletions: node.deletions ?? UNKNOWN, changed_files: node.changedFiles ?? UNKNOWN }, 'pullRequest.additions/deletions/changedFiles'),
    updated_at: f(node.updatedAt, 'pullRequest.updatedAt'),
    // GitHub's API does not expose branch-protection requirements to this read.
    required_checks: fact(UNKNOWN, s('not_requested'), fetchedAt),
  }
  // Facts hold structured values; normalize the unknown sentinel for nested summaries.
  if (facts.checks.value === UNKNOWN) facts.checks.value = { state: UNKNOWN, total: UNKNOWN, passed: UNKNOWN, failed: UNKNOWN, pending: UNKNOWN, truncated: false }
  if (facts.reviews.value === UNKNOWN) facts.reviews.value = { approvals: UNKNOWN, staleApprovals: UNKNOWN, changesRequested: UNKNOWN, truncated: false }
  if (facts.unresolved_threads.value === UNKNOWN) facts.unresolved_threads.value = { unresolved: UNKNOWN, total: UNKNOWN, truncated: false }
  if (facts.review_requests.value === UNKNOWN) facts.review_requests.value = { via: UNKNOWN, teams: [], truncated: false }

  const reasons = attentionReasons(facts, reviewRequestedOfMe || requests.via === 'direct')
  const title = bounded(node.title, TITLE_MAX)
  const body = bounded(node.body, BODY_MAX)
  const repo = node.repository?.nameWithOwner || UNKNOWN

  return {
    schema_version: EVIDENCE_SCHEMA_VERSION,
    identity: { host, repo, number: node.number, url: node.url || null, account: account || UNKNOWN },
    context: {
      head: f(node.headRefOid, 'pullRequest.headRefOid'),
      base: f(node.baseRefName, 'pullRequest.baseRefName'),
    },
    facts,
    attention: reasons,
    group: queueGroup(reasons, facts),
    // Attribution is never inferred: a login says who GitHub recorded, not whether an agent wrote the change.
    actor: { login: node.author?.login || UNKNOWN, github_type: node.author?.__typename || UNKNOWN, source: s('pullRequest.author'), attribution: 'unverified' },
    // Everything below was written by the PR author, agents or commenters. Display only; never feed it to a decision.
    untrusted: {
      title: title.text,
      body: node.body === undefined ? UNKNOWN : body.text,
      body_truncated: body.truncated,
      title_truncated: title.truncated,
      threads: (node.reviewThreads?.nodes || []).filter(t => !t.isResolved).map(t => {
        const c = t.comments?.nodes?.[0]
        const text = bounded(c?.bodyText, EXCERPT_MAX)
        return { path: sanitize(t.path || ''), author: sanitize(c?.author?.login || ''), excerpt: text.text, truncated: text.truncated }
      }),
    },
    fetched_at: fetchedAt,
  }
}

/**
 * Partition key: host, account and repo never share a cache slot.
 *
 * @param {{host: string, account: string, repo: string}} ref
 */
export function evidencePartition(ref) {
  return createHash('sha256').update(JSON.stringify([ref.host, ref.account, ref.repo])).digest('hex').slice(0, 16)
}

/**
 * In-memory evidence cache partitioned by host, account and repository. Entries
 * past the TTL are returned flagged `stale` so the UI can show reduced
 * reliability; they are never silently served as fresh.
 *
 * @param {{ttlMs?: number, max?: number}} [opts]
 */
export function createEvidenceCache({ ttlMs = 60_000, max = 200 } = {}) {
  const store = createLruCache(max)
  const accounts = new Map() // host -> last seen account login
  const keyOf = ({ host, account, repo, number }) => `${evidencePartition({ host, account, repo })}:${number ?? '*'}`
  return {
    knownAccount: host => accounts.get(host) || null,
    get(ref, now = Date.now()) {
      const entry = store.get(keyOf(ref))
      if (!entry) return null
      return { value: entry.value, stale: now - entry.at > ttlMs, age_ms: now - entry.at }
    },
    set(ref, value, now = Date.now()) {
      if (ref.account && ref.account !== UNKNOWN) accounts.set(ref.host, ref.account)
      store.set(keyOf(ref), { value, at: now })
    },
    /** Counts only: no titles, bodies, logins or repository names. */
    diagnostics: () => ({ entries: store.size, hosts: accounts.size }),
  }
}
