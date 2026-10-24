import assert from 'assert/strict'
import { spawnSync } from 'child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join, delimiter } from 'path'
import pty from 'node-pty'
import { installShim } from '../support/gh-shim/shim.mjs'
import { GH_STDERR } from '../../src/executor/gh-stderr-fixtures.js'

const ROOT = new URL('../..', import.meta.url).pathname
const BIN = join(ROOT, 'dist', 'lazyhub.js')

function installGhStub(dir) {
  return installShim(join(dir, 'bin'), 'pty')
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

function spawnTerminal(env, args = []) {
  const term = pty.spawn(process.execPath, [BIN, ...args], {
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
      spawnSync('tmux', ['send-keys', '-t', session, 'g'])
      await new Promise(resolve => setTimeout(resolve, 50))
      spawnSync('tmux', ['send-keys', '-t', session, 'p'])
      await waitForScreen(capture, /Pull Requests|PTY harness fixture PR/, 'tmux pane switch')
      spawnSync('tmux', ['send-keys', '-t', session, 'q'])
      spawnSync('tmux', ['kill-session', '-t', session])
      return
    }

    term = spawnTerminal(env)
    term.onData(data => { output += data })

    await waitForScreen(() => output, /Focus|Pull Requests|PTY harness fixture PR/, 'startup')
    output = ''
    await writeChord(term, 'gp') // g p: go to Pull Requests (digits are reserved for PR-detail sections)
    await waitForScreen(() => output, /Pull Requests|PTY harness fixture PR/, 'g p pull requests')
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
    for (const [key, label] of [['gi', 'issues'], ['gb', 'branches'], ['ga', 'actions']]) {
      output = ''
      await writeChord(term, key)
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

// Two-key chords must arrive as separate key events (Ink would read "gp" as one string).
async function writeChord(term, chord) {
  for (const ch of chord) {
    term.write(ch)
    await new Promise(resolve => setTimeout(resolve, 50))
  }
}

// #315: `lazyhub owner/repo#N` opens the PR detail read-only; Esc returns to that repo's list.
async function runReferenceFlow() {
  const temp = mkdtempSync(join(tmpdir(), 'lazyhub-pty-ref-'))
  const stubBin = installGhStub(temp)
  const ghLog = join(temp, 'gh-calls.ndjson')
  let output = ''
  let term
  try {
    term = spawnTerminal({ ...childEnv(stubBin, temp), LAZYHUB_GH_LOG: ghLog }, ['saketh-kowtha/lazyhub#186'])
    term.onData(data => { output += data })
    await waitForScreen(() => output, /Fixture body/, 'PR detail opened by reference')
    output = ''
    term.write('\x1b')
    await waitForScreen(() => output, /open.*closed.*merged.*scope/, 'Esc back to the PR list')
    term.write('q')
    await waitForExit(term)
    const { classifyGh } = await import(new URL('../../src/daemon/protocol.js', import.meta.url).href)
    const calls = readFileSync(ghLog, 'utf8').trim().split('\n').map(line => JSON.parse(line))
    assert.ok(calls.some(args => args[0] === 'pr' && args[1] === 'view'), 'PR detail was fetched')
    assert.deepEqual(calls.filter(args => classifyGh(args) === 'write'), [])
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

async function runDayOneErrorFlow({ name, env, expected }) {
  const temp = mkdtempSync(join(tmpdir(), `lazyhub-pty-${name}-`))
  const stubBin = installGhStub(temp)
  let output = ''
  let term
  try {
    term = spawnTerminal({ ...childEnv(stubBin, temp), ...env })
    term.onData(data => { output += data })
    await waitForScreen(() => output, /Focus|Pull Requests/, `${name} startup`)
    await writeChord(term, 'gp')
    await waitForScreen(() => output, expected, `${name} message`)
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

if (process.env.CI && process.platform === 'linux') {
  process.stdout.write('node-pty starts on this Linux runner but emits unstable screen data; skipped PTY E2E flow\n')
  process.exit(0)
}

await runLazyhubFlow()
await runReferenceFlow()
await runCrashFlow()
await runDegradedFlow()
await runDayOneErrorFlow({
  name: 'not-signed-in',
  env: { LAZYHUB_GH_STUB_STDERR: GH_STDERR.not_signed_in.stderr, LAZYHUB_GH_STUB_EXIT: '4' },
  expected: /You are not signed in to GitHub/,
})
await runDayOneErrorFlow({
  name: 'empty-queue',
  env: { LAZYHUB_GH_STUB_EMPTY: '1' },
  expected: /No open pull requests/,
})
await runPerfFlow()
await runSwrCacheFlow()

if (spawnSync('tmux', ['-V']).status === 0) {
  await runLazyhubFlow({ useTmux: true })
} else {
  process.stdout.write('tmux not installed; skipped tmux PTY smoke flow\n')
}

process.stdout.write('PTY E2E passed\n')
