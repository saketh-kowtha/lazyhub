// TUI vitals harness (#597, V0): drives the built dist/lazyhub.js in an 80x24 PTY against the
// generated `perf` fake gh (300 ms per call) and prints the vitals table
// (#597): FMF-cold, FMF-warm, KTF, FLASH, CLEAR, WARM-GH, FRAME-BYTES, PRIVACY.
// (REMOUNT is in-process: src/perf/vitals.mount.test.jsx. SHIFT, ROW-RENDER, ACT-GH and OPT-FB need
// the lanes that add the hooks they measure and are not reported yet.)
//
// Metrics that fail on main today are EXPECTED-FAIL baselines (EXPECT_FAIL below): they print as
// "fail (baseline)" and never turn this run red. The run only exits non-zero when the harness itself
// breaks, or when a metric that is OK on main regresses. When a lane fixes a baseline the metric prints
// "FIXED: remove from EXPECT_FAIL"; the gate flip is lane V6.
//
// Run: npm run build && npm run vitals          (add --json for machine-readable output)
import { band, clearFrames, flashCount, percentile } from '../../src/perf/vitals-metrics.js'
import { nodePtyProblem, skipOrFail } from '../pty/fixtures.js'
import pty from 'node-pty'
import { BIN, ROOT, VitalsSession, sleep } from './vitals-lib.js'
import { existsSync } from 'fs'

/** Metric ids whose value fails its target on main today (measured by this harness; see the PR). */
export const EXPECT_FAIL = new Set(['CLEAR', 'WARM-GH:reopen'])

const problem = nodePtyProblem(pty, ROOT)
if (problem) skipOrFail(`node-pty cannot spawn: ${problem}`)
if (!existsSync(BIN)) skipOrFail('dist/lazyhub.js is missing: run npm run build first')

const listData = text => /\b\d+ of 5000\b/.test(text)
const issueData = text => /\b\d+ of 2000\b/.test(text)
/** The PR list is either showing rows, or its "loading"/"refreshing" placeholder; other screens are neither. */
const prListKind = text => (listData(text) ? 'data' : /Pull Requests\s+(loading|refreshing)/i.test(text) ? 'placeholder' : null)

const metrics = []
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
} finally {
  session.stop()
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
