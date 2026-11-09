// @ts-nocheck
/* eslint-disable jsdoc/require-jsdoc, jsdoc/require-param */
/**
 * Review-queue test fixtures: GraphQL PullRequest nodes run through the real evidence
 * normaliser (src/executor/evidence.js), so tests see exactly what fetchReviewQueueEvidence returns.
 */
import { normalizePullRequestEvidence } from '../../executor/evidence.js'

export const FETCHED_AT = '2026-11-09T10:00:00.000Z'

export function checkRollup(state, contexts) {
  return { state, contexts: { totalCount: contexts.length, nodes: contexts } }
}
export const PASS = { __typename: 'CheckRun', status: 'COMPLETED', conclusion: 'SUCCESS' }
export const FAIL = { __typename: 'CheckRun', status: 'COMPLETED', conclusion: 'FAILURE' }

/** A healthy, review-required PR node; override any field. */
export function node(overrides = {}) {
  return {
    number: 1, title: 'Title', url: 'https://github.com/acme/web/pull/1', state: 'OPEN', isDraft: false,
    updatedAt: '2026-11-08T10:00:00Z', headRefOid: '3fa91c2' + '0'.repeat(33), baseRefName: 'main',
    mergeable: 'MERGEABLE', reviewDecision: 'REVIEW_REQUIRED', additions: 3, deletions: 1, changedFiles: 2,
    repository: { nameWithOwner: 'acme/web' }, author: { login: 'alice', __typename: 'User' },
    reviewRequests: { pageInfo: { hasNextPage: false }, nodes: [] },
    latestOpinionatedReviews: { pageInfo: { hasNextPage: false }, nodes: [] },
    reviewThreads: { totalCount: 0, pageInfo: { hasNextPage: false }, nodes: [] },
    commits: { nodes: [{ commit: { oid: '3fa91c2' + '0'.repeat(33), statusCheckRollup: checkRollup('SUCCESS', [PASS, PASS]) } }] },
    ...overrides,
  }
}

export const requestedUser = login => ({ pageInfo: { hasNextPage: false }, nodes: [{ requestedReviewer: { __typename: 'User', login } }] })
export const requestedTeam = slug => ({ pageInfo: { hasNextPage: false }, nodes: [{ requestedReviewer: { __typename: 'Team', slug } }] })

/** Evidence record as the queue receives it; `membership` mirrors fetchReviewQueueEvidence. */
export function evidence(nodeOverrides = {}, { membership = ['authored'], account = 'octocat' } = {}) {
  const item = normalizePullRequestEvidence(node(nodeOverrides), {
    host: 'github.com', account, fetchedAt: FETCHED_AT, reviewRequestedOfMe: membership.includes('review_requested'),
    source: 'github.graphql.search',
  })
  return { ...item, membership }
}

/** A fetchReviewQueueEvidence result around `items`. */
export function queueResult(items, { truncation = {}, account = 'octocat' } = {}) {
  const one = { total: items.length, returned: items.length, has_more: false, next_cursor: null }
  return {
    schema_version: 1, kind: 'review_queue', host: 'github.com', account, fetched_at: FETCHED_AT, items,
    group_counts: {}, rate_limit: { remaining: 4000, cost: 1, reset_at: FETCHED_AT, low: false },
    truncation: { review_requested: { ...one, ...(truncation.review_requested || {}) }, authored: { ...one, ...(truncation.authored || {}) } },
  }
}

/** The five ordinary groups plus one unknown, one PR each. */
export function sampleItems() {
  return [
    evidence({ number: 412, title: 'Retry in webhook sender', updatedAt: '2026-11-08T12:00:00Z', repository: { nameWithOwner: 'acme/platform' }, reviewRequests: requestedUser('octocat') }, { membership: ['review_requested'] }),
    evidence({ number: 88, title: 'New form lib', repository: { nameWithOwner: 'acme/ledger' }, reviewRequests: requestedTeam('acme/core') }, { membership: ['review_requested'] }),
    evidence({ number: 409, title: 'Shard the worker queue', repository: { nameWithOwner: 'acme/platform' },
      commits: { nodes: [{ commit: { oid: 'b'.repeat(40), statusCheckRollup: checkRollup('FAILURE', [PASS, FAIL]) } }] } }),
    evidence({ number: 57, title: 'Upgrade to Node 22', repository: { nameWithOwner: 'acme/mailer' }, reviewDecision: 'CHANGES_REQUESTED' }),
    evidence({ number: 31, title: 'Docs sweep', repository: { nameWithOwner: 'acme/docs' } }),
    evidence({ number: 9, title: 'Bump dependencies', repository: { nameWithOwner: 'octocat/hello' }, reviewDecision: 'APPROVED' }),
    evidence({ number: 5, title: 'No data PR', repository: { nameWithOwner: 'acme/odd' }, commits: undefined, mergeable: undefined }),
  ]
}
