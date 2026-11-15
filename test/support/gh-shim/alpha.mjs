// Review Alpha journey fixture set (#295): the review queue, the evidence view and PR detail, served
// over the same shim engine as pty.mjs. Everything it does not handle falls through to pty.mjs
// (Focus dashboard, auth, repo, branches, ...), so the journey starts on a normal Focus screen.
//
// Queue (three PRs, one per interesting reason):
//   acme/platform#412 "Retry in webhook sender"  review requested of you, CI passing
//   acme/ledger#88    "New form lib"             review requested via a team; its file list cannot be read
//                                                 (partial evidence: the Files rows say unknown)
//   acme/platform#409 "Shard the worker queue"   authored by you, one failing check
//   acme/platform#77  "Second page PR"           on the second page of review requests (loaded by `+`)
//
// Env hooks (all optional):
//   LAZYHUB_GH_LOG                the argv of every call, one JSON array per line (assert no write)
//   LAZYHUB_ALPHA_QUEUE=empty     the queue searches return nothing
//   LAZYHUB_ALPHA_QUEUE=rate      the queue search fails with GitHub's GraphQL rate-limit wording
//   LAZYHUB_ALPHA_QUEUE=auth      the queue search fails as if gh were not signed in
//   LAZYHUB_ALPHA_HOSTILE=1       every GitHub-authored string carries terminal control sequences
import { appendFileSync } from 'node:fs'
import { node, requestedTeam, requestedUser, checkRollup, PASS, FAIL } from '../../../src/features/queue/queue.fixtures.js'
import { GH_STDERR } from '../../../src/executor/gh-stderr-fixtures.js'
import pty from './pty.mjs'

/** Control sequences a hostile PR author could plant: OSC 52 (clipboard), OSC 8 (link), CSI (cursor/clear), BEL, raw ESC. */
export const HOSTILE = '\x1b]52;c;cHduZWQ=\x07\x1b]8;;https://evil.example/x\x07LINK\x1b]8;;\x07\x1b[999;999H\x1b[2J\x1b[?1049l\x07\x1bZ'
const hostile = process.env.LAZYHUB_ALPHA_HOSTILE === '1'
const h = text => (hostile ? `${text}${HOSTILE}` : text)
const SHA = n => String(n).padStart(7, '0') + 'f'.repeat(33)

const prs = () => [
  node({
    number: 412, title: h('Retry in webhook sender'), updatedAt: '2026-11-08T12:00:00Z', repository: { nameWithOwner: 'acme/platform' },
    author: { login: h('alice'), __typename: 'User' }, headRefOid: SHA(412), reviewRequests: requestedUser('octocat'),
    commits: { nodes: [{ commit: { oid: SHA(412), statusCheckRollup: checkRollup('SUCCESS', [PASS, PASS]) } }] },
    reviewThreads: { totalCount: 1, pageInfo: { hasNextPage: false }, nodes: [{ isResolved: false, path: h('src/retry.js'), comments: { nodes: [{ bodyText: h('Please bound the retries'), author: { login: h('bob') } }] } }] },
  }),
  node({
    number: 88, title: h('New form lib'), updatedAt: '2026-11-07T12:00:00Z', repository: { nameWithOwner: 'acme/ledger' },
    headRefOid: SHA(88), reviewRequests: requestedTeam(h('acme/core')),
    commits: { nodes: [{ commit: { oid: SHA(88), statusCheckRollup: checkRollup('SUCCESS', [PASS]) } }] },
  }),
  node({
    number: 409, title: h('Shard the worker queue'), updatedAt: '2026-11-06T12:00:00Z', repository: { nameWithOwner: 'acme/platform' },
    headRefOid: SHA(409), commits: { nodes: [{ commit: { oid: SHA(409), statusCheckRollup: checkRollup('FAILURE', [PASS, FAIL]) } }] },
  }),
].map(pr => ({ __typename: 'PullRequest', ...pr }))
const rateLimit = { cost: 1, remaining: 4000, resetAt: '2026-11-09T11:00:00Z' }
const viewer = { login: 'octocat' }
const queryOf = args => (args.find(a => a.startsWith('query=')) || '').slice(6)
const field = (args, name) => (args.find(a => a.startsWith(`${name}=`)) || '').slice(name.length + 1)

function failQueue(mode) {
  const fixture = mode === 'auth' ? GH_STDERR.not_signed_in : { stderr: GH_STDERR.rate_graphql.stderr, exitCode: 1 }
  process.stderr.write(fixture.stderr)
  process.exit(fixture.exitCode)
}

export default function handle(args, out) {
  const [a0, a1] = args
  // One log line per call, written here; pty.mjs would write a second one for calls it serves.
  if (process.env.LAZYHUB_GH_LOG) appendFileSync(process.env.LAZYHUB_GH_LOG, `${JSON.stringify(args)}\n`)
  if (a0 === 'api' && a1 === 'graphql') {
    const query = queryOf(args)
    const number = Number(field(args, 'number'))
    const repo = `${field(args, 'owner')}/${field(args, 'name')}`
    const pr = prs().find(p => p.number === number && p.repository.nameWithOwner === repo)
    if (query.includes('reviewRequested: search')) {
      const mode = process.env.LAZYHUB_ALPHA_QUEUE
      if (mode === 'auth' || mode === 'rate') failQueue(mode)
      // A repo:owner/name qualifier in the search narrows the result, as GitHub does (the repo scope of the queue).
      const only = /(?:^|\s)repo:(\S+)/.exec(field(args, 'reviewQuery'))?.[1]
      const all = mode === 'empty' ? [] : prs().filter(p => !only || p.repository.nameWithOwner === only)
      // The review-requested search has a second page (cursor c1) holding one more PR, so `+` has something to load.
      const second = field(args, 'reviewAfter') === 'c1'
      const group = (list, more) => ({ issueCount: list.length + (more ? 1 : 0), pageInfo: { hasNextPage: more, endCursor: more ? 'c1' : null }, nodes: list })
      const requested = second
        ? [{ __typename: 'PullRequest', ...node({ number: 77, title: h('Second page PR'), updatedAt: '2026-11-05T12:00:00Z', repository: { nameWithOwner: 'acme/platform' }, headRefOid: SHA(77), reviewRequests: requestedUser('octocat') }) }]
        : all.filter(p => p.number !== 409)
      out({ data: { viewer, rateLimit, reviewRequested: group(requested, !second && mode !== 'empty'), authored: group(all.filter(p => p.number === 409), false) } })
    }
    if (query.includes('pullRequest(number: $number) { ...EvidenceFields body }') || /EvidenceFields body/.test(query)) {
      out({ data: { viewer, rateLimit, repository: { pullRequest: pr ? { ...pr, body: h(`Body of ${pr.number}\nsecond line`) } : null } } })
    }
    if (query.includes('files(first: $limit')) {
      if (repo === 'acme/ledger') { process.stderr.write('gh: Something went wrong while reading the file list (HTTP 502)\n'); process.exit(1) }
      out({ data: { repository: { pullRequest: { headRefOid: pr?.headRefOid, files: { totalCount: 2, pageInfo: { hasNextPage: false, endCursor: null }, nodes: [
        { path: h('src/retry.js'), additions: 12, deletions: 2, changeType: 'MODIFIED' }, { path: 'docs/retry.md', additions: 4, deletions: 0, changeType: 'ADDED' },
      ] } } } } })
    }
    if (query.includes('isRequired(pullRequestNumber')) {
      const failing = number === 409
      out({ data: { repository: { pullRequest: { headRefOid: pr?.headRefOid, commits: { nodes: [{ commit: { statusCheckRollup: { contexts: { totalCount: 1, pageInfo: { hasNextPage: false }, nodes: [
        { __typename: 'CheckRun', name: h('test (20)'), status: 'COMPLETED', conclusion: failing ? 'FAILURE' : 'SUCCESS', isRequired: true },
      ] } } } }] } } } } })
    }
  }
  // The PR detail (Enter in the evidence view) and its checks: hostile text in the branch name, body, check name and log.
  if (hostile) {
    if (a0 === 'pr' && a1 === 'view') {
      const n = Number(args[2])
      out({ number: n, title: h(`PR ${n}`), state: 'OPEN', isDraft: false, updatedAt: '2026-11-06T12:00:00Z', url: `https://github.com/acme/platform/pull/${n}`,
        author: { login: h('alice') }, labels: [{ name: h('label') }], assignees: [], reviews: [], reviewRequests: [], files: [], statusCheckRollup: [],
        baseRefName: h('main'), headRefName: h('feature/hostile'), headRefOid: SHA(n), mergeable: 'MERGEABLE', mergeStateStatus: 'CLEAN', body: h(`Body ${n}`),
        additions: 1, deletions: 0, changedFiles: 1 })
    }
    if (a0 === 'api' && /check-runs\?/.test(a1 || '')) out([{ id: 9001, name: h('test (20)'), status: 'completed', conclusion: 'failure', appName: 'GitHub Actions', url: 'https://github.com/acme/platform/actions/runs/1/job/9001' }])
    if (a0 === 'run' && a1 === 'view' && args.includes('--log-failed')) out(`test\tRun npm test\t2026-11-06T12:00:00Z AssertionError: ${h('boom')}\n`)
  }
  // The repository this fixture's account works in (the launch directory's origin is acme/platform).
  if (a0 === 'repo' && a1 === 'view') out({ name: 'platform', owner: { login: 'acme' }, nameWithOwner: 'acme/platform' })
  if (a0 === 'api' && a1?.startsWith('user/repos')) out([{ full_name: 'acme/platform' }])
  if (a0 === 'repo' && a1 === 'list') out([{ name: 'platform', nameWithOwner: 'acme/platform' }])
  delete process.env.LAZYHUB_GH_LOG
  return pty(args, out)
}
