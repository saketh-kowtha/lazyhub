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
import { appendFileSync, mkdtempSync, readFileSync, rmSync } from 'fs'
import { execFileSync } from 'child_process'
import { tmpdir } from 'os'
import { join, delimiter } from 'path'
import pty from 'node-pty'
import { installGhStub } from './fixtures.js'

const ROOT = new URL('../..', import.meta.url).pathname
const BIN = join(ROOT, 'dist', 'lazyhub.js')
const BUDGET_MB = Number(process.env.LAZYHUB_RSS_BUDGET_MB || 150)
// LAZYHUB_SCALE=1: 1,200 PRs and a 1,000-file diff (see fixtures.js); the journey scrolls the list to the end.
const SCALE = process.env.LAZYHUB_SCALE === '1'

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
const stubBin = installGhStub(temp, traceFile, { scale: SCALE })
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
  const journey = SCALE ? [null, 'gp', 'j'.repeat(95), 'j'.repeat(95), 'j'.repeat(95), '\r', 'd', 'J'.repeat(40), 'r'] : [null, 'gp', '\r', 'd', 'r']
  for (const keys of journey) {
    // Ink reads a multi-char chunk as one input event, so repeats and chords go one key at a time.
    if (keys && keys.length > 1 && (/^(.)\1+$/.test(keys) || keys === 'gp')) { for (const key of keys) { term.write(key); await sleep(keys === 'gp' ? 50 : 6) } } else if (keys) term.write(keys)
    await sleep(STEP_MS)
  }
  peak = Math.max(peak, rssMb(term.pid))
  term.write('q')
  await sleep(300)
  clearInterval(sampler)

  const plain = output.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '')
  assert.match(plain, /src\/(alpha|beta|gamma|file\d{4})\.js/, 'journey never reached the diff view; the measurement would be meaningless')
  // Scale: the list must have paged past the first 100 rows (numbers count down from 1200).
  const lowestPr = Math.min(...[...plain.matchAll(/Scale PR #(\d+)/g)].map(m => Number(m[1])))
  const gh = maxConcurrentGh(traceFile)
  const result = { peakRssMb: Math.round(peak * 10) / 10, budgetMb: BUDGET_MB, maxConcurrentGh: gh.max, ghCalls: gh.total, ...(SCALE ? { scale: true, lowestPrSeen: lowestPr } : {}) }
  process.stdout.write(`${JSON.stringify(result)}\n`)
  if (SCALE) assert.ok(lowestPr <= 1100, `PR list never paged past the first 100 rows (lowest PR seen: #${lowestPr})`)
  assert.ok(peak > 0, 'could not sample the lazyhub process RSS')
  assert.ok(peak <= BUDGET_MB, `TUI peak RSS ${result.peakRssMb} MB exceeds budget ${BUDGET_MB} MB`)
} finally {
  try { term?.kill() } catch {}
  rmSync(temp, { recursive: true, force: true })
}
