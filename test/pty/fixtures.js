// Shared stub `gh` for the memory/portability PTY scripts (#311).
//
// Default dataset: one PR, a 3-file diff. `scale: true` serves SCALE_PRS pull
// requests through cursor-paginated GraphQL search and a SCALE_FILES-file diff,
// so large-organization behavior can be measured without network access.
import { chmodSync, mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'

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
