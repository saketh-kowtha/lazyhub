// Shared stub `gh` for the memory/portability PTY scripts (#311).
//
// Default dataset: one PR, a 3-file diff. `scale: true` serves SCALE_PRS pull
// requests through cursor-paginated GraphQL search and a SCALE_FILES-file diff,
// so large-organization behavior can be measured without network access.
import { chmodSync, existsSync, mkdirSync, readdirSync, writeFileSync } from 'fs'
import { createRequire } from 'module'
import { dirname, join } from 'path'

export const SCALE_PRS = 1200
export const SCALE_FILES = 1000

const PR = {
  number: 186, title: 'PTY harness fixture PR', state: 'OPEN', author: { login: 'octocat' }, labels: [],
  reviewRequests: [], statusCheckRollup: [], reviewDecision: 'REVIEW_REQUIRED', updatedAt: '2026-06-13T00:00:00Z',
  isDraft: false, headRefName: 'feature/pty', baseRefName: 'main', assignees: [], body: 'Fixture body',
  mergeable: 'MERGEABLE', autoMergeRequest: null, url: 'https://github.com/o/r/pull/186',
}

/**
 * Install a stub `gh` into `<dir>/bin` and return that directory.
 * @param {string} dir scratch directory
 * @param {string} traceFile appended with `S <ms>` / `E <ms>` per gh process
 * @param {{ scale?: boolean }} [opts]
 */
export function installGhStub(dir, traceFile, { scale = false } = {}) {
  const binDir = join(dir, 'bin')
  mkdirSync(binDir, { recursive: true })
  const ghPath = join(binDir, 'gh')
  writeFileSync(ghPath, `#!/usr/bin/env node
const fs = require('fs')
const args = process.argv.slice(2)
const trace = ${JSON.stringify(traceFile)}
const SCALE = ${scale}
const BASE = ${JSON.stringify(PR)}
fs.appendFileSync(trace, 'S ' + Date.now() + '\\n')
process.on('exit', () => fs.appendFileSync(trace, 'E ' + Date.now() + '\\n'))
const out = value => { process.stdout.write(typeof value === 'string' ? value : JSON.stringify(value)); process.exit(0) }
const wait = ms => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
const arg = name => { const hit = args.find(a => a.startsWith(name + '=')); return hit ? hit.slice(name.length + 1) : undefined }
const prAt = i => ({ ...BASE, number: ${SCALE_PRS} - i, title: SCALE ? 'Scale PR #' + (${SCALE_PRS} - i) + ' fixture' : BASE.title })
const node = pr => ({ __typename: 'PullRequest', ...pr, labels: { nodes: [] }, reviewRequests: { nodes: [] }, statusCheckRollup: { nodes: [] }, assignees: { nodes: [] } })
const diffFor = names => names.map(n => {
  const body = Array.from({ length: 12 }, (_, k) => ' const keep' + k + ' = ' + k).join('\\n')
  return 'diff --git a/src/' + n + '.js b/src/' + n + '.js\\n--- a/src/' + n + '.js\\n+++ b/src/' + n + '.js\\n@@ -1,13 +1,13 @@\\n' + body + '\\n-const old = 1\\n+const next = 2\\n'
}).join('')
wait(60) // a real gh call is never instant; keeps overlap measurable
if (args.includes('--version')) out('gh version 2.0.0\\n')
if (args[0] === 'auth' && args[1] === 'token') out('stub-auth\\n')
if (args[0] === 'auth' && args[1] === 'status') out('github.com\\n  ✓ Logged in to github.com account octocat (stub)\\n')
if (args[0] === 'api' && args[1] === 'user') out('octocat\\n')
if (args[0] === 'api' && args[1] === 'graphql') {
  if (!SCALE) out({ data: { search: { nodes: [node(prAt(${SCALE_PRS} - BASE.number))] } } })
  const first = Number(arg('limit') || 100)
  const start = Number(arg('after') || 0)
  const end = Math.min(${SCALE_PRS}, start + first)
  const nodes = []
  for (let i = start; i < end; i++) nodes.push(node(prAt(i)))
  out({ data: { search: { nodes, pageInfo: { hasNextPage: end < ${SCALE_PRS}, endCursor: String(end) } } } })
}
if (args[0] === 'repo' && args[1] === 'view') out({ name: 'r', owner: { login: 'o' } })
if (args[0] === 'pr' && args[1] === 'list') out([BASE])
if (args[0] === 'pr' && args[1] === 'diff') out(diffFor(SCALE ? Array.from({ length: ${SCALE_FILES} }, (_, i) => 'file' + String(i).padStart(4, '0')) : ['alpha', 'beta', 'gamma']))
if (args[0] === 'pr' && args[1] === 'view') out({ ...BASE, reviews: [], files: [], additions: 3, deletions: 3, changedFiles: SCALE ? ${SCALE_FILES} : 3, mergeStateStatus: 'CLEAN', headRefOid: 'abc123' })
if (args[0] === 'api' && /\\/branches/.test(args[1] || '')) out([{ name: 'main', protected: true, commit: { sha: 'abc123' } }])
out([])
`, 'utf8')
  chmodSync(ghPath, 0o755)
  return binDir
}

/**
 * node-pty 1.1.0 ships its macOS prebuilt `spawn-helper` without the execute
 * bit (npm preserves the tarball mode), so every `pty.spawn` fails with
 * `posix_spawnp failed`. Restore the bit before the first spawn. No-op elsewhere.
 */
export function ensureSpawnHelperExecutable() {
  try {
    const prebuilds = join(dirname(createRequire(import.meta.url).resolve('node-pty/package.json')), 'prebuilds')
    if (!existsSync(prebuilds)) return
    for (const dir of readdirSync(prebuilds)) {
      const helper = join(prebuilds, dir, 'spawn-helper')
      if (existsSync(helper)) chmodSync(helper, 0o755)
    }
  } catch {
    // Reported by the spawn probe below if it actually matters.
  }
}

/** Probe node-pty with a trivial child. Returns null when it works, else the error message. */
export function nodePtyProblem(pty, cwd) {
  ensureSpawnHelperExecutable()
  try {
    const term = pty.spawn('/bin/sh', ['-c', 'exit 0'], {
      name: 'xterm-256color', cols: 80, rows: 24, cwd, env: { TERM: 'xterm-256color', PATH: process.env.PATH },
    })
    term.kill()
    return null
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
}

/** A PTY test cannot run. Fatal under CI (a skipped test must never look green); a local skip otherwise. */
export function skipOrFail(message) {
  if (process.env.CI) {
    process.stderr.write(`FAIL (CI): ${message}\n`)
    process.exit(1)
  }
  process.stdout.write(`skipped: ${message}\n`)
  process.exit(0)
}

/** Minimal terminal model: the subset of escapes Ink emits (cursor up, erase line/screen, home, CR/LF). */
export class TerminalScreen {
  constructor(cols, rows) { this.cols = cols; this.rows = rows; this.grid = Array.from({ length: rows }, () => Array(cols).fill(' ')); this.r = 0; this.c = 0; this.scrolls = 0; this.wraps = 0; this.autowrap = true; this.sgr = []; this.unhandled = new Set() }
  feed(data) {
    // eslint-disable-next-line no-control-regex
    const re = /\x1b\[([0-9;?]*)([A-Za-z])|\x1b[=>78]|\x1b\][^\x07]*\x07|([\s\S])/g
    for (const m of data.matchAll(re)) {
      if (m[2]) this.csi(m[1], m[2])
      else if (m[3] !== undefined) this.put(m[3])
    }
  }
  csi(params, cmd) {
    const n = Number(params) || 1
    if (cmd === 'm') this.sgr.push(params)
    else if ((cmd === 'h' || cmd === 'l') && params === '?7') this.autowrap = cmd === 'h'
    else if (cmd === 'C') this.c = Math.min(this.cols - 1, this.c + n)
    else if (cmd === 'D') this.c = Math.max(0, this.c - n)
    else if (cmd === 'X') this.grid[this.r].fill(' ', this.c, this.c + n)
    else if (!'hlJKHfABG'.includes(cmd)) this.unhandled.add(cmd + params)
    else if (cmd === 'A') this.r = Math.max(0, this.r - n)
    else if (cmd === 'B') this.r = Math.min(this.rows - 1, this.r + n)
    else if (cmd === 'G') this.c = Math.max(0, n - 1)
    else if (cmd === 'H' || cmd === 'f') {
      const [row, col] = params.split(';').map(Number)
      this.r = Math.min(this.rows - 1, (row || 1) - 1); this.c = (col || 1) - 1
    } else if (cmd === 'K') {
      if (params === '2') this.grid[this.r].fill(' ')
      else if (params === '1') this.grid[this.r].fill(' ', 0, this.c + 1)
      else this.grid[this.r].fill(' ', this.c)
    } else if (cmd === 'J') {
      if (params === '2' || params === '3') this.grid.forEach(row => row.fill(' '))
      else if (params === '' || params === '0') { this.grid[this.r].fill(' ', this.c); for (let i = this.r + 1; i < this.rows; i++) this.grid[i].fill(' ') }
    }
  }
  put(ch) {
    if (ch === '\r') this.c = 0
    else if (ch === '\n') this.lineFeed()
    else if (ch >= ' ') {
      if (this.c >= this.cols) {
        if (this.autowrap) { this.wraps += 1; this.c = 0; this.lineFeed() } else this.c = this.cols - 1
      }
      this.grid[this.r][this.c] = ch
      this.c += 1
    }
  }
  lineFeed() {
    if (this.r < this.rows - 1) { this.r += 1; return }
    this.scrolls += 1
    this.grid.shift(); this.grid.push(Array(this.cols).fill(' '))
  }
  /** A real terminal keeps the old cells (cropped/padded) on resize; the app must repaint what it needs. */
  resize(cols, rows) {
    const grid = Array.from({ length: rows }, (_, r) => Array.from({ length: cols }, (_, c) => this.grid[r]?.[c] ?? ' '))
    this.grid = grid; this.cols = cols; this.rows = rows
    this.r = Math.min(this.r, rows - 1); this.c = Math.min(this.c, cols - 1)
  }
  text() { return this.grid.map(row => row.join('').trimEnd()).join('\n') }
}

