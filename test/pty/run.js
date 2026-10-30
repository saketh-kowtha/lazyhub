import assert from 'assert/strict'
import { spawnSync } from 'child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { dirname, join, delimiter } from 'path'
import pty from 'node-pty'
import { nodePtyProblem, skipOrFail, TerminalScreen } from './fixtures.js'
import { installShim } from '../support/gh-shim/shim.mjs'
import { GH_STDERR } from '../../src/executor/gh-stderr-fixtures.js'

const ROOT = new URL('../..', import.meta.url).pathname
const BIN = join(ROOT, 'dist', 'lazyhub.js')

function installGhStub(dir) {
  // installShim returns the gh file; PATH needs its directory.
  return dirname(installShim(join(dir, 'bin'), 'pty'))
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

function spawnTerminal(env, args = [], { cols = 80, rows = 24 } = {}) {
  const term = pty.spawn(process.execPath, [BIN, ...args], {
    name: 'xterm-256color',
    cols,
    rows,
    cwd: ROOT,
    env,
  })
  return {
    write: data => term.write(data),
    resize: (cols, rows) => term.resize(cols, rows),
    kill: () => term.kill(),
    onData: cb => term.onData(cb),
    onExit: cb => term.onExit(cb),
  }
}

// The first frame paints before Ink has put stdin in raw mode and attached its
// key handler; keys sent in that window are dropped (slow CI runners hit it).
const settle = () => new Promise(resolve => setTimeout(resolve, 400))

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
      const session = `lazyhub-pty-${Date.now()}-${process.pid}`
      // The tmux server inherits this process's env, and Ink renders only the final frame when CI is set.
      const command = `(unset CI GITHUB_ACTIONS; cd ${JSON.stringify(ROOT)} && PATH=${JSON.stringify(env.PATH)} HOME=${JSON.stringify(env.HOME)} USER=${JSON.stringify(env.USER)} GHUI_REPO=${env.GHUI_REPO} TERM=xterm-256color COLORTERM=truecolor NO_COLOR=1 LAZYHUB_NO_DAEMON=1 node ${JSON.stringify(BIN)} 2>${JSON.stringify(join(temp, 'tmux-stderr.log'))}); echo "lazyhub exited: $?"; sleep 60`
      const started = spawnSync('tmux', ['new-session', '-d', '-x', '80', '-y', '24', '-s', session, command])
      assert.equal(started.status, 0, started.stderr?.toString())
      const capture = () => {
        const result = spawnSync('tmux', ['capture-pane', '-pt', session])
        if (result.stdout.toString()) return result.stdout.toString()
        return `[tmux capture-pane status=${result.status} stderr=${result.stderr}; ls: ${spawnSync('tmux', ['ls']).stderr}${spawnSync('tmux', ['ls']).stdout}]`
      }
      try {
        await waitForScreen(capture, /Pull Requests|Focus|PTY harness fixture PR/, 'tmux startup')
      } catch (error) {
        const info = [['list-panes', '-a', '-F', '#{pane_pid} dead=#{pane_dead} cmd=#{pane_current_command} alt=#{alternate_on} #{pane_width}x#{pane_height}'], ['capture-pane', '-apq', '-t', session]]
          .map(args => `$ tmux ${args[0]}\n${spawnSync('tmux', args).stdout}`).join('\n')
        throw new Error(`${error.message}\n--- tmux diagnostics ---\n${info}\nstderr: ${existsSync(join(temp, 'tmux-stderr.log')) ? readFileSync(join(temp, 'tmux-stderr.log'), 'utf8') : '(none)'}\n${spawnSync('ps', ['-eo', 'pid,ppid,etime,args']).stdout.toString().split('\n').filter(l => /lazyhub|node|gh/.test(l)).join('\n')}\n${spawnSync('tmux', ['-V']).stdout}`)
      }
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
    await settle()
    output = ''
    // g p: go to Pull Requests (digits are reserved for PR-detail sections)
    await sendUntil(() => writeChord(term, 'gp'), () => output, /Pull Requests|PTY harness fixture PR/, 'g p pull requests')
    // One fixture row: j/k move nothing, and Ink repaints only changed cells, so
    // there is no screen text to wait on. Send them and let the keys settle.
    term.write('j')
    await new Promise(resolve => setTimeout(resolve, 100))
    term.write('k')
    await new Promise(resolve => setTimeout(resolve, 100))
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

// Keys sent while a slow runner is still wiring up Ink's stdin handler are dropped,
// and a dropped key leaves no output to wait on. Re-send an idempotent key until
// the screen reacts instead of guessing a startup delay.
async function sendUntil(send, getText, pattern, label, { tries = 4, eachMs = 2500 } = {}) {
  let last
  for (let attempt = 0; attempt < tries; attempt += 1) {
    await send()
    try { return await waitForScreen(getText, pattern, label, eachMs) } catch (error) { last = error }
  }
  throw last
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
    await sendUntil(async () => term.write('r'), () => output, /PTY harness fixture PR/, 'degraded recovery')
    // The banner ellipsizes its message, never the retry hint.
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
    await settle()
    await sendUntil(() => writeChord(term, 'gp'), () => output, expected, `${name} message`)
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
    await settle()
    // keypress-render is recorded when App re-renders after a key, so use keys
    // that change App state (pane switches); j/k on a one-row list change nothing.
    for (let i = 0; i < 5; i += 1) {
      await writeChord(term, 'gp')
      await writeChord(term, 'gi')
    }
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

    second = spawnTerminal({ ...childEnv(stubBin, temp), LAZYHUB_CACHE_DIR: cacheDir, LAZYHUB_GH_LATENCY_MS: '5000' })
    second.onData(data => { secondOutput += data })
    // The cached frame must beat the (slow) fresh fetch: 5s of gh latency vs a 3s window.
    // Cold start itself is ~1s on a busy runner, so the window cannot be tighter.
    await waitForScreen(() => secondOutput, /PTY harness fixture PR/, 'stale cache first frame', 3000)
    second.write('q')
    await waitForExit(second)
  } finally {
    try { first?.kill() } catch {}
    try { second?.kill() } catch {}
    rmSync(temp, { recursive: true, force: true })
  }
}

// Responsive layout: 120x40 -> 60x18 -> too small -> 120x40 on a real PTY, replayed through a
// terminal model. After each resize the frame must fit the new size (nothing wrapped, nothing
// from the previous geometry left behind) and the breakpoint must have changed.
async function waitUntil(check, label, timeoutMs = 8000) {
  const started = Date.now()
  for (;;) {
    const verdict = check()
    if (verdict === true) return
    if (Date.now() - started > timeoutMs) throw new Error(`Timed out waiting for ${label}\n--- screen ---\n${verdict}`)
    await new Promise(resolve => setTimeout(resolve, 50))
  }
}

async function runResizeFlow() {
  const temp = mkdtempSync(join(tmpdir(), 'lazyhub-pty-resize-'))
  const stubBin = installGhStub(temp)
  const screen = new TerminalScreen(120, 40)
  let term
  try {
    term = spawnTerminal(childEnv(stubBin, temp), [], { cols: 120, rows: 40 })
    // Frames the app wrote for the old size may still be in flight when the PTY is resized; a real
    // terminal shows those at the old geometry. The app's first answer to SIGWINCH (it switches
    // auto-wrap off) marks the point where the new geometry applies.
    let pendingSize = null
    term.onData(data => {
      if (pendingSize && data.includes('\x1b[?7l')) {
        const [head, ...rest] = data.split('\x1b[?7l')
        screen.feed(head)
        screen.resize(pendingSize.cols, pendingSize.rows)
        pendingSize = null
        screen.feed('\x1b[?7l' + rest.join('\x1b[?7l'))
        return
      }
      screen.feed(data)
    })
    const showing = (re, want = true) => () => (re.test(screen.text()) === want ? true : screen.text())
    await waitUntil(showing(/Focus|Pull Requests/), 'startup at 120x40')
    await settle()
    await sendUntil(() => writeChord(term, 'gp'), () => screen.text(), /PTY harness fixture PR/, 'PR list at 120x40')
    await waitUntil(showing(/⌂ lazyhub/), 'sidebar at 120x40')
    assert.ok(screen.text().split('\n').some(l => /^─{120}$/.test(l.trim())), 'footer rule spans 120 columns')

    const resizeTo = (cols, rows) => {
      const wrapsBefore = screen.wraps
      pendingSize = { cols, rows }
      term.resize(cols, rows)
      return () => assert.equal(screen.wraps, wrapsBefore, `a line wider than ${cols} columns was written after resizing to ${cols}x${rows}`)
    }

    // shrink: the sidebar collapses to the tab strip and nothing wider than 60 columns is drawn
    const check60 = resizeTo(60, 18)
    await waitUntil(showing(/⌂ lazyhub/, false), 'sidebar collapsed at 60x18')
    await waitUntil(showing(/#186/), 'PR list at 60x18')
    check60()
    assert.ok(screen.text().split('\n').every(l => [...l].length <= 60), 'every row fits 60 columns')

    // too small: one clear message instead of a broken frame
    const check30 = resizeTo(30, 8)
    await waitUntil(showing(/Terminal too small/), 'too-small message at 30x8')
    assert.match(screen.text(), /needs 40x10/)
    assert.doesNotMatch(screen.text(), /#186/, 'no list content behind the too-small message')
    check30()

    // grow back: the full layout returns, repainted at the new width
    const check120 = resizeTo(120, 40)
    await waitUntil(showing(/⌂ lazyhub/), 'sidebar restored at 120x40')
    await waitUntil(showing(/Terminal too small/, false), 'too-small message cleared')
    await waitUntil(() => (screen.text().split('\n').some(l => /^─{120}$/.test(l.trim())) ? true : screen.text()), 'footer rule repainted at 120 columns')
    check120()

    term.write('q')
    await waitForExit(term)
  } finally {
    try { term?.kill() } catch {}
    rmSync(temp, { recursive: true, force: true })
  }
}

// The same flow inside a real terminal emulator (tmux), which crops and reflows like a user's terminal.
async function runTmuxResizeFlow() {
  const temp = mkdtempSync(join(tmpdir(), 'lazyhub-pty-tmuxresize-'))
  const stubBin = installGhStub(temp)
  const env = childEnv(stubBin, temp)
  const session = `lazyhub-resize-${Date.now()}-${process.pid}`
  const tmux = (...args) => spawnSync('tmux', args).stdout.toString()
  const command = `(unset CI GITHUB_ACTIONS; cd ${JSON.stringify(ROOT)} && PATH=${JSON.stringify(env.PATH)} HOME=${JSON.stringify(env.HOME)} USER=${JSON.stringify(env.USER)} GHUI_REPO=${env.GHUI_REPO} TERM=xterm-256color COLORTERM=truecolor NO_COLOR=1 LAZYHUB_NO_DAEMON=1 node ${JSON.stringify(BIN)} 2>${JSON.stringify(join(temp, 'tmux-stderr.log'))}); sleep 60`
  try {
    const started = spawnSync('tmux', ['new-session', '-d', '-x', '120', '-y', '40', '-s', session, command])
    assert.equal(started.status, 0, started.stderr?.toString())
    const capture = () => tmux('capture-pane', '-p', '-t', session)
    const frameFits = (cols, rows) => {
      const lines = capture().replace(/\n$/, '').split('\n')
      return lines.length <= rows && lines.every(l => [...l].length <= cols) ? true : capture()
    }
    await waitForScreen(capture, /Focus|Pull Requests/, 'tmux startup at 120x40')
    await waitForScreen(capture, /⌂ lazyhub/, 'tmux sidebar at 120x40')
    for (const [cols, rows, want, absent] of [[60, 18, /Pull Requests|Focus/, /⌂ lazyhub/], [81, 24, /⌂ lazyhub/, /Terminal too small/], [50, 15, /Pull Requests|Focus/, /⌂ lazyhub/], [120, 40, /⌂ lazyhub/, /Terminal too small/]]) {
      tmux('resize-window', '-t', session, '-x', String(cols), '-y', String(rows))
      await waitForScreen(capture, want, `tmux ${cols}x${rows}`)
      await waitUntil(() => (absent.test(capture()) ? capture() : true), `tmux ${cols}x${rows}: stale content gone`)
      await waitUntil(() => frameFits(cols, rows), `tmux ${cols}x${rows}: frame fits`)
    }
    // rapid repeated resizes settle on the final size
    for (const [cols, rows] of [[100, 30], [55, 16], [90, 26], [70, 20], [120, 40]]) {
      tmux('resize-window', '-t', session, '-x', String(cols), '-y', String(rows))
      await new Promise(resolve => setTimeout(resolve, 20))
    }
    await waitUntil(() => (/⌂ lazyhub/.test(capture()) ? true : capture()), 'tmux settled at 120x40 after a resize burst')
    await waitUntil(() => frameFits(120, 40), 'tmux frame fits after a resize burst')
    spawnSync('tmux', ['send-keys', '-t', session, 'q'])
  } finally {
    spawnSync('tmux', ['kill-session', '-t', session])
    rmSync(temp, { recursive: true, force: true })
  }
}

const ptyProblem = nodePtyProblem(pty, ROOT)
if (ptyProblem) skipOrFail(`node-pty cannot spawn in this shell: ${ptyProblem}`)

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
await runResizeFlow()

if (spawnSync('tmux', ['-V']).status === 0) {
  await runLazyhubFlow({ useTmux: true })
  await runTmuxResizeFlow()
} else if (process.env.CI) {
  // CI installs tmux on Linux; macOS runners do not and the tmux flow is Linux-only coverage.
  if (process.platform === 'linux') skipOrFail('tmux is not installed but the CI job installs it')
  process.stdout.write('tmux not installed on this runner; skipped tmux PTY smoke flow\n')
} else {
  process.stdout.write('tmux not installed; skipped tmux PTY smoke flow\n')
}

process.stdout.write('PTY E2E passed\n')
