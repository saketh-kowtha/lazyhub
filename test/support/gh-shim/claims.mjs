// Claims check fixture set (#361), served over the same shim engine as pty.mjs: PR #186 with a
// description that makes four claims (and hides a fifth in an HTML comment), its changed files with
// patches, the issue it says it fixes, and GitHub's closing-issue link. Everything else falls through
// to pty.mjs. With LAZYHUB_CLAIMS_HOSTILE=1 every GitHub-authored string carries terminal controls.
//
// Expected result: fixes #42 verified (the issue names src/parser.js), tests verified (a new it() in
// src/parser.test.js), no breaking changes contradicted (parse() changed signature), performance
// unverifiable. "2 of 4 claims verified, 1 contradicted, 1 unverifiable".
import { appendFileSync } from 'node:fs'
import pty from './pty.mjs'

/** OSC 52 (clipboard), OSC 8 (link), CSI (cursor, clear, leave alt screen), BEL, raw ESC, 8-bit CSI, bidi. */
export const HOSTILE = '\x1b]52;c;cHduZWQ=\x07\x1b]8;;https://evil.example/x\x07\x1b]8;;\x07\x1b[999;999H\x1b[2J\x1b[?1049l\x07\x1bZ\x9b31m\u202e'
const hostile = process.env.LAZYHUB_CLAIMS_HOSTILE === '1'
const h = text => (hostile ? `${text}${HOSTILE}` : text)

const BODY = [
  'Fixes #42',
  'Adds tests',
  'No breaking changes',
  'Improves performance',
  '<!-- Updates docs -->',
  '```',
  'Bump version to 9.9.9',
  '```',
  h('Notes:'),
].join('\n')

const FILES = () => [
  { path: h('src/parser.js'), status: 'modified', additions: 1, deletions: 1, patch: `@@ -10,1 +10,1 @@\n-export function parse(a) {\n+export function parse(a, b) {${h('')}`, patchTruncated: false },
  { path: 'src/parser.test.js', status: 'modified', additions: 1, deletions: 0, patch: `@@ -40,0 +41,1 @@\n+it('parses empty input${h('')}', () => {`, patchTruncated: false },
]

export default function handle(args, out) {
  const [a0, a1] = args
  if (process.env.LAZYHUB_GH_LOG) appendFileSync(process.env.LAZYHUB_GH_LOG, `${JSON.stringify(args)}\n`)
  if (a0 === 'pr' && a1 === 'view' && args.includes('closingIssuesReferences')) out({ closingIssuesReferences: [{ number: 42 }] })
  if (a0 === 'pr' && a1 === 'view') {
    out({
      number: 186, title: h('Parser: accept empty input'), state: 'OPEN', isDraft: false, updatedAt: '2026-06-13T00:00:00Z',
      url: 'https://github.com/saketh-kowtha/lazyhub/pull/186', author: { login: 'octocat' }, labels: [], assignees: [], reviews: [],
      reviewRequests: [], files: [], statusCheckRollup: [], baseRefName: 'main', headRefName: 'feature/pty', headRefOid: 'abc123',
      mergeable: 'MERGEABLE', mergeStateStatus: 'CLEAN', body: BODY, additions: 2, deletions: 1, changedFiles: 2,
    })
  }
  // gh has already applied the --jq projection: one JSON object per line.
  if (a0 === 'api' && /^repos\/[^/]+\/[^/]+\/pulls\/186\/files\?per_page=100$/.test(a1 || '') && args.includes('--paginate')) {
    out(FILES().map(f => JSON.stringify(f)).join('\n') + '\n')
  }
  if (a0 === 'issue' && a1 === 'view' && args[2] === '42') out({ number: 42, state: 'OPEN', body: h('Crash in src/parser.js on empty input') })
  delete process.env.LAZYHUB_GH_LOG
  return pty(args, out)
}
