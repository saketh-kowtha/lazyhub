// PTY E2E fixture set (test/pty/run.js): a single octocat PR, issue and CI run.
// Env hooks used by the scenarios: LAZYHUB_GH_LOG (log argv per call as JSON lines),
// LAZYHUB_GH_LATENCY_MS (slow search/list), LAZYHUB_GH_FAIL_ONCE_FILE (first search fails),
// LAZYHUB_GH_STUB_STDERR + LAZYHUB_GH_STUB_EXIT (search fails with stderr),
// LAZYHUB_GH_STUB_EMPTY (search returns no results).
import { appendFileSync, writeFileSync } from 'node:fs'
import { VITEST_LOG } from '../../../src/features/prs/ci-log.fixtures.js'

const PR = {
  number: 186,
  title: 'PTY harness fixture PR',
  state: 'OPEN',
  author: { login: 'octocat' },
  labels: [{ name: 'test' }],
  reviewRequests: [],
  statusCheckRollup: [{ state: 'SUCCESS', conclusion: 'SUCCESS' }],
  reviewDecision: 'REVIEW_REQUIRED',
  updatedAt: '2026-06-13T00:00:00Z',
  isDraft: false,
  headRefName: 'feature/pty',
  baseRefName: 'main',
  assignees: [],
  body: 'Fixture body',
  mergeable: 'MERGEABLE',
  autoMergeRequest: null,
  url: 'https://github.com/saketh-kowtha/lazyhub/pull/186',
}

const ISSUE = {
  number: 195,
  title: 'Debug state fixture issue',
  state: 'OPEN',
  author: { login: 'octocat' },
  labels: [],
  assignees: [],
  updatedAt: '2026-06-13T00:00:00Z',
  body: 'Fixture issue',
  milestone: null,
  comments: 0,
  url: 'https://github.com/saketh-kowtha/lazyhub/issues/195',
}

const RUN = { databaseId: 1, name: 'CI', status: 'completed', conclusion: 'success', workflowName: 'CI', headBranch: 'main', event: 'push', createdAt: '2026-06-13T00:00:00Z', updatedAt: '2026-06-13T00:01:00Z', url: 'https://github.com/saketh-kowtha/lazyhub/actions/runs/1' }

const searchNode = pr => ({ __typename: 'PullRequest', ...pr, labels: { nodes: pr.labels }, reviewRequests: { nodes: [] }, statusCheckRollup: { nodes: pr.statusCheckRollup }, assignees: { nodes: pr.assignees } })

export default function handle(args, out) {
  const [a0, a1] = args
  const isSearch = (a0 === 'api' && a1 === 'graphql') || (a0 === 'pr' && a1 === 'list')
  if (process.env.LAZYHUB_GH_LOG) appendFileSync(process.env.LAZYHUB_GH_LOG, `${JSON.stringify(args)}\n`)
  const latency = Number(process.env.LAZYHUB_GH_LATENCY_MS || 0)
  if (latency > 0 && isSearch) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, latency)
  if (process.env.LAZYHUB_GH_FAIL_ONCE_FILE && a0 === 'api' && a1 === 'graphql') {
    // 'wx' is atomic: of several concurrent graphql calls exactly one creates the
    // marker and fails; the rest see EEXIST and are served. A check-then-write
    // let two calls fail together, which the single-retry flow does not expect.
    let first = true
    try { writeFileSync(process.env.LAZYHUB_GH_FAIL_ONCE_FILE, 'failed', { flag: 'wx' }) } catch { first = false }
    if (first) {
      process.stderr.write('stub gh failure: rate limit\n')
      process.exit(1)
    }
  }
  if (process.env.LAZYHUB_GH_STUB_STDERR && isSearch) {
    process.stderr.write(process.env.LAZYHUB_GH_STUB_STDERR)
    process.exit(Number(process.env.LAZYHUB_GH_STUB_EXIT || 1))
  }
  if (process.env.LAZYHUB_GH_STUB_EMPTY && isSearch) out(a0 === 'pr' ? [] : { data: { search: { nodes: [] } } })
  if (args.includes('--version')) out('gh version 2.0.0\n')
  if (a0 === 'auth' && a1 === 'token') out('stub-auth\n')
  if (a0 === 'auth' && a1 === 'status') out('github.com\n  ✓ Logged in to github.com account octocat (stub)\n  - Active account: true\n')
  if (a0 === 'api' && a1 === 'user') out('octocat\n')
  if (a0 === 'api' && a1 === 'graphql') out({ data: { search: { nodes: [searchNode(PR)] } } })
  if (a0 === 'repo' && a1 === 'view') out({ name: 'lazyhub', owner: { login: 'saketh-kowtha' }, nameWithOwner: 'saketh-kowtha/lazyhub' })
  if (a0 === 'api' && a1?.startsWith('user/repos')) out([{ full_name: 'saketh-kowtha/lazyhub' }])
  if (a0 === 'repo' && a1 === 'list') out([{ name: 'lazyhub', nameWithOwner: 'saketh-kowtha/lazyhub' }])
  if (a0 === 'pr' && a1 === 'list') out([PR])
  if (a0 === 'pr' && a1 === 'view') out({ ...PR, reviews: [], files: [], additions: 1, deletions: 0, changedFiles: 1, mergeStateStatus: 'CLEAN', headRefOid: 'abc123' })
  if (a0 === 'issue' && a1 === 'list') out([ISSUE])
  if (a0 === 'issue' && a1 === 'view') out(ISSUE)
  if (a0 === 'run' && a1 === 'list') out([RUN])
  // Failing-check fixture (#359): the failed-step log of job 9001.
  if (a0 === 'run' && a1 === 'view' && args.includes('--log-failed')) out(VITEST_LOG + '\n')
  if (a0 === 'api' && a1 === 'notifications') out([])
  if (a0 === 'api' && /^repos\/[^/]+\/[^/]+\/issues\/\d+$/.test(a1 || '')) out('true\n')
  if (a0 === 'api' && /\/branches/.test(a1 || '')) out([{ name: 'main', protected: true, commit: { sha: 'abc123' } }, { name: 'feature/pty', protected: false, commit: { sha: 'def456' } }])
}
