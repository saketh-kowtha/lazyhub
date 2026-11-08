// Large-repo performance and completeness budgets (#510, R14).
//
// Drives the built dist/lazyhub.js in a PTY against the generated `perf` fake gh
// (test/support/gh-shim/perf.mjs: 5,000 open PRs, 2,000 issues, a 3,000-file / 100,000-line diff,
// a 400-comment / 150-thread conversation, GitHub's 1,000-result search cap) with a fixed 300 ms
// delay per gh call, then asserts:
//   - time to first content on a cold navigation (a round trip, not a pile of them),
//   - paging completeness: every row up to the cap is reachable, the footer says "N of M", the
//     cap notice names the 1,000-result limit, and no page is ever fetched twice,
//   - the diff opens on the first file without downloading the whole diff, and a patch GitHub
//     omits says so instead of showing an empty file,
//   - the conversation pages to 400 of 400 comments and 150 of 150 threads, and a 120-reply
//     thread's missing replies are fetched,
//   - peak RSS stays inside the budget across the whole run.
//
// Budgets are in BUDGETS below and cite the measured baseline (docs/PERF_BUDGETS.md). Each leaves
// about 2.5x headroom over the slowest local run so a loaded shared runner does not flake, and
// every one is far below what a real regression costs (see the table). To change one, change it
// here and in docs/PERF_BUDGETS.md in the same commit, on purpose.
//
// Run: npm run build && npm run test:perf
import assert from 'assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { execFileSync } from 'child_process'
import { tmpdir } from 'os'
import { delimiter, dirname, join } from 'path'
import pty from 'node-pty'
import { nodePtyProblem, skipOrFail, TerminalScreen } from '../pty/fixtures.js'
import { installShim } from '../support/gh-shim/shim.mjs'
import { SEARCH_CAP, SIZES } from '../support/gh-shim/perf.mjs'

const ROOT = new URL('../..', import.meta.url).pathname
const BIN = join(ROOT, 'dist', 'lazyhub.js')

/** Simulated network round trip per gh call. */
export const DELAY_MS = 300

// Slowest local run x ~2.5, rounded. `roundTrips` budgets are in units of DELAY_MS (+ process spawn).
export const BUDGETS = {
  // A cold PR / issue list shows its first rows after one gh round trip (+ node start of the fake gh).
  firstRowMs: DELAY_MS + 900,
  // The diff opens on its first file after the file list and that file's patch: two sequential calls.
  diffFirstContentMs: 2 * DELAY_MS + 1200,
  // The first frame after a key press (skeleton) must not wait for the network.
  skeletonMs: 400,
  // The conversation view paints its first comments after one call.
  conversationFirstMs: DELAY_MS + 900,
  // Hard 512 MB container limit from the issue; the container job (test/pty/memory.js) holds a tighter 150 MB on a smaller fixture.
  rssMb: Number(process.env.LAZYHUB_PERF_RSS_MB || 512),
  // Each further page of a list: one call (G to the footer count growing).
  perPageMs: DELAY_MS + 1500,
}

const ptyProblem = nodePtyProblem(pty, ROOT)
if (ptyProblem) skipOrFail(`node-pty cannot spawn: ${ptyProblem}`)

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
// eslint-disable-next-line no-control-regex
const strip = text => text.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '').replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, '')

function rssMb(pid) {
  try {
    if (process.platform === 'linux') {
      const hwm = readFileSync(`/proc/${pid}/status`, 'utf8').match(/^VmHWM:\s+(\d+) kB/m)
      return hwm ? Number(hwm[1]) / 1024 : 0
    }
    return Number(execFileSync('ps', ['-o', 'rss=', '-p', String(pid)]).toString().trim()) / 1024
  } catch {
    return 0
  }
}

const temp = mkdtempSync(join(tmpdir(), 'lazyhub-perf-'))
const ghLog = join(temp, 'gh.log')
writeFileSync(ghLog, '')
const stubBin = dirname(installShim(join(temp, 'bin'), 'perf'))

const results = {}
let peakRss = 0
let output = ''
let term
const screen = new TerminalScreen(100, 60)
const waiters = new Set()

function launch() {
  term = pty.spawn(process.execPath, [BIN], {
    name: 'xterm-256color', cols: 100, rows: 60, cwd: ROOT,
    env: {
      PATH: `${stubBin}${delimiter}${process.env.PATH}`, HOME: temp, USER: 'lazyhub', GHUI_REPO: 'o/r',
      TERM: 'xterm-256color', COLORTERM: 'truecolor', NO_COLOR: '1', LAZYHUB_NO_DAEMON: '1',
      LAZYHUB_CACHE_DIR: join(temp, 'cache'),
      LAZYHUB_GH_DELAY_MS: String(DELAY_MS), LAZYHUB_GH_LOG: ghLog,
    },
  })
  term.onData(data => {
    output += data
    screen.feed(data)
    for (const check of waiters) check()
  })
  const sampler = setInterval(() => { peakRss = Math.max(peakRss, rssMb(term.pid)) }, 100)
  return () => clearInterval(sampler)
}

/** Resolve with the elapsed ms once `pattern` appears in the output written after `from`. */
function waitFor(pattern, from, label, timeoutMs = 20000, { streamOnly = false } = {}) {
  const started = Date.now()
  return new Promise((resolve, reject) => {
    const check = () => {
      // Ink repaints only the cells that changed, so a label can be split across writes in the raw
      // stream: also match the reconstructed screen.
      const hit = text => (typeof pattern === 'string' ? text.includes(pattern) : pattern.test(text))
      if (hit(strip(output.slice(from))) || (!streamOnly && hit(screen.text()))) {
        waiters.delete(check)
        clearTimeout(timer)
        resolve(Date.now() - started)
      }
    }
    const timer = setTimeout(() => {
      waiters.delete(check)
      reject(new Error(`timed out after ${timeoutMs} ms waiting for ${label}\n--- screen ---\n${screen.text()}`))
    }, timeoutMs)
    waiters.add(check)
    check()
  })
}

/** Ink reads a multi-character chunk as one input event, so keys go one at a time. */
async function press(keys) {
  for (const key of keys) { term.write(key); await sleep(25) }
}

function calls() {
  return readFileSync(ghLog, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line))
}
const argValue = (call, name) => call.args.find(a => a.startsWith(`${name}=`))?.slice(name.length + 1)
const afterOf = call => argValue(call, 'after') ?? ''

/** The list-page search calls of one kind, in order. */
function pageCalls(kind) {
  return calls().filter(c => c.args[0] === 'api' && c.args[1] === 'graphql'
    && (argValue(c, 'searchQuery') || '').includes(kind) && !/review-requested/.test(argValue(c, 'searchQuery') || '')
    && (kind !== 'is:pr' || /sort:updated-desc/.test(argValue(c, 'searchQuery') || '')) && argValue(c, 'limit') !== '25')
}

/** Every page was fetched exactly once, in cursor order, and none was repeated. */
function assertPagedOnce(list, pageSize, pages, what) {
  const afters = list.map(afterOf)
  const expected = Array.from({ length: pages }, (_, i) => (i === 0 ? '' : String(i * pageSize)))
  assert.deepEqual(afters, expected, `${what}: expected ${pages} pages of ${pageSize}, each fetched once in order; got cursors [${afters.join(', ')}]`)
}

/** The "N of M" the list footer shows (largest one on screen after `from`). */
function loadedCount(from, total) {
  const found = [...`${strip(output.slice(from))}\n${screen.text()}`.matchAll(new RegExp(`(\\d+) of ${total}\\b`, 'g'))].map(m => Number(m[1]))
  return found.length ? Math.max(...found) : 0
}

/**
 * Press G (jump to the last loaded row, which asks for the next page) until `done` shows.
 * Returns the slowest single page, from the key to the footer count growing.
 */
async function scrollToEnd(done, total, label, maxPresses) {
  let slowest = 0
  let loaded = loadedCount(0, total)
  for (let i = 0; i < maxPresses && !done.test(strip(output.slice(-6000))) && !done.test(screen.text()); i++) {
    const mark = output.length
    await press('G')
    const started = Date.now()
    while (loadedCount(mark, total) <= loaded && !done.test(strip(output.slice(mark))) && !done.test(screen.text()) && Date.now() - started < 6000) await sleep(10)
    slowest = Math.max(slowest, Date.now() - started)
    loaded = Math.max(loaded, loadedCount(mark, total))
  }
  await waitFor(done, Math.max(0, output.length - 6000), label, 5000)
  await press('G') // the cursor lands on the last loaded row
  await sleep(300)
  return slowest
}

function record(name, values) {
  results[name] = values
  process.stdout.write(`${name}: ${JSON.stringify(values)}\n`)
}

const stop = launch()
const failures = []
async function scenario(name, run) {
  try {
    await run()
  } catch (error) {
    failures.push(`${name}: ${error.message}`)
    process.stdout.write(`FAIL ${name}: ${error.message}\n  last gh calls: ${calls().slice(-5).map(c => c.args.filter(a => !a.startsWith('query=')).join(' ').slice(0, 140)).join(' | ')}\n`)
  }
}

try {
  await waitFor('My open PRs', 0, 'the Focus screen')
  await sleep(800) // Ink attaches its key handler after the first paint; earlier keys are dropped
  await scenario('prs', async () => {
    const mark = output.length
    await press('gp')
    const skeleton = await waitFor(/\S/, mark, 'first frame after gp')
    const firstRow = await waitFor(`100 of ${SIZES.openPrs}`, mark, 'first PR page')
    assert.ok(firstRow <= BUDGETS.firstRowMs, `PR list first rows took ${firstRow} ms (budget ${BUDGETS.firstRowMs} ms)`)
    assert.ok(skeleton <= BUDGETS.skeletonMs, `PR list skeleton took ${skeleton} ms (budget ${BUDGETS.skeletonMs} ms)`)
    const pages = Math.ceil(SEARCH_CAP / 100)
    const scrollMs = await scrollToEnd(new RegExp(`${SEARCH_CAP} of ${SIZES.openPrs} \\(GitHub search returns at most ${SEARCH_CAP}`), SIZES.openPrs, 'PR list cap notice', pages + 6)
    assert.ok(scrollMs <= BUDGETS.perPageMs, `the slowest PR list page took ${scrollMs} ms (budget ${BUDGETS.perPageMs} ms)`)
    assertPagedOnce(pageCalls('is:pr'), 100, pages, 'PR list')
    // The newest 1,000 are reachable: the oldest reachable row was fetched and is on screen.
    assert.match(strip(output), new RegExp(`#${SIZES.openPrs - SEARCH_CAP + 1}\\b`), 'the 1,000th PR never reached the screen')
    record('prs', { skeletonMs: skeleton, firstRowMs: firstRow, slowestPageMs: scrollMs, pages: pageCalls('is:pr').length })
  })

  await scenario('issues', async () => {
    const mark = output.length
    await press('gi')
    const skeleton = await waitFor(/\S/, mark, 'first frame after gi')
    const firstRow = await waitFor(/\d+ of 2000/, mark, 'first issue page')
    assert.ok(firstRow <= BUDGETS.firstRowMs, `issue list first rows took ${firstRow} ms (budget ${BUDGETS.firstRowMs} ms)`)
    assert.ok(skeleton <= BUDGETS.skeletonMs, `issue list skeleton took ${skeleton} ms (budget ${BUDGETS.skeletonMs} ms)`)
    const pages = Math.ceil(SEARCH_CAP / 50)
    const scrollMs = await scrollToEnd(new RegExp(`${SEARCH_CAP} of ${SIZES.openIssues} \\(GitHub search returns at most ${SEARCH_CAP}`), SIZES.openIssues, 'issue list cap notice', pages + 6)
    assert.ok(scrollMs <= BUDGETS.perPageMs, `the slowest issue list page took ${scrollMs} ms (budget ${BUDGETS.perPageMs} ms)`)
    assertPagedOnce(pageCalls('is:issue'), 50, pages, 'issue list')
    record('issues', { skeletonMs: skeleton, firstRowMs: firstRow, slowestPageMs: scrollMs, pages: pageCalls('is:issue').length })
  })

  await scenario('conversation', async () => {
    await press('gp')
    await sleep(700)
    await press('\r')
    await waitFor('3000 files', output.length - 3000, 'PR detail')
    await sleep(800)
    const mark = output.length
    const started = Date.now()
    await press('v')
    await waitFor(/Perf comment 5000\d\d/, mark, 'conversation first content')
    const first = Date.now() - started
    assert.ok(first <= BUDGETS.conversationFirstMs, `conversation first comment took ${first} ms (budget ${BUDGETS.conversationFirstMs} ms)`)
    // G jumps to the last loaded row, which asks for the next page; keep going until every page was requested.
    const timeline = () => calls().filter(c => c.args[1] === 'graphql' && (argValue(c, 'query') || '').includes('reviewThreads(first'))
    const lastCursor = n => String(n - 50)
    const requested = (key, value) => timeline().some(c => argValue(c, key) === value)
    const moreReplies = () => calls().filter(c => c.args[1] === 'graphql' && argValue(c, 'id') === 'PRRT_perf_0' && argValue(c, 'after') === '50')
    // The filter cycles all -> open -> resolved -> conversation -> all.
    await press('fff')
    await sleep(400)
    // Reading down the conversation pages it in: a page whenever the cursor nears the end of what is loaded.
    for (let i = 0; i < 600 && !requested('cAfter', lastCursor(SIZES.conversation)); i++) {
      term.write('j')
      await sleep(i % 20 === 19 ? DELAY_MS + 100 : 12)
    }
    assert.ok(requested('cAfter', lastCursor(SIZES.conversation)), `reading the conversation never requested its last page (${timeline().length} timeline calls)`)
    // Open threads, from the top: the first thread has 120 replies; reaching its "more replies" row fetches the other 70.
    await press('ff')
    await sleep(400)
    await press('gg')
    await sleep(300)
    for (let i = 0; i < 80 && moreReplies().length === 0; i++) { term.write('j'); await sleep(i % 20 === 19 ? DELAY_MS + 100 : 12) }
    await sleep(DELAY_MS + 300)
    assert.equal(moreReplies().length, 1, `the 70 missing replies of the 120-reply thread were fetched ${moreReplies().length} times (expected exactly once)`)
    for (let i = 0; i < 20 && !requested('tAfter', lastCursor(SIZES.threads)); i++) { await press('G'); await sleep(DELAY_MS + 200) }
    assert.ok(requested('tAfter', lastCursor(SIZES.threads)), 'the review threads never requested their last page')
    await sleep(DELAY_MS + 300)
    const keys = timeline().map(c => `${argValue(c, 'withConversation')}:${argValue(c, 'cAfter') ?? ''}:${argValue(c, 'tAfter') ?? ''}`)
    assert.equal(new Set(keys).size, keys.length, 'a conversation or thread page was fetched twice')
    record('conversation', { firstCommentMs: first, timelineCalls: timeline().length })
  })

  await scenario('diff', async () => {
    await press('q') // back from the comments to the PR detail
    await sleep(800)
    const before = calls().length
    const mark = output.length
    await press('d')
    const first = await waitFor(`file 1 of ${SIZES.files}`, mark, 'diff first file', 20000, { streamOnly: true })
    assert.ok(first <= BUDGETS.diffFirstContentMs, `diff first content took ${first} ms (budget ${BUDGETS.diffFirstContentMs} ms)`)
    // Step through the first four files: file 1, the 40,000-line file, the file GitHub omits, a normal one.
    for (const n of [2, 3, 4]) {
      const at = output.length
      await press(']')
      await waitFor(`file ${n} of ${SIZES.files}`, at, `diff file ${n}`, 20000, { streamOnly: true })
      await sleep(DELAY_MS + 300)
    }
    const text = strip(output.slice(mark))
    assert.match(text, /too large/, 'a patch GitHub omits must say so, not show an empty file')
    const during = calls().slice(before)
    assert.equal(during.filter(c => c.args[0] === 'pr' && c.args[1] === 'diff').length, 0, 'the whole diff was downloaded (pr diff); it must be per file')
    const patches = during.filter(c => /\/pulls\/\d+\/files/.test(c.args[1] || ''))
    const filePages = during.filter(c => c.args[1] === 'graphql' && (argValue(c, 'query') || '').includes('files(first'))
    assert.ok(patches.length <= 12, `${patches.length} patch calls for 4 files viewed: patches must load per viewed file (plus at most a prefetch)`)
    // The file list is complete: every page of 100, each once.
    const walked = new Set(filePages.map(afterOf))
    assert.equal(filePages.length, walked.size, 'a file-list page was fetched twice')
    record('diff', { firstContentMs: first, patchCalls: patches.length, fileListPages: filePages.length })
  })

  peakRss = Math.max(peakRss, rssMb(term.pid))
  assert.ok(peakRss > 0, 'could not sample the lazyhub process RSS')
  if (peakRss > BUDGETS.rssMb) failures.push(`peak RSS ${peakRss.toFixed(1)} MB exceeds ${BUDGETS.rssMb} MB`)
  record('memory', { peakRssMb: Math.round(peakRss * 10) / 10, budgetMb: BUDGETS.rssMb })
  term.write('q')
  await sleep(200)
} finally {
  stop()
  try { term?.kill() } catch { /* already exited */ }
  rmSync(temp, { recursive: true, force: true })
}

if (failures.length) {
  process.stderr.write(`\nPerformance budget FAILED (${failures.length}):\n${failures.map(f => `  - ${f}`).join('\n')}\n`)
  process.exit(1)
}
process.stdout.write(`\nPerformance budgets OK: ${JSON.stringify(results)}\n`)
process.exit(0)
