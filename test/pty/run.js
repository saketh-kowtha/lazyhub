import assert from 'assert/strict'
import { spawnSync } from 'child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync } from 'fs'
import { createServer } from 'net'
import { tmpdir } from 'os'
import { dirname, join, delimiter } from 'path'
import pty from 'node-pty'
import { removeTempDir, stopTerminal, stopTmuxSession } from './cleanup.js'
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
  const exited = new Promise(resolve => term.onExit(resolve))
  return {
    pid: term.pid,
    exited,
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
  let tmuxSession = null
  const env = childEnv(stubBin, temp)

  try {
    if (useTmux) {
      const session = `lazyhub-pty-${Date.now()}-${process.pid}`
      tmuxSession = session
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
    // Resend Enter if the first one lands before the list has focus (slow CI runners).
    await sendUntil(() => term.write('\r'), () => output, /Fixture body/, 'Enter detail', { tries: 3, eachMs: 4000 })
    output = ''
    term.write('\x1b')
    await waitForScreen(() => output, /open.*closed.*merged/, 'Esc back')
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
    await stopTerminal(term)
    if (tmuxSession) await stopTmuxSession(tmuxSession)
    removeTempDir(temp)
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
    await waitForScreen(() => output, /open.*closed.*merged/, 'Esc back to the PR list')
    term.write('q')
    await waitForExit(term)
    const { classifyGh } = await import(new URL('../../src/daemon/protocol.js', import.meta.url).href)
    const calls = readFileSync(ghLog, 'utf8').trim().split('\n').map(line => JSON.parse(line))
    assert.ok(calls.some(args => args[0] === 'pr' && args[1] === 'view'), 'PR detail was fetched')
    assert.deepEqual(calls.filter(args => classifyGh(args) === 'write'), [])
  } finally {
    await stopTerminal(term)
    removeTempDir(temp)
  }
}

// #517: a true first run (no config, no preselected repo) must reach Focus within
// 2 keys. The governance report is no longer a step in between.
async function runFirstRunFlow() {
  const temp = mkdtempSync(join(tmpdir(), 'lazyhub-pty-first-'))
  const stubBin = installGhStub(temp)
  let output = ''
  let term
  try {
    const { GHUI_REPO: _preselected, ...env } = childEnv(stubBin, temp)
    term = spawnTerminal(env)
    term.onData(data => { output += data })
    await waitForScreen(() => output, /Pick a repository to open/, 'first-run repository list')
    await settle()
    output = ''
    term.write('\r') // key 1: open the highlighted repository
    const screen = await waitForScreen(() => output, /Focus|Pull Requests|PTY harness fixture PR/, 'Focus after one key')
    assert.doesNotMatch(screen, /Coverage \(|ungoverned|Enforcement/, 'no governance report before Focus')
    term.write('q')
    await waitForExit(term)
  } finally {
    await stopTerminal(term)
    removeTempDir(temp)
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
    await stopTerminal(term)
    removeTempDir(temp)
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
    await stopTerminal(term)
    removeTempDir(temp)
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
    await stopTerminal(term)
    removeTempDir(temp)
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
    await stopTerminal(term)
    removeTempDir(temp)
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
    await stopTerminal(first)
    await stopTerminal(second)
    removeTempDir(temp)
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
    // The footer paints in the same frame burst as the sidebar but a PTY may split that burst across chunks, so wait for it.
    await waitUntil(() => (screen.text().split('\n').some(l => /^─{120}$/.test(l.trim())) ? true : screen.text()), 'footer rule spans 120 columns')

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
    await stopTerminal(term)
    removeTempDir(temp)
  }
}

// #491: the first frame must not wait on the background helper. The helper's socket is a listener that
// accepts and never answers, which is the worst case for a probe that blocks the launcher. Cold start to first
// frame is measured with the helper disabled and with the hung one; the difference must stay small, and the probe
// must still happen (after the frame), so the check cannot pass by never looking for the helper.
async function coldStartMs({ hungHelper }) {
  const temp = mkdtempSync(join(tmpdir(), 'lh-'))
  const stubBin = installGhStub(temp)
  const env = childEnv(stubBin, temp)
  let probes = 0
  let helper = null
  const held = new Set()
  let term
  let output = ''
  try {
    if (hungHelper) {
      delete env.LAZYHUB_NO_DAEMON
      const dir = join(temp, '.config', 'lazyhub')
      mkdirSync(dir, { recursive: true, mode: 0o700 })
      helper = createServer(socket => { probes += 1; held.add(socket); socket.on('error', () => {}) })
      await new Promise((resolve, reject) => { helper.once('error', reject); helper.listen(join(dir, 'daemon.sock'), resolve) })
    }
    const started = Date.now()
    term = spawnTerminal(env)
    term.onData(data => { output += data })
    await waitForScreen(() => output, /Focus|PTY harness fixture PR/, `cold start (${hungHelper ? 'hung helper' : 'no helper'})`)
    const ms = Date.now() - started
    if (hungHelper) await waitUntil(() => (probes > 0 ? true : 'the launcher never probed the helper'), 'the background probe after the first frame')
    term.write('q')
    await waitForExit(term)
    return { ms, probes }
  } finally {
    await stopTerminal(term)
    for (const socket of held) socket.destroy()
    helper?.close()
    removeTempDir(temp)
  }
}

async function runColdStartFlow() {
  const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]
  const runs = { base: [], hung: [] }
  for (let i = 0; i < 3; i += 1) {
    runs.base.push((await coldStartMs({ hungHelper: false })).ms)
    const hung = await coldStartMs({ hungHelper: true })
    assert.ok(hung.probes >= 1, 'the helper was probed')
    runs.hung.push(hung.ms)
  }
  const base = median(runs.base)
  const hung = median(runs.hung)
  process.stdout.write(`PTY cold start to first frame: no helper ${base} ms, hung helper ${hung} ms (runs: ${runs.base.join('/')} vs ${runs.hung.join('/')})\n`)
  // A launcher that awaited the probe and the spawn window would add seconds; noise is a few hundred ms.
  assert.ok(hung - base < 1000, `a hung helper delayed the first frame by ${hung - base} ms`)
}

// #463: Enter on a failed PR check opens the log viewer on its failure excerpt; f shows the full log and back.
async function runFailedLogFlow() {
  const temp = mkdtempSync(join(tmpdir(), 'lazyhub-pty-faillog-'))
  const stubBin = installGhStub(temp)
  const screen = new TerminalScreen(100, 40)
  let term
  try {
    term = spawnTerminal({ ...childEnv(stubBin, temp), LAZYHUB_GH_FAILED_CHECK: '1' }, [], { cols: 100, rows: 40 })
    term.onData(data => screen.feed(data))
    const showing = (re, want = true) => () => (re.test(screen.text()) === want ? true : screen.text())
    await waitUntil(showing(/Focus/), 'failed-log flow startup')
    await settle()
    await sendUntil(() => writeChord(term, 'gp'), () => screen.text(), /PTY harness fixture PR/, 'PR list for the failed-log flow')
    // Smart Enter (#314): a PR with failing CI opens the failed check's log directly and says why.
    // Resend Enter if the first one lands before the list has focus (slow CI runners).
    await sendUntil(() => term.write('\r'), () => screen.text(), /Failure excerpt/, 'smart Enter opens the failure excerpt of the failed check', { tries: 3, eachMs: 4000 })
    // The excerpt frame can paint before the log text loads; wait for it (slow CI runners).
    await waitUntil(showing(/AssertionError/), 'the failed-step log text is shown')
    term.write('\x1b')
    await waitUntil(showing(/Failure excerpt/, false), 'Esc closes the smart-Enter log')
    await waitUntil(showing(/Fixture body/), 'Esc from the smart-Enter log lands on PR detail')
    // The #463 path from detail: c -> checks mode -> Enter opens the failure excerpt first.
    term.write('c')
    await waitUntil(showing(/\[Ctrl\+R\] re-run/), 'checks mode')
    await sendUntil(() => term.write('\r'), () => screen.text(), /Failure excerpt/, 'the failure excerpt opens first', { tries: 3, eachMs: 4000 })
    await waitUntil(showing(/AssertionError/), 'the failed-step log text is shown first')
    assert.doesNotMatch(screen.text(), /RUN {2}v3\.2\.4/, 'the full log is not shown yet')
    term.write('f')
    await waitUntil(showing(/RUN {2}v3\.2\.4/), 'f shows the full log')
    assert.doesNotMatch(screen.text(), /Failure excerpt/)
    term.write('f')
    await waitUntil(showing(/Failure excerpt/), 'f returns to the excerpt')
    term.write('\x1b')
    await waitUntil(showing(/Failure excerpt/, false), 'Esc closes the viewer')
    term.write('\x1b')
    await waitUntil(showing(/\[Ctrl\+R\] re-run/, false), 'Esc leaves checks mode')
    // #359: f on the PR opens "Why is CI red?" with the failing check, step, excerpt and an explicit unknown for the rest.
    term.write('f')
    await waitUntil(showing(/Why is CI red\?/), 'f opens Why is CI red')
    await waitUntil(showing(/failing step: Run npm test/), 'the failing step is shown')
    assert.match(screen.text(), /test \(20\)/)
    // The excerpt and the base-branch comparison arrive after the step ("still loading").
    await waitUntil(showing(/AssertionError/), 'the log excerpt is shown')
    await waitUntil(showing(/unknown/), 'what could not be determined is labelled unknown')
    term.write('\x1b')
    await waitUntil(showing(/Why is CI red\?/, false), 'Esc closes the view')
    term.write('q')
    await waitForExit(term)
  } finally {
    await stopTerminal(term)
    removeTempDir(temp)
  }
}

// #279: Focus -> PR -> detail -> back -> issue -> detail -> back with real stdin. Coming back must
// restore the section, the selected row and the scroll position. 30 rows per section forces the window
// to scroll; `G` selects the last one so the first rows are provably out of view.
async function runFocusReturnFlow({ cols, rows, single = false }) {
  const temp = mkdtempSync(join(tmpdir(), 'lazyhub-pty-focus-'))
  const stubBin = installGhStub(temp)
  const screen = new TerminalScreen(cols, rows)
  const label = `${cols}x${rows}`
  let term
  try {
    term = spawnTerminal({ ...childEnv(stubBin, temp), LAZYHUB_GH_MANY: '30' }, [], { cols, rows })
    term.onData(data => screen.feed(data))
    const showing = (re, want = true) => () => (re.test(screen.text()) === want ? true : screen.text())
    const key = async (k, pause = 120) => { term.write(k); await new Promise(resolve => setTimeout(resolve, pause)) }
    // The row under the cursor: the marker and the number on one line.
    const selected = number => new RegExp(`▸\\s+#${number}\\b`)
    // The text of one dashboard section (its title row to its bottom border), since every section lists numbers.
    const sectionOf = title => {
      const lines = screen.text().split('\n')
      const start = lines.findIndex(l => l.includes(title))
      const end = lines.findIndex((l, i) => i > start && l.includes('╰'))
      return start < 0 ? '' : lines.slice(start, end < 0 ? undefined : end).join('\n')
    }

    await waitUntil(showing(/Focus/), `${label}: Focus on start`)
    await settle()
    await waitUntil(showing(selected(300)), `${label}: first PR selected on Focus`)

    // Section 1 (PRs): jump to the last row, so the window has scrolled away from the top.
    await key('G')
    await waitUntil(showing(selected(329)), `${label}: last PR selected`)
    assert.doesNotMatch(sectionOf('Review requested'), /#300\b/, `${label}: the window scrolled past the first PR`)
    const prView = screen.text()

    await key('\r')
    await waitUntil(showing(/Fixture body 329|#329 Fixture PR 329/), `${label}: the last PR opened in detail`)
    await key('\x1b')
    await waitUntil(showing(selected(329)), `${label}: PR row restored after Esc`)
    assert.doesNotMatch(sectionOf('Review requested'), /#300\b/, `${label}: PR scroll position restored`)
    assert.equal(screen.text().split('\n').find(l => selected(329).test(l)), prView.split('\n').find(l => selected(329).test(l)), `${label}: same row text`)

    // Section 3 (issues): same dance.
    await key(']')
    await key(']')
    if (single) await waitUntil(showing(/section 3\/3/), `${label}: one-section mode shows section 3/3`)
    await waitUntil(showing(selected(400)), `${label}: first issue selected in section 3`)
    await key('G')
    await waitUntil(showing(selected(429)), `${label}: last issue selected`)
    assert.doesNotMatch(sectionOf('Assigned issues'), /#400\b/, `${label}: the window scrolled past the first issue`)
    await key('\r')
    await waitUntil(showing(/Fixture issue body 429|#429 Fixture issue 429/), `${label}: the last issue opened in detail`)
    await key('\x1b')
    await waitUntil(showing(selected(429)), `${label}: issue row restored after Esc`)
    assert.doesNotMatch(sectionOf('Assigned issues'), /#400\b/, `${label}: issue scroll position restored`)
    if (single) assert.match(screen.text(), /section 3\/3/, `${label}: section 3 restored`)

    // The PR section kept its own selection while the issue section was active.
    await key('[')
    await key('[')
    await waitUntil(showing(selected(329)), `${label}: PR selection kept after visiting the issue section`)

    term.write('q')
    await waitForExit(term)
  } finally {
    await stopTerminal(term)
    removeTempDir(temp)
  }
}

// #485: key ownership with real stdin. `M` is the merged filter in the PR list (auto-merge moved into the
// merge picker, #448), and while the search box owns the keyboard, pane keys (`a` approve, `m` merge, `q`
// quit, `M`) are text: no confirm dialog opens, the app does not quit, and Esc hands the keys back.
async function runKeyOwnershipFlow() {
  const temp = mkdtempSync(join(tmpdir(), 'lazyhub-pty-keyown-'))
  const stubBin = installGhStub(temp)
  const screen = new TerminalScreen(120, 40)
  let term
  try {
    term = spawnTerminal(childEnv(stubBin, temp), [], { cols: 120, rows: 40 })
    term.onData(data => screen.feed(data))
    const showing = (re, want = true) => () => (re.test(screen.text()) === want ? true : screen.text())
    await waitUntil(showing(/Focus/), 'key-ownership flow startup')
    await settle()
    await sendUntil(() => writeChord(term, 'gp'), () => screen.text(), /PTY harness fixture PR/, 'PR list for the key-ownership flow')

    // M is the merged filter, never the auto-merge confirmation.
    term.write('M')
    await new Promise(resolve => setTimeout(resolve, 400))
    assert.doesNotMatch(screen.text(), /auto-merge/i, 'M must not open the auto-merge confirmation')
    term.write('O')
    await waitUntil(showing(/PTY harness fixture PR/), 'the open filter is back')

    // The search box owns the keyboard: pane keys are typed, not run.
    term.write('/')
    await new Promise(resolve => setTimeout(resolve, 300))
    for (const ch of 'qamM') term.write(ch)
    await waitUntil(showing(/qamM/), 'pane keys are typed into the search box')
    assert.doesNotMatch(screen.text(), /Approve PR|Merge PR|auto-merge/i, 'no write dialog opened under the search box')
    term.write('\x1b')
    await waitUntil(showing(/qamM/, false), 'Esc closes the search box')
    await waitUntil(showing(/Pull Requests/), 'the app is still running on the PR list')

    term.write('q')
    await waitForExit(term)
  } finally {
    await stopTerminal(term)
    removeTempDir(temp)
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
    await stopTmuxSession(session)
    removeTempDir(temp)
  }
}

const ptyProblem = nodePtyProblem(pty, ROOT)
if (ptyProblem) skipOrFail(`node-pty cannot spawn in this shell: ${ptyProblem}`)

await runLazyhubFlow()
await runReferenceFlow()
await runFirstRunFlow()
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
await runColdStartFlow()
await runFailedLogFlow()
await runKeyOwnershipFlow()
await runFocusReturnFlow({ cols: 100, rows: 40 })
await runFocusReturnFlow({ cols: 80, rows: 24 })
await runFocusReturnFlow({ cols: 60, rows: 16, single: true })

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
