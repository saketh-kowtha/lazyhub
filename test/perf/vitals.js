// TUI vitals harness (#597, V0): drives the built dist/lazyhub.js in an 80x24 PTY against the
// generated `perf` fake gh (300 ms per call) and prints the vitals table
// (#597): FMF-cold, FMF-warm, KTF, FLASH, CLEAR, WARM-GH, FRAME-BYTES, PRIVACY, and (#620) IDLE-WAKEUPS,
// IDLE-CPU and IDLE-RESUME over 60 s windows in which nothing changes.
// (REMOUNT is in-process: src/perf/vitals.mount.test.jsx. SHIFT, ROW-RENDER, ACT-GH and OPT-FB need
// the lanes that add the hooks they measure and are not reported yet.)
//
// Every gated metric must meet its target or the run exits non-zero (lane V6, the gate flip: CI runs this
// in the "Performance budget" job). EXPECT_FAIL is the escape hatch for a metric that is known to fail
// on main: it prints as "fail (baseline)" without turning the run red, and "FIXED: remove from
// EXPECT_FAIL" once it passes. It is empty: every metric is enforced. Reported-only metrics never gate.
//
// Run: npm run build && npm run vitals          (add --json for machine-readable output)
import { band, clearFrames, flashCount, idleWakeups, percentile } from '../../src/perf/vitals-metrics.js'
import { nodePtyProblem, skipOrFail } from '../pty/fixtures.js'
import pty from 'node-pty'
import { BIN, ROOT, VitalsSession, sleep } from './vitals-lib.js'
import { existsSync, readFileSync } from 'fs'
import { execFileSync } from 'child_process'

/** Metric ids whose value fails its target on main today (measured by this harness; see the PR). */
export const EXPECT_FAIL = new Set() // CLEAR went to 0 with #598, WARM-GH:reopen with #620's lane; all enforced

const problem = nodePtyProblem(pty, ROOT)
if (problem) skipOrFail(`node-pty cannot spawn: ${problem}`)
if (!existsSync(BIN)) skipOrFail('dist/lazyhub.js is missing: run npm run build first')

const listData = text => /\b\d+ of 5000\b/.test(text)
const issueData = text => /\b\d+ of 2000\b/.test(text)
/** The PR list is either showing rows, or its "loading"/"refreshing" placeholder; other screens are neither. */
const prListKind = text => (listData(text) ? 'data' : /Pull Requests\s+(loading|refreshing)/i.test(text) ? 'placeholder' : null)

const metrics = []
const IDLE_WINDOW_MS = 60_000
/** The shared clock (status bar age, relative times) is the one allowed idle wakeup: <= 6 per minute. */
const CLOCK_MAX = 6

/** CPU seconds (user + system) the app process has used so far, or NaN when it cannot be read. */
function cpuSeconds(pid) {
  try {
    if (process.platform === 'linux') {
      const fields = readFileSync(`/proc/${pid}/stat`, 'utf8').split(') ')[1].split(' ')
      return (Number(fields[11]) + Number(fields[12])) / 100 // utime + stime, in USER_HZ (100)
    }
    const [rest, frac = '0'] = execFileSync('ps', ['-o', 'time=', '-p', String(pid)]).toString().trim().split('.')
    const parts = rest.split(':').map(Number)
    return parts.reduce((acc, n) => acc * 60 + n, 0) + Number(`0.${frac}`)
  } catch {
    return NaN
  }
}

/**
 * Sit still for IDLE_WINDOW_MS and count the app's timer wakeups (recorder `wake` events) and its CPU.
 * @param {VitalsSession} s
 * @returns {Promise<{ wakes: ReturnType<typeof idleWakeups>, cpuPct: number }>}
 */
async function idleWindow(s) {
  const last = () => { const ev = s.events(); return ev.length ? ev[ev.length - 1].t : 0 }
  const from = last() + 0.001
  const cpu0 = cpuSeconds(s.term.pid)
  await sleep(IDLE_WINDOW_MS)
  const cpu1 = cpuSeconds(s.term.pid)
  return { wakes: idleWakeups(s.events(), from, Infinity), cpuPct: Math.round(((cpu1 - cpu0) / (IDLE_WINDOW_MS / 1000)) * 1000) / 10 }
}
const describeWakes = w => Object.entries(w.tags).map(([tag, n]) => `${tag} x${n}`)
const addIdle = (id, { wakes, cpuPct }) => {
  add(`IDLE-WAKEUPS:${id}`, wakes.other, `wakeups/60s (+${wakes.clock} clock)`, `0 (clock <=${CLOCK_MAX})`, wakes.other === 0 && wakes.clock <= CLOCK_MAX, { detail: describeWakes(wakes) })
  add(`IDLE-CPU:${id}`, cpuPct, '% of a core', 'reported only', true, { reported: true })
}
/** Short, argument-free description of a fake-gh call, for the report. */
const describeCall = c => `${c.args[0]} ${c.args[1] ?? ''} ${(c.args.find(a => a.startsWith('query=')) ?? '').replace(/\s+/g, ' ').slice(6, 60)} ${(c.args.find(a => a.startsWith('searchQuery=')) ?? '').slice(12, 40)}`.trim()
const add = (id, value, unit, target, ok, extra = {}) => metrics.push({ id, value, unit, target, ok, ...extra })

const session = new VitalsSession({ cols: 80, rows: 24 }).start()
try {
  await session.waitFor(text => text.includes('My open PRs'), 'the Focus screen')
  await sleep(800) // Ink attaches its key handler after the first paint

  // FMF-cold: the key that opens the PR list -> first frame with a data row.
  await session.press('g')
  const coldAt = performance.now()
  session.term.write('p')
  await session.waitFor(listData, 'the PR list rows')
  const cold = performance.now() - coldAt
  add('FMF-cold', Math.round(cold), 'ms', '<=1200', cold <= 1200, { band: band('FMF-cold', cold) })
  await sleep(600)

  // KTF-nav: 30 j presses, key -> first frame that changes the screen. FRAME-BYTES: bytes of that frame / grid.
  const navMs = []
  const navBytes = []
  for (let i = 0; i < 30; i++) {
    const mark = session.mark()
    navMs.push(await session.keyToFrame('j'))
    await sleep(60)
    const frame = session.frames(mark)[0]
    if (frame) navBytes.push(frame.bytes)
  }
  const navP95 = percentile(navMs.filter(Number.isFinite), 95)
  add('KTF-nav', Math.round(navP95), 'ms p95', '<=50 good / <=100 CI', navP95 <= 100, { band: band('KTF-nav', navP95) })
  const grid = 80 * 24
  const ratio = percentile(navBytes, 50) / grid
  add('FRAME-BYTES', Math.round(ratio * 10) / 10, 'x grid (median)', '<=1.5 good, reported only', true, { reported: true })

  // FMF-warm: leave for the issues list, come back to the PR list (cached, inside the freshness window).
  await session.press('gi')
  await session.waitFor(issueData, 'the issue list rows')
  await sleep(600)
  let since = Date.now()
  await session.press('g')
  const warmAt = performance.now()
  session.term.write('p')
  await session.waitFor(listData, 'the PR list rows again')
  const warm = performance.now() - warmAt
  add('FMF-warm', Math.round(warm), 'ms', '<=100', warm <= 100, { band: band('FMF-warm', warm) })
  await sleep(1500)
  const reopenCalls = session.calls().filter(c => c.t >= since)
  add('WARM-GH:reopen', reopenCalls.length, 'calls', '0', reopenCalls.length === 0, { detail: reopenCalls.map(describeCall) })

  // Window helper: run an action that starts and ends on the PR list; report gh calls, FLASH, clears.
  const overlay = async (id, open) => {
    const before = session.text()
    const mark = session.mark()
    since = Date.now()
    await open()
    await sleep(500)
    await session.press('\x1b')
    await session.waitFor(listData, `the PR list after closing ${id}`)
    await sleep(1500)
    const frames = session.frames(mark)
    const calls = session.calls().filter(c => c.t >= since).length
    add(`WARM-GH:${id}`, calls, 'calls', '0', calls === 0)
    const flash = flashCount([before, ...frames.map(f => f.text)], prListKind)
    add(`FLASH:${id}-close`, flash, 'count', '0', flash === 0)
    return frames.filter(f => f.clear).length
  }
  const clears = []
  clears.push(await overlay('help', () => session.press('?')))
  clears.push(await overlay('palette', () => session.press(':')))

  // list -> detail -> back -> detail again.
  const beforeDetail = session.text()
  let mark = session.mark()
  await session.press('\r')
  await session.waitFor(text => !listData(text), 'the PR detail')
  await sleep(1500) // let the detail's own cold fetches finish; WARM-GH counts what happens next
  since = Date.now()
  await session.press('\x1b')
  await session.waitFor(listData, 'the PR list after back')
  await sleep(1500)
  const backCalls = session.calls().filter(c => c.t >= since).length
  add('WARM-GH:back', backCalls, 'calls', '0', backCalls === 0)
  const backFlash = flashCount([beforeDetail, ...session.frames(mark).map(f => f.text)], prListKind)
  add('FLASH:back-nav', backFlash, 'count', '0', backFlash === 0)
  clears.push(session.frames(mark).filter(f => f.clear).length)
  since = Date.now()
  await session.press('\r')
  await session.waitFor(text => !listData(text), 'the PR detail again')
  await sleep(1500)
  const reenter = session.calls().filter(c => c.t >= since).length
  add('WARM-GH:reenter', reenter, 'calls', '0', reenter === 0)
  await session.press('\x1b')
  await session.waitFor(listData, 'the PR list')
  await sleep(500)

  // Manual refresh keeps the rows on screen.
  const beforeRefresh = session.text()
  mark = session.mark()
  await session.press('r')
  await sleep(2000)
  const refreshFrames = session.frames(mark)
  const refreshFlash = flashCount([beforeRefresh, ...refreshFrames.map(f => f.text)], prListKind)
  add('FLASH:refresh', refreshFlash, 'count', '0', refreshFlash === 0)
  clears.push(refreshFrames.filter(f => f.clear).length)

  // KTF-open: Enter on the list -> first frame that differs.
  const open = await session.keyToFrame('\r')
  add('KTF-open', Math.round(open), 'ms', '<=100 good / <=200', open <= 200, { band: band('KTF-open', open) })
  await sleep(1200)
  await session.press('\x1b')
  await sleep(600)

  // CLEAR: frames carrying a full-terminal clear after first paint, whole session (recorder) and per window (PTY bytes).
  const events = session.events()
  const sessionClears = clearFrames(events)
  const totalFrames = events.filter(e => e.type === 'frame').length
  add('CLEAR', sessionClears, `of ${totalFrames} frames`, '0', sessionClears === 0, { windowClears: clears })

  // PRIVACY: nothing the fake gh returned may appear in what the recorder wrote.
  const written = session.rawVitals()
  const leaked = ['Perf PR', 'octocat', 'hubot', 'mona', 'feature/perf', 'saketh', 'o/r'].filter(word => written.includes(word))
  add('PRIVACY', leaked.length, 'fixture strings', '0', written.length > 0 && leaked.length === 0, { detail: leaked })

  // IDLE-WAKEUPS:covered (#620): the issue detail polls every 30 s; under the help overlay it is covered
  // and must not wake (the app is not idle yet: the default idle period is 2 minutes).
  await session.press('gi')
  await session.waitFor(issueData, 'the issue list rows')
  await sleep(600)
  await session.press('\r')
  await session.waitFor(text => !issueData(text), 'the issue detail')
  await sleep(2500)
  await session.press('?')
  await sleep(1000)
  addIdle('covered', await idleWindow(session))
} finally {
  session.stop()
}

// IDLE-WAKEUPS:idle (#620): a session with a 3 s idle period sits on the issue detail (a polling view).
// After the idle period nothing may wake but the shared clock; the next key refreshes the overdue poll.
const idleSession = new VitalsSession({ cols: 80, rows: 24, env: { LAZYHUB_IDLE_MS: '3000' } }).start()
try {
  await idleSession.waitFor(text => text.includes('My open PRs'), 'the Focus screen')
  await sleep(800)
  await idleSession.press('gi')
  await idleSession.waitFor(issueData, 'the issue list rows')
  await sleep(600)
  await idleSession.press('\r')
  await idleSession.waitFor(text => !issueData(text), 'the issue detail')
  await sleep(2500 + 3000 + 500) // its cold fetches, then the idle period
  addIdle('idle', await idleWindow(idleSession))
  const since = Date.now()
  await idleSession.press('j')
  await sleep(2500)
  const resumed = idleSession.calls().filter(c => c.t >= since).length
  add('IDLE-RESUME', resumed, 'gh calls', '>=1 (overdue poll runs on the first key)', resumed >= 1)
} finally {
  idleSession.stop()
}

const json = process.argv.includes('--json')
let regressions = 0
const lines = metrics.map(m => {
  const baseline = EXPECT_FAIL.has(m.id)
  const status = m.reported ? 'reported' : m.ok ? (baseline ? 'FIXED: remove from EXPECT_FAIL' : 'ok') : baseline ? 'fail (baseline)' : 'FAIL'
  if (!m.ok && !baseline && !m.reported) regressions += 1
  return { ...m, status }
})
if (json) process.stdout.write(`${JSON.stringify(lines, null, 2)}\n`)
else {
  const w = Math.max(...lines.map(l => l.id.length))
  process.stdout.write(`TUI vitals (80x24, fake gh ${300} ms/call)\n`)
  for (const l of lines) process.stdout.write(`  ${l.id.padEnd(w)}  ${String(l.value).padStart(6)} ${l.unit.padEnd(16)} target ${l.target.padEnd(22)} ${l.band ? `[${l.band}] ` : ''}${l.status}${l.detail?.length ? `  <- ${l.detail.join('; ')}` : ''}\n`)
}
process.exit(regressions ? 1 : 0)
