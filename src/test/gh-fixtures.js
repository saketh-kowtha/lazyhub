// Deterministic `gh` fixtures for the model-free QA suites (screen matrix, random keys).
//
// Install `routeExeca` as the mock for the `execa` module and the real executor,
// useGh cache and panes run unmodified against canned GitHub data. Nothing here
// touches the network: unknown commands resolve to an empty result and are recorded
// in `unrouted` so a suite can assert it never reached for anything unexpected.
//
// The data is deliberately awkward (CJK, emoji, long titles/branches/labels) so a
// layout that only works for short ASCII fails.

const LONG = 'Rework the incremental diff renderer so very long titles that never fit on a single terminal row still truncate cleanly'
const CJK = '修复宽字符截断问题：这是一个非常长的中文标题，用来检查终端显示宽度计算是否正确'
const EMOJI = 'Ship 🚀 the 🎉 release ✅ checklist 👩‍💻 with ZWJ and flags 🇯🇵'

export const PR_NODES = [
  prNode(101, LONG, 'alice', { reviewDecision: 'APPROVED', ci: 'SUCCESS' }),
  prNode(102, CJK, 'bob-with-an-unreasonably-long-login-name', { reviewDecision: 'CHANGES_REQUESTED', ci: 'FAILURE', isDraft: true }),
  prNode(103, EMOJI, 'carol', { reviewDecision: 'REVIEW_REQUIRED', ci: 'PENDING' }),
  prNode(104, 'Short title', 'dave', { ci: 'SUCCESS' }),
  ...Array.from({ length: 30 }, (_, i) => prNode(110 + i, `Bulk pull request number ${i} to force scrolling`, 'erin', { ci: i % 2 ? 'SUCCESS' : 'FAILURE' })),
]

function prNode(number, title, login, { reviewDecision = null, ci = 'SUCCESS', isDraft = false } = {}) {
  return {
    __typename: 'PullRequest',
    number,
    title,
    state: 'OPEN',
    author: { login },
    labels: { nodes: [{ name: 'a-very-long-label-name-that-keeps-going', color: 'd73a4a' }, { name: 'bug 🐛', color: '0e8a16' }] },
    reviewRequests: { nodes: [{ requestedReviewer: { __typename: 'User', login: 'reviewer-one', name: 'Reviewer One' } }] },
    statusCheckRollup: { contexts: { nodes: [{ __typename: 'CheckRun', name: 'build', status: 'COMPLETED', conclusion: ci === 'PENDING' ? null : ci, startedAt: '2026-06-06T10:00:00Z', completedAt: '2026-06-06T10:05:00Z' }] } },
    reviewDecision,
    updatedAt: '2026-06-06T10:00:00Z',
    isDraft,
    headRefName: `feature/${'very-long-branch-segment-'.repeat(3)}${number}`,
    baseRefName: 'main',
    assignees: { nodes: [{ login: 'alice', name: 'Alice' }] },
    body: `Body of PR ${number}.\n\n${LONG}\n\n- [x] one\n- [ ] two\n\n\`\`\`js\nconst x = 1\n\`\`\``,
    mergeable: 'MERGEABLE',
    autoMergeRequest: null,
    url: `https://example.test/owner/repo/pull/${number}`,
  }
}

export const ISSUES = [
  issue(201, LONG, 'alice'),
  issue(202, CJK, 'bob'),
  issue(203, EMOJI, 'carol'),
  ...Array.from({ length: 30 }, (_, i) => issue(210 + i, `Bulk issue ${i}`, 'dave')),
]

function issue(number, title, login) {
  return {
    number,
    title,
    state: 'OPEN',
    author: { login },
    labels: [{ name: 'p1', color: 'd73a4a' }, { name: 'a-label-with-a-really-long-name', color: '0e8a16' }],
    assignees: [{ login: 'alice' }],
    updatedAt: '2026-06-06T10:00:00Z',
    body: `Issue ${number} body.\n\n${LONG}`,
    milestone: { title: 'v1.0' },
    comments: [{ author: { login: 'bob' }, body: 'A comment', createdAt: '2026-06-06T10:00:00Z' }],
    url: `https://example.test/owner/repo/issues/${number}`,
  }
}

export const BRANCHES = [
  { name: 'main', protected: true, commit: { sha: 'a'.repeat(40) } },
  { name: 'feature/' + 'x'.repeat(80), protected: false, commit: { sha: 'b'.repeat(40) } },
  { name: 'fix/汉字-branch', protected: false, commit: { sha: 'c'.repeat(40) } },
  ...Array.from({ length: 40 }, (_, i) => ({ name: `topic/${i}`, protected: false, commit: { sha: String(i).padStart(40, 'd') } })),
]

export const RUNS = [
  run(301, 'CI', 'completed', 'failure'),
  run(302, 'Release pipeline with a very long workflow name that overflows', 'in_progress', null),
  run(303, 'Lint', 'completed', 'success'),
  ...Array.from({ length: 30 }, (_, i) => run(310 + i, `Nightly ${i}`, 'completed', 'success')),
]

function run(databaseId, workflowName, status, conclusion) {
  return {
    databaseId, name: workflowName, workflowName, status, conclusion, event: 'push',
    headBranch: 'feature/' + 'y'.repeat(40),
    createdAt: '2026-06-06T10:00:00Z', updatedAt: '2026-06-06T10:05:00Z',
    url: `https://example.test/owner/repo/actions/runs/${databaseId}`,
  }
}

export const NOTIFICATIONS = [
  note('n1', 'PullRequest', LONG, true),
  note('n2', 'Issue', CJK, true),
  note('n3', 'Release', EMOJI, false),
  ...Array.from({ length: 30 }, (_, i) => note(`m${i}`, 'Issue', `Notification ${i}`, i % 2 === 0)),
]

function note(id, type, title, unread) {
  return {
    id, unread, reason: 'review_requested',
    subject: { title, type, url: 'https://api.example.test/repos/owner/repo/pulls/1' },
    repository: { fullName: 'owner/repo', name: 'repo' },
    updatedAt: '2026-06-06T10:00:00Z',
  }
}

export const DIFF = [
  'diff --git a/src/a.js b/src/a.js',
  'index 1111111..2222222 100644',
  '--- a/src/a.js',
  '+++ b/src/a.js',
  '@@ -1,6 +1,7 @@',
  ' const a = 1',
  `-const old = '${'o'.repeat(220)}'`,
  `+const next = '${'n'.repeat(220)}'`,
  `+const cjk = '${'汉字'.repeat(60)}'`,
  '+\tconst tabbed = 1',
  ' const b = 2',
  ' const c = 3',
  'diff --git a/docs/b.md b/docs/b.md',
  'index 3333333..4444444 100644',
  '--- a/docs/b.md',
  '+++ b/docs/b.md',
  '@@ -1,2 +1,2 @@',
  '-old doc',
  '+new doc',
  ' tail',
].join('\n')

const PR_DETAIL = {
  ...(() => {
    const n = PR_NODES[0]
    return {
      number: n.number, title: n.title, state: n.state, author: n.author, body: n.body,
      labels: n.labels.nodes, reviewRequests: [{ login: 'reviewer-one' }],
      reviews: [{ author: { login: 'reviewer-one' }, state: 'APPROVED', body: 'LGTM' }],
      statusCheckRollup: [{ name: 'build', status: 'COMPLETED', conclusion: 'SUCCESS' }, { name: 'lint-with-a-long-name', status: 'COMPLETED', conclusion: 'FAILURE' }],
      updatedAt: n.updatedAt, isDraft: false, headRefName: n.headRefName, baseRefName: 'main',
      headRefOid: 'e'.repeat(40), assignees: n.assignees.nodes,
      files: [{ path: 'src/a.js', additions: 3, deletions: 1 }, { path: 'docs/b.md', additions: 1, deletions: 1 }],
      additions: 4, deletions: 2, changedFiles: 2, mergeStateStatus: 'CLEAN', mergeable: 'MERGEABLE',
      autoMergeRequest: null, url: n.url,
    }
  })(),
}

/** Commands that reached the router and matched nothing (inspect in tests). */
export const unrouted = []
/** Every command seen, for asserting hermeticity. */
export const seen = []

function json(value) { return { stdout: JSON.stringify(value), stderr: '', exitCode: 0 } }
function text(value) { return { stdout: value, stderr: '', exitCode: 0 } }

/**
 * Stand-in for `execa(cmd, args)`: routes by argv and answers with canned data.
 * @param {string} cmd
 * @param {string[]} args
 */
export function routeExeca(cmd, args = []) {
  const line = [cmd, ...args].join(' ')
  seen.push(line)
  const result = route(cmd, args)
  if (result === undefined) {
    unrouted.push(line.slice(0, 160))
    return thenable(json([]))
  }
  return thenable(result)
}

function thenable(result) {
  const p = Promise.resolve(result)
  p.stdin = { write() {}, end() {} }
  return p
}

function route(cmd, args) {
  if (cmd === 'git') {
    if (args[0] === 'branch') return text('main')
    return text('')
  }
  if (cmd === 'open' || cmd === 'xdg-open' || cmd === 'pbcopy') return text('')
  if (cmd !== 'gh') return undefined
  const [a, b] = args
  if (a === 'api' && b === 'graphql') {
    const q = args.find(x => String(x).startsWith('searchQuery=')) || ''
    if (/is:issue/.test(q)) return json({ data: { search: { pageInfo: { hasNextPage: false }, nodes: [] } } })
    return json({ data: { search: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: PR_NODES } } })
  }
  if (a === 'api' && /^repos\/[^/]+\/[^/]+\/branches\?/.test(b)) return json(BRANCHES)
  if (a === 'api' && /\/branches\/.+\/protection/.test(b)) return json({ required_status_checks: null })
  if (a === 'api' && /\/branches\//.test(b)) return json(BRANCHES[0])
  if (a === 'api' && b === 'notifications') return json(NOTIFICATIONS)
  if (a === 'api' && /collaborators|assignees/.test(b)) return json([{ login: 'alice' }, { login: 'bob' }])
  if (a === 'api' && /\/labels/.test(b)) return json([{ name: 'bug', color: 'd73a4a' }, { name: 'p1', color: '0e8a16' }])
  if (a === 'api' && /check-runs|check-suites|statuses|annotations/.test(b)) return json([])
  if (a === 'api' && /\/comments|\/reviews/.test(b)) return json([])
  if (a === 'issue' && b === 'list') return json(ISSUES)
  if (a === 'issue' && b === 'view') return json(ISSUES.find(i => String(i.number) === args[2]) || ISSUES[0])
  if (a === 'pr' && b === 'view') return json(PR_DETAIL)
  if (a === 'pr' && b === 'diff') return text(DIFF)
  if (a === 'pr' && b === 'list') return json([])
  if (a === 'pr' && b === 'checks') return json([])
  if (a === 'run' && b === 'list') return json(RUNS)
  if (a === 'run' && b === 'view') return text('build\tStep\t2026-06-06T10:00:00Z line one\nbuild\tStep\t2026-06-06T10:00:01Z line two')
  if (a === 'repo' && b === 'view') {
    return json({ name: 'repo', owner: { login: 'owner' }, defaultBranchRef: { name: 'main' }, squashMergeAllowed: true, mergeCommitAllowed: true, rebaseMergeAllowed: true, deleteBranchOnMerge: false, viewerPermission: 'ADMIN' })
  }
  if (a === 'auth') return text('Logged in')
  // Writes: succeed silently. The executor audits them to the (temp) HOME.
  if (['close', 'merge', 'ready', 'review', 'comment', 'create', 'edit', 'checkout', 'delete', 'rerun', 'cancel'].includes(b)) return text('')
  if (a === 'api' && args.includes('--method')) return text('')
  return undefined
}
