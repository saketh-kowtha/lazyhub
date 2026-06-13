import assert from 'assert/strict'
import { spawnSync } from 'child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join, delimiter } from 'path'
import pty from 'node-pty'

const ROOT = new URL('../..', import.meta.url).pathname
const BIN = join(ROOT, 'dist', 'lazyhub.js')

function fixturePRs() {
  return [{
    number: 186,
    title: 'PTY harness fixture PR',
    state: 'OPEN',
    author: { login: 'octocat' },
    labels: [{ name: 'test' }],
    reviewRequests: [],
    statusCheckRollup: [{ state: 'SUCCESS', conclusion: 'SUCCESS' }],
    reviewDecision: 'REVIEW_REQUIRED',
    updatedAt: '2026-06-13T00:00:00Z',
    isDraft: false,
    headRefName: 'feature/pty',
    baseRefName: 'main',
    assignees: [],
    body: 'Fixture body',
    mergeable: 'MERGEABLE',
    autoMergeRequest: null,
    url: 'https://github.com/saketh-kowtha/lazyhub/pull/186',
  }]
}

function fixtureIssues() {
  return [{
    number: 195,
    title: 'Debug state fixture issue',
    state: 'OPEN',
    author: { login: 'octocat' },
    labels: [],
    assignees: [],
    updatedAt: '2026-06-13T00:00:00Z',
    body: 'Fixture issue',
    milestone: null,
    comments: 0,
    url: 'https://github.com/saketh-kowtha/lazyhub/issues/195',
  }]
}

function installGhStub(dir) {
  const binDir = join(dir, 'bin')
  const ghPath = join(binDir, 'gh')
  mkdirSync(binDir, { recursive: true })
  writeFileSync(ghPath, `#!/usr/bin/env node
const fs = require('fs')
const args = process.argv.slice(2)
const has = value => args.includes(value)
const json = value => { process.stdout.write(JSON.stringify(value)); process.exit(0) }
const latency = Number(process.env.LAZYHUB_GH_LATENCY_MS || 0)
if (latency > 0 && ((args[0] === 'api' && args[1] === 'graphql') || (args[0] === 'pr' && args[1] === 'list'))) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, latency)
}
if (process.env.LAZYHUB_GH_FAIL_ONCE_FILE && args[0] === 'api' && args[1] === 'graphql') {
  if (!fs.existsSync(process.env.LAZYHUB_GH_FAIL_ONCE_FILE)) {
    fs.writeFileSync(process.env.LAZYHUB_GH_FAIL_ONCE_FILE, 'failed')
    process.stderr.write('stub gh failure: rate limit\\n')
    process.exit(1)
  }
}
if (has('--version')) { process.stdout.write('gh version 2.0.0\\n'); process.exit(0) }
if (args[0] === 'auth' && args[1] === 'token') { process.stdout.write('stub-auth\\n'); process.exit(0) }
if (args[0] === 'auth' && args[1] === 'status') {
  process.stdout.write('github.com\\n  ✓ Logged in to github.com account octocat (stub)\\n  - Active account: true\\n')
  process.exit(0)
}
if (args[0] === 'api' && args[1] === 'user') { process.stdout.write('octocat\\n'); process.exit(0) }
if (args[0] === 'api' && args[1] === 'graphql') json({ data: { search: { nodes: ${JSON.stringify(fixturePRs().map(pr => ({ __typename: 'PullRequest', ...pr, labels: { nodes: pr.labels }, reviewRequests: { nodes: [] }, statusCheckRollup: { nodes: pr.statusCheckRollup }, assignees: { nodes: pr.assignees } })))} } } })
if (args[0] === 'repo' && args[1] === 'view') json({ name: 'lazyhub', owner: { login: 'saketh-kowtha' } })
if (args[0] === 'repo' && args[1] === 'list') json([{ name: 'lazyhub', nameWithOwner: 'saketh-kowtha/lazyhub' }])
if (args[0] === 'pr' && args[1] === 'list') json(${JSON.stringify(fixturePRs())})
if (args[0] === 'pr' && args[1] === 'view') json(${JSON.stringify({ ...fixturePRs()[0], reviews: [], files: [], additions: 1, deletions: 0, changedFiles: 1, mergeStateStatus: 'CLEAN', headRefOid: 'abc123' })})
if (args[0] === 'issue' && args[1] === 'list') json(${JSON.stringify(fixtureIssues())})
if (args[0] === 'issue' && args[1] === 'view') json(${JSON.stringify(fixtureIssues()[0])})
if (args[0] === 'run' && args[1] === 'list') json([{ databaseId: 1, name: 'CI', status: 'completed', conclusion: 'success', workflowName: 'CI', headBranch: 'main', event: 'push', createdAt: '2026-06-13T00:00:00Z', updatedAt: '2026-06-13T00:01:00Z', url: 'https://github.com/saketh-kowtha/lazyhub/actions/runs/1' }])
if (args[0] === 'api' && args[1] === 'notifications') json([])
if (args[0] === 'api' && /\\/branches/.test(args[1] || '')) json([{ name: 'main', protected: true, commit: { sha: 'abc123' } }, { name: 'feature/pty', protected: false, commit: { sha: 'def456' } }])
json([])
`, 'utf8')
  chmodSync(ghPath, 0o755)
  return binDir
}

function stripAnsi(text) {
  return text
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, '')
}

function waitForScreen(getText, pattern, label, timeoutMs = 8000) {
  const started = Date.now()
  return new Promise((resolve, reject) => {
    const tick = () => {
      const text = stripAnsi(getText())
      if (typeof pattern === 'string' ? text.includes(pattern) : pattern.test(text)) {
        resolve(text)
        return
      }
      if (Date.now() - started > timeoutMs) {
        reject(new Error(`Timed out waiting for ${label}\n--- screen ---\n${text.slice(-2000)}`))
        return
      }
      setTimeout(tick, 50)
    }
    tick()
  })
}

function spawnTerminal(env) {
  const term = pty.spawn(process.execPath, [BIN], {
    name: 'xterm-256color',
    cols: 80,
    rows: 24,
    cwd: ROOT,
    env,
  })
  return {
    write: data => term.write(data),
    kill: () => term.kill(),
    onData: cb => term.onData(cb),
    onExit: cb => term.onExit(cb),
  }
}

function canSpawnNodePty() {
  try {
    const term = pty.spawn('/bin/sh', ['-lc', 'exit 0'], {
      name: 'xterm-256color',
      cols: 80,
      rows: 24,
      cwd: ROOT,
      env: { TERM: 'xterm-256color', PATH: process.env.PATH },
    })
    term.kill()
    return true
  } catch {
    return false
  }
}

function childEnv(stubBin, homeDir) {
  return {
    PATH: `${stubBin}${delimiter}${process.env.PATH}`,
    HOME: homeDir,
    USER: process.env.USER || 'lazyhub',
    GHUI_REPO: 'saketh-kowtha/lazyhub',
    TERM: 'xterm-256color',
    COLORTERM: 'truecolor',
    NO_COLOR: '1',
    LAZYHUB_NO_DAEMON: '1',
  }
}

async function waitForExit(term, timeoutMs = 3000) {
  return new Promise(resolve => {
    const done = setTimeout(() => resolve({ exitCode: null, signal: null }), timeoutMs)
    term.onExit(event => {
      clearTimeout(done)
      resolve(event)
    })
  })
}

async function runLazyhubFlow({ useTmux = false } = {}) {
  const temp = mkdtempSync(join(tmpdir(), 'lazyhub-pty-'))
  const stubBin = installGhStub(temp)
  let term
  let output = ''
  const env = childEnv(stubBin, temp)

  try {
    if (useTmux) {
      const session = `lazyhub-pty-${Date.now()}`
      const command = `cd ${JSON.stringify(ROOT)} && PATH=${JSON.stringify(env.PATH)} HOME=${JSON.stringify(env.HOME)} USER=${JSON.stringify(env.USER)} GHUI_REPO=${env.GHUI_REPO} TERM=xterm-256color COLORTERM=truecolor NO_COLOR=1 LAZYHUB_NO_DAEMON=1 node ${JSON.stringify(BIN)}`
      const started = spawnSync('tmux', ['new-session', '-d', '-x', '80', '-y', '24', '-s', session, command])
      assert.equal(started.status, 0, started.stderr?.toString())
      const capture = () => spawnSync('tmux', ['capture-pane', '-pt', session]).stdout.toString()
      await waitForScreen(capture, /Pull Requests|Focus|PTY harness fixture PR/, 'tmux startup')
      spawnSync('tmux', ['send-keys', '-t', session, '2'])
      await waitForScreen(capture, /Pull Requests|PTY harness fixture PR/, 'tmux pane switch')
      spawnSync('tmux', ['send-keys', '-t', session, 'q'])
      spawnSync('tmux', ['kill-session', '-t', session])
      return
    }

    term = spawnTerminal(env)
    term.onData(data => { output += data })

    await waitForScreen(() => output, /Focus|Pull Requests|PTY harness fixture PR/, 'startup')
    output = ''
    term.write('2')
    await waitForScreen(() => output, /Pull Requests|PTY harness fixture PR/, 'pane 2 pull requests')
    output = ''
    term.write('j')
    await waitForScreen(() => output, /PTY harness fixture PR/, 'j navigation')
    output = ''
    term.write('k')
    await waitForScreen(() => output, /PTY harness fixture PR/, 'k navigation')
    output = ''
    term.write('\r')
    await waitForScreen(() => output, /Fixture body/, 'Enter detail')
    output = ''
    term.write('\x1b')
    await waitForScreen(() => output, /open.*closed.*merged.*scope/, 'Esc back')
    output = ''
    term.write('?')
    await waitForScreen(() => output, /Keyboard Reference|Global/, 'help overlay')
    output = ''
    term.write('\x1b')
    await waitForScreen(() => output, /open.*closed.*merged.*scope|Pull Requests/, 'close help')
    for (const [key, label] of [['3', 'issues'], ['4', 'branches'], ['5', 'actions']]) {
      output = ''
      term.write(key)
      await waitForScreen(() => output, /Issues|Branches|Actions|Debug state fixture issue|main|CI/, `pane ${label}`)
    }
    term.write('q')
    await new Promise(resolve => {
      const done = setTimeout(resolve, 2000)
      term.onExit(() => { clearTimeout(done); resolve() })
    })
  } finally {
    try { term?.kill() } catch {}
    rmSync(temp, { recursive: true, force: true })
  }
}

async function runCrashFlow() {
  const temp = mkdtempSync(join(tmpdir(), 'lazyhub-pty-crash-'))
  const stubBin = installGhStub(temp)
  let output = ''
  let term
  try {
    term = spawnTerminal({ ...childEnv(stubBin, temp), LAZYHUB_CRASH_TEST: '1' })
    term.onData(data => { output += data })
    await waitForScreen(() => output, /Focus|Pull Requests|PTY harness fixture PR/, 'crash flow startup')
    term.write('\x1f')
    const exit = await waitForExit(term)
    assert.equal(exit.exitCode, 1)
    assert.match(output, /LAZYHUB_CRASH_TEST crash/)
    assert.match(output, /lazyhub --debug-state/)
    assert.match(output, /\x1b\[\?1049l/)
  } finally {
    try { term?.kill() } catch {}
    rmSync(temp, { recursive: true, force: true })
  }
}

async function runDegradedFlow() {
  const temp = mkdtempSync(join(tmpdir(), 'lazyhub-pty-degraded-'))
  const stubBin = installGhStub(temp)
  const failFile = join(temp, 'gh-failed-once')
  let output = ''
  let term
  try {
    term = spawnTerminal({ ...childEnv(stubBin, temp), LAZYHUB_GH_FAIL_ONCE_FILE: failFile })
    term.onData(data => { output += data })
    await waitForScreen(() => output, /stub gh failure|rate limit|press r to retry/, 'degraded banner')
    term.write('r')
    await waitForScreen(() => output, /PTY harness fixture PR/, 'degraded recovery')
    assert.match(stripAnsi(output), /press r to retry/)
    term.write('q')
    await waitForExit(term)
  } finally {
    try { term?.kill() } catch {}
    rmSync(temp, { recursive: true, force: true })
  }
}

async function runPerfFlow() {
  const temp = mkdtempSync(join(tmpdir(), 'lazyhub-pty-perf-'))
  const stubBin = installGhStub(temp)
  const perfPath = join(temp, 'perf.ndjson')
  let output = ''
  let term
  try {
    term = spawnTerminal({ ...childEnv(stubBin, temp), LAZYHUB_PERF: '1', LAZYHUB_PERF_PATH: perfPath })
    term.onData(data => { output += data })
    await waitForScreen(() => output, /Focus|Pull Requests|PTY harness fixture PR/, 'perf startup')
    for (let i = 0; i < 10; i += 1) term.write(i % 2 ? 'j' : 'k')
    await new Promise(resolve => setTimeout(resolve, 200))
    term.write('q')
    await waitForExit(term)
    assert.equal(existsSync(perfPath), true)
    const rows = readFileSync(perfPath, 'utf8').trim().split('\n').map(line => JSON.parse(line))
    assert.ok(rows.filter(row => row.type === 'input' && row.name === 'keypress-render').length >= 10)
  } finally {
    try { term?.kill() } catch {}
    rmSync(temp, { recursive: true, force: true })
  }
}

async function runSwrCacheFlow() {
  const temp = mkdtempSync(join(tmpdir(), 'lazyhub-pty-swr-'))
  const stubBin = installGhStub(temp)
  const cacheDir = join(temp, 'cache')
  let first
  let second
  let firstOutput = ''
  let secondOutput = ''
  try {
    first = spawnTerminal({ ...childEnv(stubBin, temp), LAZYHUB_CACHE_DIR: cacheDir })
    first.onData(data => { firstOutput += data })
    await waitForScreen(() => firstOutput, /PTY harness fixture PR/, 'cache warm')
    first.write('q')
    await waitForExit(first)

    second = spawnTerminal({ ...childEnv(stubBin, temp), LAZYHUB_CACHE_DIR: cacheDir, LAZYHUB_GH_LATENCY_MS: '1500' })
    second.onData(data => { secondOutput += data })
    await waitForScreen(() => secondOutput, /PTY harness fixture PR/, 'stale cache first frame', 700)
    second.write('q')
    await waitForExit(second)
  } finally {
    try { first?.kill() } catch {}
    try { second?.kill() } catch {}
    rmSync(temp, { recursive: true, force: true })
  }
}

if (!canSpawnNodePty()) {
  process.stdout.write('node-pty cannot spawn in this shell; skipped PTY E2E flow\n')
  process.exit(0)
}

await runLazyhubFlow()
await runCrashFlow()
await runDegradedFlow()
await runPerfFlow()
await runSwrCacheFlow()

if (spawnSync('tmux', ['-V']).status === 0) {
  await runLazyhubFlow({ useTmux: true })
} else {
  process.stdout.write('tmux not installed; skipped tmux PTY smoke flow\n')
}

process.stdout.write('PTY E2E passed\n')
