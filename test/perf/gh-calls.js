// gh spawns per journey (#622): drives the built dist/lazyhub.js in a PTY against the generated
// `perf` fake gh (test/perf/vitals-lib.js, one {t, args} line per call) and asserts the EXACT number
// of gh processes each journey starts. Every call is a child process, which is what costs on a
// 2-core machine, so a new or duplicated call fails this run instead of slipping in.
//
// Counts on main before #622 are kept in BEFORE so the reduction stays visible. To change an
// expected count, change EXPECTED here on purpose and say why in the PR: never raise one to make a
// run pass.
//
// Run: npm run build && node test/perf/gh-calls.js   (part of npm run test:perf)
import { existsSync } from 'fs'
import pty from 'node-pty'
import { nodePtyProblem, skipOrFail } from '../pty/fixtures.js'
import { BIN, ROOT, VitalsSession, sleep } from './vitals-lib.js'

/** gh calls per journey on main before #622. */
export const BEFORE = { startup: 5, 'open PR list': 3, 'open PR detail': 4, 'back to list': 0, 'issues list': 1, 'reopen PR list': 0 }

/**
 * gh calls per journey now, with what they are:
 * - startup: `gh --version`, `gh auth token` (bootstrap probes), then the Focus panes (assigned
 *   issues, my PRs, review requests).
 * - open PR list: the first page, which also carries the repository info the list needs (was a
 *   separate `gh repo view`), and the diff-file prefetch for the PR under the cursor (#482).
 * - open PR detail: `gh pr view`, branch protection and the head's check runs; the check runs reuse
 *   the head commit of the `pr view` in flight (was a second `pr view --json headRefOid`).
 * - back to list, reopen PR list: served from the cache.
 * - issues list: the first page.
 */
export const EXPECTED = { startup: 5, 'open PR list': 2, 'open PR detail': 3, 'back to list': 0, 'issues list': 1, 'reopen PR list': 0 }

const problem = nodePtyProblem(pty, ROOT)
if (problem) skipOrFail(`node-pty cannot spawn: ${problem}`)
if (!existsSync(BIN)) skipOrFail('dist/lazyhub.js is missing: run npm run build first')

const listData = text => /\b\d+ of 5000\b/.test(text)
const issueData = text => /\b\d+ of 2000\b/.test(text)
/** Short, argument-free description of a call for the failure message. */
const describe = c => {
  const query = (c.args.find(a => a.startsWith('query=')) ?? '').replace(/\s+/g, ' ').slice(6, 70)
  return `${c.args.slice(0, 3).filter(a => !a.startsWith('-')).join(' ')}${query ? ` ${query}` : ''}`
}

const session = new VitalsSession({ cols: 100, rows: 30 }).start()
const results = []
let since = 0
/** Run a journey, let its background reads settle, and count the gh calls it started. */
async function journey(name, run, settleMs = 2500) {
  const from = since
  await run()
  await sleep(settleMs)
  const calls = session.calls().filter(c => c.t >= from)
  since = Date.now()
  results.push({ name, count: calls.length, calls: calls.map(describe) })
}

try {
  await journey('startup', () => session.waitFor(text => text.includes('My open PRs'), 'the Focus screen'))
  await journey('open PR list', async () => { await session.press('gp'); await session.waitFor(listData, 'the PR list rows') })
  await journey('open PR detail', async () => { await session.press('\r'); await session.waitFor(text => !listData(text), 'the PR detail') }, 3500)
  await journey('back to list', async () => { await session.press('\x1b'); await session.waitFor(listData, 'the PR list after back') })
  await journey('issues list', async () => { await session.press('gi'); await session.waitFor(issueData, 'the issue list rows') })
  await journey('reopen PR list', async () => { await session.press('gp'); await session.waitFor(listData, 'the PR list again') })
} finally {
  session.stop()
}

let failures = 0
process.stdout.write('gh calls per journey (fake gh, 300 ms/call)\n')
for (const r of results) {
  const want = EXPECTED[r.name]
  const ok = r.count === want
  if (!ok) failures += 1
  process.stdout.write(`  ${r.name.padEnd(16)} ${String(r.count).padStart(2)}  expected ${want}  (main before #622: ${BEFORE[r.name]})  ${ok ? 'ok' : 'FAIL'}\n`)
  if (!ok) for (const c of r.calls) process.stdout.write(`      ${c}\n`)
}
process.exit(failures ? 1 : 0)
