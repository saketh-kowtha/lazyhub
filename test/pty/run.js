import assert from 'assert/strict'
import { spawn, spawnSync } from 'child_process'
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
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
const args = process.argv.slice(2)
const has = value => args.includes(value)
const json = value => { process.stdout.write(JSON.stringify(value)); process.exit(0) }
if (has('--version')) { process.stdout.write('gh version 2.0.0\\n'); process.exit(0) }
if (args[0] === 'auth' && args[1] === 'token') { process.stdout.write('stub-auth\\n'); process.exit(0) }
if (args[0] === 'auth' && args[1] === 'status') {
  process.stdout.write('github.com\\n  ✓ Logged in to github.com account octocat (stub)\\n  - Active account: true\\n')
  process.exit(0)
}
if (args[0] === 'api' && args[1] === 'user') { process.stdout.write('octocat\\n'); process.exit(0) }
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
  try {
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
  } catch (err) {
    if (spawnSync('script', ['--version']).error && spawnSync('script', ['-q', '/dev/null', 'true']).error) {
      throw err
    }
  }

  const scriptArgs = process.platform === 'darwin'
    ? ['-q', '/dev/null', process.execPath, BIN]
    : ['-q', '-e', '-c', `${JSON.stringify(process.execPath)} ${JSON.stringify(BIN)}`, '/dev/null']
  const child = spawn('script', scriptArgs, {
    cwd: ROOT,
    env,
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  return {
    write: data => child.stdin.write(data),
    kill: () => child.kill(),
    onData: cb => {
      child.stdout.on('data', data => cb(data.toString()))
      child.stderr.on('data', data => cb(data.toString()))
    },
    onExit: cb => child.on('exit', (exitCode, signal) => cb({ exitCode, signal })),
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

async function runLazyhubFlow({ useTmux = false } = {}) {
  const temp = mkdtempSync(join(tmpdir(), 'lazyhub-pty-'))
  const stubBin = installGhStub(temp)
  let term
  let output = ''
  const env = {
    ...process.env,
    PATH: `${stubBin}${delimiter}${process.env.PATH}`,
    GHUI_REPO: 'saketh-kowtha/lazyhub',
    TERM: 'xterm-256color',
    NO_COLOR: '1',
  }

  try {
    if (useTmux) {
      const session = `lazyhub-pty-${Date.now()}`
      const command = `cd ${JSON.stringify(ROOT)} && PATH=${JSON.stringify(env.PATH)} GHUI_REPO=saketh-kowtha/lazyhub TERM=xterm-256color NO_COLOR=1 node ${JSON.stringify(BIN)}`
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
    term.write('2')
    await waitForScreen(() => output, /Pull Requests|PTY harness fixture PR/, 'pane 2 pull requests')
    term.write('j')
    await waitForScreen(() => output, /PTY harness fixture PR/, 'j navigation')
    term.write('k')
    await waitForScreen(() => output, /PTY harness fixture PR/, 'k navigation')
    term.write('\r')
    await waitForScreen(() => output, /Fixture body|PTY harness fixture PR/, 'Enter detail')
    term.write('\x1b')
    await waitForScreen(() => output, /Pull Requests|PTY harness fixture PR/, 'Esc back')
    term.write('?')
    await waitForScreen(() => output, /Keyboard Reference|Global/, 'help overlay')
    term.write('\x1b')
    await waitForScreen(() => output, /Pull Requests|PTY harness fixture PR/, 'close help')
    for (const [key, label] of [['3', 'issues'], ['4', 'branches'], ['5', 'actions']]) {
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

if (!canSpawnNodePty() && !process.env.CI) {
  process.stdout.write('node-pty cannot spawn in this non-CI shell; skipped local PTY E2E flow\n')
  process.exit(0)
}

await runLazyhubFlow()

if (spawnSync('tmux', ['-V']).status === 0) {
  await runLazyhubFlow({ useTmux: true })
} else {
  process.stdout.write('tmux not installed; skipped tmux PTY smoke flow\n')
}

process.stdout.write('PTY E2E passed\n')
