// Shared plumbing for the TUI vitals harness (#597, V0): a PTY session against the generated `perf`
// fake gh that records every PTY chunk with a timestamp, the screen state after each chunk (via the
// repo's TerminalScreen emulator, so no extra dependency), the fake-gh call log and the in-process
// recorder's JSONL (frames, clears, bytes). Local only: logs live in a temp dir that is removed.
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { delimiter, dirname, join } from 'path'
import pty from 'node-pty'
import { TerminalScreen } from '../pty/fixtures.js'
import { installShim } from '../support/gh-shim/shim.mjs'
import { parseEvents } from '../../src/perf/vitals-metrics.js'
import { hasClear } from '../../src/perf/vitals.js'

export const ROOT = new URL('../..', import.meta.url).pathname
export const BIN = join(ROOT, 'dist', 'lazyhub.js')
export const DELAY_MS = 300

export const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

/** The fake-gh call log (perf shim: one `{t, args}` JSON line per call, `t` = Date.now()). */
export function readGhLog(file) {
  if (!existsSync(file)) return []
  return readFileSync(file, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line))
}

/** Calls at or after `since` (Date.now() ms), excluding auth/version probes that are not view data. */
export function dataCallsSince(calls, since) {
  return calls.filter(c => c.t >= since && c.args[0] === 'api' && c.args[1] === 'graphql')
}

export class VitalsSession {
  /**
   * @param {object} [opts]
   * @param {number} [opts.cols]
   * @param {number} [opts.rows]
   * @param {number} [opts.delayMs] simulated gh round trip
   */
  constructor({ cols = 80, rows = 24, delayMs = DELAY_MS } = {}) {
    this.cols = cols
    this.rows = rows
    this.delayMs = delayMs
    this.temp = mkdtempSync(join(tmpdir(), 'lazyhub-vitals-'))
    this.ghLog = join(this.temp, 'gh.log')
    this.vitalsFile = join(this.temp, 'vitals.jsonl')
    writeFileSync(this.ghLog, '')
    this.screen = new TerminalScreen(cols, rows)
    /** @type {{t: number, wall: number, data: string, text: string}[]} one entry per PTY chunk */
    this.states = []
    this.raw = ''
    this.term = null
  }

  start() {
    const stubBin = dirname(installShim(join(this.temp, 'bin'), 'perf'))
    this.term = pty.spawn(process.execPath, [BIN], {
      name: 'xterm-256color', cols: this.cols, rows: this.rows, cwd: ROOT,
      env: {
        PATH: `${stubBin}${delimiter}${process.env.PATH}`, HOME: this.temp, USER: 'lazyhub', GHUI_REPO: 'o/r',
        TERM: 'xterm-256color', COLORTERM: 'truecolor', NO_COLOR: '1', LAZYHUB_NO_DAEMON: '1',
        LAZYHUB_CACHE_DIR: join(this.temp, 'cache'),
        LAZYHUB_GH_DELAY_MS: String(this.delayMs), LAZYHUB_GH_LOG: this.ghLog,
        LAZYHUB_VITALS: '1', LAZYHUB_VITALS_FILE: this.vitalsFile,
      },
    })
    this.term.onData(data => {
      this.raw += data
      this.screen.feed(data)
      this.states.push({ t: performance.now(), wall: Date.now(), data, text: this.screen.text() })
    })
    return this
  }

  /**
   * Screen states per frame. A frame is one stdout write, but the PTY may deliver it in several chunks
   * (Ink clears, then draws), so chunks less than `gapMs` apart are one frame and the last text wins.
   * @param {number} [since] index into `states` (see mark())
   * @param {number} [gapMs]
   * @returns {{t: number, wall: number, text: string, bytes: number, clear: boolean}[]}
   */
  frames(since = 0, gapMs = 8) {
    const out = []
    let prev = -Infinity
    for (const st of this.states.slice(since)) {
      const bytes = Buffer.byteLength(st.data)
      if (st.t - prev > gapMs) out.push({ t: st.t, wall: st.wall, text: st.text, bytes, clear: hasClear(st.data) })
      else {
        const last = out[out.length - 1]
        last.text = st.text; last.bytes += bytes; last.clear ||= hasClear(st.data)
      }
      prev = st.t
    }
    return out
  }

  text() { return this.screen.text() }
  mark() { return this.states.length }
  calls() { return readGhLog(this.ghLog) }

  /** The recorder's events (frames flush every 64 events and on exit, so ask for a flush by waiting). */
  events() {
    return existsSync(this.vitalsFile) ? parseEvents(readFileSync(this.vitalsFile, 'utf8')) : []
  }

  /** The recorder file exactly as written (for the privacy grep). */
  rawVitals() {
    return existsSync(this.vitalsFile) ? readFileSync(this.vitalsFile, 'utf8') : ''
  }

  /** One key at a time: Ink reads a multi-character chunk as one input event. */
  async press(keys, gap = 25) {
    for (const key of keys) { this.term.write(key); await sleep(gap) }
  }

  /**
   * Resolve with elapsed ms from now until `test(text)` holds for the screen (checked on every PTY chunk).
   * @param {(text: string) => boolean} test
   * @param {string} label
   * @param {number} [timeoutMs]
   * @returns {Promise<number>}
   */
  waitFor(test, label, timeoutMs = 20000) {
    const started = performance.now()
    return new Promise((resolve, reject) => {
      const poll = setInterval(() => {
        if (test(this.screen.text())) { clearInterval(poll); resolve(performance.now() - started) }
        else if (performance.now() - started > timeoutMs) {
          clearInterval(poll)
          reject(new Error(`timed out waiting for ${label}\n--- screen ---\n${this.screen.text()}`))
        }
      }, 2)
    })
  }

  /** Time from writing `key` to the next PTY chunk that changes the screen. */
  async keyToFrame(key, timeoutMs = 3000) {
    const before = this.screen.text()
    const started = performance.now()
    this.term.write(key)
    for (;;) {
      const hit = this.states.find(s => s.t >= started && s.text !== before)
      if (hit) return hit.t - started
      if (performance.now() - started > timeoutMs) return NaN
      await sleep(1)
    }
  }

  stop() {
    try { this.term?.kill() } catch { /* already exited */ }
    rmSync(this.temp, { recursive: true, force: true })
  }
}
