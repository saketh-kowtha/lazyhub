// Memory + gh fan-out budget check for the TUI (#311).
//
// Drives Focus -> PR list -> detail -> diff against a stub `gh`, samples the
// lazyhub process's peak RSS, and counts the most `gh` children alive at once.
// Fails when peak RSS exceeds the budget. Run on the CI memory-limited job:
//   systemd-run --user --scope -p MemoryMax=512M npm run test:memory
//
// Budget: LAZYHUB_RSS_BUDGET_MB (default below). Measured baseline on
// ubuntu-latest (node 22): 105 MB, so 150 MB leaves ~40% runner-variance margin.
// To update it, read `peakRssMb` from the job's printed JSON (or run
// `npm run build && npm run test:memory` on Linux) and set the default to the
// new baseline plus ~40%.
import assert from 'assert/strict'
import { appendFileSync, chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { execFileSync } from 'child_process'
import { tmpdir } from 'os'
import { join, delimiter } from 'path'
import pty from 'node-pty'

const ROOT = new URL('../..', import.meta.url).pathname
const BIN = join(ROOT, 'dist', 'lazyhub.js')
const BUDGET_MB = Number(process.env.LAZYHUB_RSS_BUDGET_MB || 150)

const PR = {
  number: 186, title: 'PTY harness fixture PR', state: 'OPEN', author: { login: 'octocat' }, labels: [],
  reviewRequests: [], statusCheckRollup: [], reviewDecision: 'REVIEW_REQUIRED', updatedAt: '2026-06-13T00:00:00Z',
  isDraft: false, headRefName: 'feature/pty', baseRefName: 'main', assignees: [], body: 'Fixture body',
  mergeable: 'MERGEABLE', autoMergeRequest: null, url: 'https://github.com/o/r/pull/186',
}
const DIFF = ['alpha', 'beta', 'gamma'].map(n =>
  `diff --git a/src/${n}.js b/src/${n}.js\n--- a/src/${n}.js\n+++ b/src/${n}.js\n@@ -1,3 +1,3 @@\n const ${n} = 1\n-const old = 1\n+const next = 2\n`).join('')

function installGhStub(dir, traceFile) {
  const binDir = join(dir, 'bin')
  mkdirSync(binDir, { recursive: true })
  const ghPath = join(binDir, 'gh')
  writeFileSync(ghPath, `#!/usr/bin/env node
const fs = require('fs')
const args = process.argv.slice(2)
const trace = ${JSON.stringify(traceFile)}
fs.appendFileSync(trace, 'S ' + Date.now() + '\\n')
process.on('exit', () => fs.appendFileSync(trace, 'E ' + Date.now() + '\\n'))
const out = value => { process.stdout.write(typeof value === 'string' ? value : JSON.stringify(value)); process.exit(0) }
const wait = ms => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
wait(60) // a real gh call is never instant; keeps overlap measurable
if (args.includes('--version')) out('gh version 2.0.0\\n')
if (args[0] === 'auth' && args[1] === 'token') out('stub-auth\\n')
if (args[0] === 'auth' && args[1] === 'status') out('github.com\\n  ✓ Logged in to github.com account octocat (stub)\\n')
if (args[0] === 'api' && args[1] === 'user') out('octocat\\n')
if (args[0] === 'api' && args[1] === 'graphql') out({ data: { search: { nodes: [{ __typename: 'PullRequest', ...${JSON.stringify(PR)}, labels: { nodes: [] }, reviewRequests: { nodes: [] }, statusCheckRollup: { nodes: [] }, assignees: { nodes: [] } }] } } })
if (args[0] === 'repo' && args[1] === 'view') out({ name: 'r', owner: { login: 'o' } })
if (args[0] === 'pr' && args[1] === 'list') out([${JSON.stringify(PR)}])
if (args[0] === 'pr' && args[1] === 'diff') out(${JSON.stringify(DIFF)})
if (args[0] === 'pr' && args[1] === 'view') out(${JSON.stringify({ ...PR, reviews: [], files: [], additions: 3, deletions: 3, changedFiles: 3, mergeStateStatus: 'CLEAN', headRefOid: 'abc123' })})
if (args[0] === 'api' && /\\/branches/.test(args[1] || '')) out([{ name: 'main', protected: true, commit: { sha: 'abc123' } }])
out([])
`, 'utf8')
  chmodSync(ghPath, 0o755)
  return binDir
}

function rssMb(pid) {
  try {
    if (process.platform === 'linux') {
      // VmHWM is the kernel's own peak, so short spikes between samples still count.
      const hwm = readFileSync(`/proc/${pid}/status`, 'utf8').match(/^VmHWM:\s+(\d+) kB/m)
      return hwm ? Number(hwm[1]) / 1024 : 0
    }
    return Number(execFileSync('ps', ['-o', 'rss=', '-p', String(pid)]).toString().trim()) / 1024
  } catch {
    return 0
  }
}

function maxConcurrentGh(traceFile) {
  const events = readFileSync(traceFile, 'utf8').trim().split('\n').filter(Boolean)
    .map(line => line.split(' ')).map(([kind, ts]) => ({ kind, ts: Number(ts) }))
    .sort((a, b) => a.ts - b.ts || (a.kind === 'E' ? -1 : 1))
  let live = 0
  let max = 0
  for (const { kind } of events) {
    live += kind === 'S' ? 1 : -1
    max = Math.max(max, live)
  }
  return { max, total: events.filter(e => e.kind === 'S').length }
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
const STEP_MS = 1500

const temp = mkdtempSync(join(tmpdir(), 'lazyhub-mem-'))
const traceFile = join(temp, 'gh-trace')
appendFileSync(traceFile, '')
const stubBin = installGhStub(temp, traceFile)
let output = ''
let peak = 0
let term
try {
  term = pty.spawn(process.execPath, [BIN], {
    name: 'xterm-256color', cols: 80, rows: 24, cwd: ROOT,
    env: {
      PATH: `${stubBin}${delimiter}${process.env.PATH}`, HOME: temp, USER: 'lazyhub', GHUI_REPO: 'o/r',
      TERM: 'xterm-256color', COLORTERM: 'truecolor', NO_COLOR: '1', LAZYHUB_NO_DAEMON: '1',
      LAZYHUB_CACHE_DIR: join(temp, 'cache'),
      ...(process.env.LAZYHUB_GH_CONCURRENCY ? { LAZYHUB_GH_CONCURRENCY: process.env.LAZYHUB_GH_CONCURRENCY } : {}),
    },
  })
  term.onData(data => { output += data })
  const sampler = setInterval(() => { peak = Math.max(peak, rssMb(term.pid)) }, 50)

  // Fixed settle time per step: screen-scraping is unreliable on some Linux runners.
  for (const keys of [null, '2', '\r', 'd', 'r']) {
    if (keys) term.write(keys)
    await sleep(STEP_MS)
  }
  peak = Math.max(peak, rssMb(term.pid))
  term.write('q')
  await sleep(300)
  clearInterval(sampler)

  const plain = output.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '')
  assert.match(plain, /src\/(alpha|beta|gamma)\.js/, 'journey never reached the diff view; the measurement would be meaningless')
  const gh = maxConcurrentGh(traceFile)
  const result = { peakRssMb: Math.round(peak * 10) / 10, budgetMb: BUDGET_MB, maxConcurrentGh: gh.max, ghCalls: gh.total }
  process.stdout.write(`${JSON.stringify(result)}\n`)
  assert.ok(peak > 0, 'could not sample the lazyhub process RSS')
  assert.ok(peak <= BUDGET_MB, `TUI peak RSS ${result.peakRssMb} MB exceeds budget ${BUDGET_MB} MB`)
} finally {
  try { term?.kill() } catch {}
  rmSync(temp, { recursive: true, force: true })
}
