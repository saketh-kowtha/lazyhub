// Large-repo fixture set for the performance and completeness budgets (#510, test/perf/run.js).
//
// Everything is generated from the row index, so the data is deterministic and nothing big is
// committed. It models GitHub's behaviour that matters for completeness: search never returns
// more than SEARCH_CAP results (hasNextPage goes false while issueCount keeps the true total),
// connections page by cursor, and GitHub omits the patch of a file that is too large.
//
// Env hooks: LAZYHUB_GH_DELAY_MS (fixed delay per call, the simulated network round trip),
// LAZYHUB_GH_LOG (argv + timestamp per call, one JSON line each).
import { appendFileSync, writeSync } from 'node:fs'

export const SIZES = {
  openPrs: 5000,
  closedPrs: 80000,
  openIssues: 2000,
  conversation: 400,
  threads: 150,
  bigThreadReplies: 120,
  files: 3000,
  changedLines: 100000,
  bigFileLines: 40000,
}
export const SEARCH_CAP = 1000
// Position of the special files in the 3,000-file diff (kept near the top so a journey reaches them).
export const BIG_FILE_INDEX = 1
export const OMITTED_FILE_INDEX = 2

const LOGINS = ['octocat', 'hubot', 'mona', 'lisa', 'ada', 'linus', 'grace', 'alan']
const pick = (i, mod) => (Math.imul(i + 1, 2654435761) >>> 0) % mod
const iso = i => new Date(Date.UTC(2026, 5, 1) - i * 60000).toISOString()
const arg = (args, name) => {
  const hit = args.find(a => a.startsWith(`${name}=`))
  return hit ? hit.slice(name.length + 1) : undefined
}

const prNode = i => ({
  __typename: 'PullRequest',
  number: SIZES.openPrs - i, title: `Perf PR ${SIZES.openPrs - i} fixture`, state: 'OPEN',
  url: `https://github.com/o/r/pull/${SIZES.openPrs - i}`, updatedAt: iso(i), isDraft: i % 7 === 0,
  headRefName: `feature/perf-${SIZES.openPrs - i}`, baseRefName: 'main', reviewDecision: 'REVIEW_REQUIRED', mergeable: 'MERGEABLE',
  author: { login: LOGINS[pick(i, LOGINS.length)] }, labels: { nodes: [] }, reviewRequests: { nodes: [] },
  statusCheckRollup: { nodes: [] }, assignees: { nodes: [] },
})
const issueNode = i => ({
  __typename: 'Issue', number: SIZES.openIssues - i, title: `Perf issue ${SIZES.openIssues - i} fixture`, state: 'OPEN',
  url: `https://github.com/o/r/issues/${SIZES.openIssues - i}`, updatedAt: iso(i), body: 'Fixture issue body',
  author: { login: LOGINS[pick(i, LOGINS.length)] }, labels: { nodes: [] }, assignees: { nodes: [] }, milestone: null, comments: { totalCount: 0 },
})

/** One search page with GitHub's cap: nothing past SEARCH_CAP, hasNextPage false at the cap, issueCount the true total. */
function searchPage(args, total, make) {
  const limit = Number(arg(args, 'limit') || 50)
  const start = Number(arg(args, 'after') || 0)
  const reachable = Math.min(total, SEARCH_CAP)
  const end = Math.min(reachable, start + limit)
  const nodes = []
  for (let i = start; i < end; i++) nodes.push(make(i))
  return { data: { search: { issueCount: total, pageInfo: { hasNextPage: end < reachable, endCursor: String(end) }, nodes } } }
}

export const filePath = i => `src/perf/file${String(i).padStart(4, '0')}.js`
export const BIG_FILE_PATH = filePath(BIG_FILE_INDEX)
export const OMITTED_FILE_PATH = filePath(OMITTED_FILE_INDEX)
// 100,000 changed lines over 3,000 files, one file of 40,000 lines; the rest share the remainder.
const SMALL_FILE_LINES = Math.floor((SIZES.changedLines - SIZES.bigFileLines) / (SIZES.files - 1))
const linesOf = i => (i === BIG_FILE_INDEX ? SIZES.bigFileLines : SMALL_FILE_LINES)
const addsOf = i => linesOf(i) - Math.floor(linesOf(i) / 2)
const delsOf = i => Math.floor(linesOf(i) / 2)

function patchFor(i) {
  const n = linesOf(i)
  const body = []
  for (let k = 0; k < n; k++) body.push(k % 2 ? `-const old${i}_${k} = ${k}` : `+const next${i}_${k} = ${k}`)
  return `@@ -1,${Math.ceil(n / 2)} +1,${Math.ceil(n / 2)} @@\n${body.join('\n')}`
}

const THREAD_ID = t => `PRRT_perf_${t}`
const comment = (id, n, extra = {}) => ({ databaseId: id, body: `Perf comment ${id}`, author: { login: LOGINS[pick(id, LOGINS.length)] }, createdAt: iso(n), ...extra })
const replyCount = t => (t === 0 ? SIZES.bigThreadReplies : 1)
const reply = (t, k) => comment(100000 + t * 1000 + k, k, { path: filePath(t % 50), line: 1 + k, originalLine: 1 + k, replyTo: k ? { databaseId: 100000 + t * 1000 } : null, pullRequestReview: { databaseId: 1 } })

function threadNode(t) {
  const total = replyCount(t)
  const nodes = []
  for (let k = 0; k < Math.min(total, 50); k++) nodes.push(reply(t, k))
  return { id: THREAD_ID(t), isResolved: false, comments: { totalCount: total, pageInfo: { hasNextPage: total > 50, endCursor: total > 50 ? '50' : null }, nodes } }
}
function connection(total, after, size, make) {
  const start = Number(after || 0)
  const end = Math.min(total, start + size)
  const nodes = []
  for (let i = start; i < end; i++) nodes.push(make(i))
  return { totalCount: total, pageInfo: { hasNextPage: end < total, endCursor: end < total ? String(end) : null }, nodes }
}

function graphql(args, out) {
  const query = arg(args, 'query') || ''
  if (/files\(first/.test(query)) {
    out({ data: { repository: { pullRequest: { files: connection(SIZES.files, arg(args, 'after'), Number(arg(args, 'limit') || 100), i => ({
      path: filePath(i), additions: addsOf(i), deletions: delsOf(i), changeType: 'MODIFIED',
    })) } } } })
  }
  if (/reviewThreads\(first/.test(query)) {
    const size = Number(arg(args, 'size') || 50)
    const pr = {}
    if (arg(args, 'withThreads') === 'true') pr.reviewThreads = connection(SIZES.threads, arg(args, 'tAfter'), size, threadNode)
    if (arg(args, 'withConversation') === 'true') pr.comments = connection(SIZES.conversation, arg(args, 'cAfter'), size, i => comment(500000 + i, i))
    out({ data: { repository: { pullRequest: pr } } })
  }
  if (/node\(id/.test(query)) {
    const id = arg(args, 'id') || ''
    const t = Number(id.replace('PRRT_perf_', ''))
    const start = Number(arg(args, 'after') || 0)
    const total = replyCount(t)
    const end = Math.min(total, start + 50)
    const nodes = []
    for (let k = start; k < end; k++) nodes.push(reply(t, k))
    out({ data: { node: { id, isResolved: false, comments: { totalCount: total, pageInfo: { hasNextPage: end < total, endCursor: end < total ? String(end) : null }, nodes } } } })
  }
  const search = arg(args, 'searchQuery') || ''
  if (/\bis:pr\b/.test(search)) out(searchPage(args, /\bis:(closed|merged)\b/.test(search) ? SIZES.closedPrs : SIZES.openPrs, prNode))
  if (/search\(/.test(query)) out(searchPage(args, SIZES.openIssues, issueNode))
}

export default function handle(args, out) {
  const [a0, a1] = args
  if (process.env.LAZYHUB_GH_LOG) appendFileSync(process.env.LAZYHUB_GH_LOG, `${JSON.stringify({ t: Date.now(), args: args.map(a => (a.length > 600 ? `${a.slice(0, 600)}...` : a)) })}\n`)
  const delay = Number(process.env.LAZYHUB_GH_DELAY_MS || 0)
  if (delay > 0 && a0 !== 'auth' && !args.includes('--version')) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, delay)

  if (args.includes('--version')) out('gh version 2.0.0\n')
  if (a0 === 'auth' && a1 === 'token') out('stub-auth\n')
  if (a0 === 'auth' && a1 === 'status') out('github.com\n  ✓ Logged in to github.com account octocat (stub)\n')
  if (a0 === 'api' && a1 === 'user') out('octocat\n')
  if (a0 === 'api' && a1 === 'graphql') graphql(args, out)
  if (a0 === 'api' && /\/pulls\/\d+\/files/.test(a1 || '')) {
    const hit = /filename == "([^"]+)"/.exec(args.join(' '))
    const index = hit ? Number(/file(\d+)\.js$/.exec(hit[1])?.[1]) : NaN
    if (!Number.isInteger(index)) out('')
    const file = { filename: filePath(index), status: 'modified', additions: addsOf(index), deletions: delsOf(index) }
    // GitHub renders no patch for a file that is too large.
    if (index !== OMITTED_FILE_INDEX) file.patch = patchFor(index)
    // A 40,000-line patch is over a megabyte: write it fully (the shared out() exits at once) before exiting.
    const bytes = Buffer.from(`${JSON.stringify(file)}\n`)
    for (let at = 0; at < bytes.length;) {
      try { at += writeSync(1, bytes, at) } catch (error) { if (error.code !== 'EAGAIN') throw error }
    }
    process.exit(0)
  }
  if (a0 === 'repo' && a1 === 'view') out({ name: 'r', owner: { login: 'o' }, nameWithOwner: 'o/r' })
  if (a0 === 'pr' && a1 === 'view') {
    const n = Number(args[2])
    out({
      number: n, title: `Perf PR ${n} fixture`, state: 'OPEN', author: { login: 'octocat' }, labels: [], reviewRequests: [], statusCheckRollup: [],
      reviewDecision: 'REVIEW_REQUIRED', updatedAt: iso(0), isDraft: false, headRefName: `feature/perf-${n}`, baseRefName: 'main', assignees: [],
      body: 'Fixture body', mergeable: 'MERGEABLE', autoMergeRequest: null, url: `https://github.com/o/r/pull/${n}`,
      reviews: [], files: [], additions: SIZES.changedLines / 2, deletions: SIZES.changedLines / 2, changedFiles: SIZES.files, mergeStateStatus: 'CLEAN', headRefOid: 'abc123',
    })
  }
  if (a0 === 'api' && /\/branches/.test(a1 || '')) out([{ name: 'main', protected: true, commit: { sha: 'abc123' } }])
}
