// GHES schema compatibility: a fake gh that answers like an older GitHub Enterprise Server,
// rejecting each newer field with the real error text, proves every flow still works and says
// "unknown" where the data cannot be had. github.com must keep the full queries.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { GhError } from './gh-error.js'

const runGh = vi.fn()
vi.mock('./core.js', () => ({ getRepo: r => r, repoPath: r => r, runGh: (...a) => runGh(...a) }))

const { listPRsPage, getPRRow, listPRs } = await import('./prs.js')
const { fetchRequiredChecks, loadEvidenceDetail, evidenceRows } = await import('./evidence-detail.js')
const { fetchReviewQueueEvidence, fetchPRReviewEvidence } = await import('./activity.js')
const { listIssueTimelinePage } = await import('./issue-timeline.js')
const { classifyGhFailure } = await import('./classify.js')
const { resetSchemaCompat, isDegraded } = await import('./schema-compat.js')

const GHES = 'ghe.corp.example'
const NOW = Date.parse('2026-11-09T12:00:00Z')

const ghError = text => new GhError({ message: `gh: ${text}`, stderr: `gh: ${text}`, exitCode: 1, args: ['api', 'graphql'] })

/** What an older GHES answers: field -> [matches the query, real error text]. */
const MISSING = {
  prLevelRollup: [q => /statusCheckRollup/.test(q) && !/commits\(/.test(q), "field 'statusCheckRollup' doesn't exist on type 'PullRequest'"],
  counts: [q => /checkRunCountsByState/.test(q), "Field 'checkRunCountsByState' doesn't exist on type 'StatusCheckRollupContextConnection'"],
  isRequired: [q => /isRequired/.test(q), "Field 'isRequired' doesn't exist on type 'CheckRun'"],
  stateReason: [q => /stateReason/.test(q), "Field 'stateReason' doesn't exist on type 'ClosedEvent'"],
}

const queries = () => runGh.mock.calls.map(c => c[0].find(a => String(a).startsWith('query=')))

/**
 * Install a fake gh that rejects the listed missing fields, otherwise answers from `answer(query)`.
 * @param {string[]} missing
 * @param {Function} answer
 */
function fakeGh(missing, answer) {
  runGh.mockImplementation(async args => {
    const q = args.find(a => String(a).startsWith('query=')) || ''
    for (const key of missing) if (MISSING[key][0](q)) throw ghError(MISSING[key][1])
    return answer(q, args)
  })
}

const rowNode = (over = {}) => ({
  __typename: 'PullRequest', number: 4, title: 't', state: 'OPEN', author: { login: 'a' },
  labels: { nodes: [] }, reviewRequests: { nodes: [] }, assignees: { nodes: [] }, autoMergeRequest: null, ...over,
})
const countsRollup = { commits: { nodes: [{ commit: { statusCheckRollup: { state: 'FAILURE', contexts: {
  checkRunCountsByState: [{ state: 'SUCCESS', count: 3 }, { state: 'FAILURE', count: 2 }, { state: 'IN_PROGRESS', count: 1 }],
  statusContextCountsByState: [{ state: 'PENDING', count: 1 }],
} } } }] } }
const nodesRollup = (nodes, totalCount = nodes.length) => ({ commits: { nodes: [{ commit: { statusCheckRollup: { state: 'FAILURE', contexts: { totalCount, nodes } } } }] } })
const CONTEXTS = [
  ...Array.from({ length: 3 }, () => ({ __typename: 'CheckRun', status: 'COMPLETED', conclusion: 'SUCCESS' })),
  ...Array.from({ length: 2 }, () => ({ __typename: 'CheckRun', status: 'COMPLETED', conclusion: 'FAILURE' })),
  { __typename: 'CheckRun', status: 'IN_PROGRESS', conclusion: null },
  { __typename: 'StatusContext', state: 'PENDING' },
]

const rowAnswer = q => {
  const rollup = /checkRunCountsByState/.test(q) ? countsRollup : nodesRollup(CONTEXTS)
  return { data: { search: { issueCount: 1, pageInfo: {}, nodes: [rowNode(rollup)] }, repository: { pullRequest: rowNode(rollup) } } }
}

beforeEach(() => { runGh.mockReset(); resetSchemaCompat(); process.env.GH_HOST = GHES })
afterEach(() => { delete process.env.GH_HOST })

describe('classifier', () => {
  it('names GraphQL schema errors as kind schema (real GHES texts)', () => {
    for (const [, text] of Object.values(MISSING)) expect(classifyGhFailure(ghError(text)).kind).toBe('schema')
    expect(classifyGhFailure(ghError("Unknown argument 'pullRequestNumber' on field 'CheckRun.isRequired'.")).kind).toBe('schema')
    expect(classifyGhFailure(ghError('HTTP 502 Bad Gateway')).kind).not.toBe('schema')
  })
})

describe('PR list and row', () => {
  it('never selects statusCheckRollup on PullRequest (it is read from the head commit)', async () => {
    fakeGh([], rowAnswer)
    await listPRsPage('o/r')
    await getPRRow('o/r', 4)
    await listPRs('o/r')
    for (const q of queries()) {
      expect(q).toMatch(/commits\(last: 1\)/)
      // every rollup sits inside `commit { ... }`
      expect(q).not.toMatch(/autoMergeRequest \{ enabledAt \}\s*statusCheckRollup/)
      expect(q).not.toMatch(/url\s+statusCheckRollup|\)\s*\{\s*statusCheckRollup/)
    }
  })

  it('a host rejecting PullRequest.statusCheckRollup works with the commit-level rollup', async () => {
    fakeGh(['prLevelRollup'], rowAnswer)
    const page = await listPRsPage('o/r')
    expect(page.items[0].checkSummary).toEqual({ total: 7, failing: 2, pending: 2 })
    expect(runGh).toHaveBeenCalledTimes(1)
  })

  it('without counts-by-state: retries once with context nodes, same counters, memoized per host', async () => {
    fakeGh(['counts'], rowAnswer)
    const page = await listPRsPage('o/r')
    expect(runGh).toHaveBeenCalledTimes(2) // the full query, then the compatible one
    expect(queries()[0]).toMatch(/checkRunCountsByState/)
    expect(queries()[1]).not.toMatch(/checkRunCountsByState/)
    expect(page.items[0].checkSummary).toEqual({ total: 7, failing: 2, pending: 2 })
    expect(isDegraded('rollupCounts', GHES)).toBe(true)

    runGh.mockClear()
    await getPRRow('o/r', 4) // a different read of the same capability goes straight to the compatible query
    expect(runGh).toHaveBeenCalledTimes(1)
    expect(queries()[0]).not.toMatch(/checkRunCountsByState/)
  })

  it('flags counts as lower bounds when more checks exist than were read (never a silent total)', async () => {
    fakeGh(['counts'], () => ({ data: { search: { issueCount: 1, pageInfo: {}, nodes: [rowNode(nodesRollup(CONTEXTS, 250))] } } }))
    const page = await listPRsPage('o/r')
    expect(page.items[0].checkSummary).toEqual({ total: 250, failing: 2, pending: 2, partial: true })
  })

  it('the legacy list reads the commit-level rollup', async () => {
    fakeGh(['prLevelRollup'], () => ({ data: { search: { nodes: [rowNode(nodesRollup([{ __typename: 'CheckRun', name: 'CI', status: 'COMPLETED', conclusion: 'FAILURE' }]))], pageInfo: {} } } }))
    const rows = await listPRs('o/r')
    expect(rows[0].statusCheckRollup).toEqual([expect.objectContaining({ name: 'CI', conclusion: 'FAILURE' })])
  })

  it('a schema error naming a field with no variant is thrown, not retried', async () => {
    runGh.mockRejectedValue(ghError("Field 'somethingElse' doesn't exist on type 'PullRequest'"))
    await expect(listPRsPage('o/r')).rejects.toThrow(/somethingElse/)
    expect(runGh).toHaveBeenCalledTimes(1)
  })
})

describe('evidence detail, queue and checks', () => {
  const prNode = (over = {}) => ({
    number: 7, title: 'T', url: 'https://ghe/o/r/pull/7', state: 'OPEN', isDraft: false, updatedAt: '2026-11-09T00:00:00Z',
    headRefOid: 'h2', baseRefName: 'main', mergeable: 'MERGEABLE', reviewDecision: 'APPROVED', additions: 1, deletions: 1, changedFiles: 1,
    body: 'b', author: { login: 'dev', __typename: 'User' }, repository: { nameWithOwner: 'o/r' },
    reviewRequests: { pageInfo: { hasNextPage: false }, nodes: [] },
    latestOpinionatedReviews: { pageInfo: { hasNextPage: false }, nodes: [] },
    reviewThreads: { totalCount: 0, pageInfo: { hasNextPage: false }, nodes: [] },
    commits: { nodes: [{ commit: { oid: 'h2', statusCheckRollup: { state: 'SUCCESS', contexts: { totalCount: 1, nodes: [{ __typename: 'CheckRun', status: 'COMPLETED', conclusion: 'SUCCESS' }] } } } }] },
    ...over,
  })
  const answer = q => {
    if (/isRequired/.test(q)) return { data: { repository: { pullRequest: { headRefOid: 'h2', commits: { nodes: [{ commit: { statusCheckRollup: { contexts: { totalCount: 1, pageInfo: { hasNextPage: false }, nodes: [{ __typename: 'CheckRun', name: 'build', status: 'COMPLETED', conclusion: 'SUCCESS', isRequired: true }] } } } }] } } } } }
    if (/files\(first/.test(q)) return { data: { repository: { pullRequest: { headRefOid: 'h2', files: { totalCount: 1, pageInfo: { hasNextPage: false }, nodes: [{ path: 'a.js', additions: 1, deletions: 0, changeType: 'MODIFIED' }] } } } } }
    if (/reviewQuery|\$reviewQuery/.test(q)) return { data: { viewer: { login: 'me' }, reviewRequested: { issueCount: 1, pageInfo: { hasNextPage: false }, nodes: [{ __typename: 'PullRequest', ...prNode() }] }, authored: { issueCount: 0, pageInfo: { hasNextPage: false }, nodes: [] } } }
    return { data: { viewer: { login: 'me' }, repository: { pullRequest: prNode() } } }
  }

  it('queue and evidence use the commit-level rollup and need nothing newer', async () => {
    fakeGh(['prLevelRollup', 'counts', 'isRequired'], (q, a) => answer(q, a))
    // The queue and record documents contain no isRequired, so they are unaffected by it.
    const queue = await fetchReviewQueueEvidence({ now: () => NOW })
    expect(queue.items).toHaveLength(1)
    const record = await fetchPRReviewEvidence('o/r', 7, { now: () => NOW })
    expect(record.facts.checks.value).not.toBe('unknown')
  })

  it('a host without isRequired: required checks are unknown with the reason, the rest still loads', async () => {
    fakeGh(['isRequired'], answer)
    const detail = await loadEvidenceDetail('o/r', 7, { now: () => NOW })
    expect(detail.required_checks.value).toBe('unknown')
    expect(detail.errors).toEqual([{ part: 'required_checks', message: expect.stringMatching(/unavailable on ghe\.corp\.example.*isRequired/) }])
    expect(detail.files.value.items).toHaveLength(1)
    const rows = evidenceRows(detail, { now: NOW })
    expect(rows.some(r => /unknown/.test(r.value) && /required/i.test(r.label + r.section))).toBe(true)

    // Memoized: the next read does not send the failing query again.
    runGh.mockClear()
    await expect(fetchRequiredChecks('o/r', 7, { now: () => NOW })).rejects.toThrow(/unavailable on ghe\.corp\.example/)
    expect(runGh).not.toHaveBeenCalled()
  })
})

describe('issue timeline', () => {
  it('a host without ClosedEvent.stateReason retries once without it', async () => {
    fakeGh(['stateReason'], () => ({ data: { viewer: { login: 'me' }, repository: { issue: { timelineItems: { totalCount: 1, pageInfo: { hasNextPage: false }, nodes: [{ __typename: 'ClosedEvent', id: 'X', createdAt: 't', actor: { login: 'b' }, closer: null }] } } } } }))
    const res = await listIssueTimelinePage('o/r', 7)
    expect(res.items).toHaveLength(1)
    expect(runGh).toHaveBeenCalledTimes(2)
    expect(queries()[1]).not.toMatch(/stateReason/)
  })
})

describe('github.com', () => {
  it('keeps the full queries and adds no call: a schema error there is not retried or memoized', async () => {
    process.env.GH_HOST = 'github.com'
    fakeGh([], rowAnswer)
    await listPRsPage('o/r')
    expect(runGh).toHaveBeenCalledTimes(1)
    expect(queries()[0]).toMatch(/checkRunCountsByState/)
    expect(queries()[0]).toMatch(/statusContextCountsByState/)

    runGh.mockReset()
    fakeGh(['counts'], rowAnswer)
    await expect(listPRsPage('o/r')).rejects.toThrow(/checkRunCountsByState/)
    expect(runGh).toHaveBeenCalledTimes(1)
    expect(isDegraded('rollupCounts', 'github.com')).toBe(false)
  })

  it('unset GH_HOST means github.com', async () => {
    delete process.env.GH_HOST
    fakeGh([], rowAnswer)
    await listPRsPage('o/r')
    expect(queries()[0]).toMatch(/checkRunCountsByState/)
  })
})
