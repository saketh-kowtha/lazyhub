// Terminal portability smoke (#311): lazyhub on an 80x24 TERM=linux console with
// a non-UTF-8 locale and NO_COLOR. Drives Focus -> PRs -> detail -> diff -> issues
// against the stub `gh`, replays the output through a tiny screen model, and
// asserts every screen is pure ASCII, uncolored, and fits 80x24 without scrolling.
//
//   npm run build && node test/pty/portability.js        (LAZYHUB_SHOW_SCREENS=1 prints them)
//
// Hermetic: temp HOME, stub gh, no network, no real ~/.config/lazyhub.
import assert from 'assert/strict'
import { appendFileSync, mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join, delimiter } from 'path'
import pty from 'node-pty'
import { installGhStub } from './fixtures.js'

const ROOT = new URL('../..', import.meta.url).pathname
const BIN = join(ROOT, 'dist', 'lazyhub.js')
const COLS = 80
const ROWS = 24
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

/** Minimal terminal model: the subset of escapes Ink emits (cursor up, erase line/screen, home, CR/LF). */
class Screen {
  constructor() { this.grid = Array.from({ length: ROWS }, () => Array(COLS).fill(' ')); this.r = 0; this.c = 0; this.scrolls = 0; this.wraps = 0; this.sgr = []; this.unhandled = new Set() }
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
    else if (cmd === 'C') this.c = Math.min(COLS - 1, this.c + n)
    else if (cmd === 'D') this.c = Math.max(0, this.c - n)
    else if (cmd === 'X') this.grid[this.r].fill(' ', this.c, this.c + n)
    else if (!'hlJKHfABG'.includes(cmd)) this.unhandled.add(cmd + params)
    else if (cmd === 'A') this.r = Math.max(0, this.r - n)
    else if (cmd === 'B') this.r = Math.min(ROWS - 1, this.r + n)
    else if (cmd === 'G') this.c = Math.max(0, n - 1)
    else if (cmd === 'H' || cmd === 'f') {
      const [row, col] = params.split(';').map(Number)
      this.r = Math.min(ROWS - 1, (row || 1) - 1); this.c = (col || 1) - 1
    } else if (cmd === 'K') {
      if (params === '2') this.grid[this.r].fill(' ')
      else if (params === '1') this.grid[this.r].fill(' ', 0, this.c + 1)
      else this.grid[this.r].fill(' ', this.c)
    } else if (cmd === 'J') {
      if (params === '2' || params === '3') this.grid.forEach(row => row.fill(' '))
      else if (params === '' || params === '0') { this.grid[this.r].fill(' ', this.c); for (let i = this.r + 1; i < ROWS; i++) this.grid[i].fill(' ') }
    }
  }
  put(ch) {
    if (ch === '\r') this.c = 0
    else if (ch === '\n') this.lineFeed()
    else if (ch >= ' ') {
      if (this.c >= COLS) { this.wraps += 1; this.c = 0; this.lineFeed() }
      this.grid[this.r][this.c] = ch
      this.c += 1
    }
  }
  lineFeed() {
    if (this.r < ROWS - 1) { this.r += 1; return }
    this.scrolls += 1
    this.grid.shift(); this.grid.push(Array(COLS).fill(' '))
  }
  text() { return this.grid.map(row => row.join('').trimEnd()).join('\n') }
}

const temp = mkdtempSync(join(tmpdir(), 'lazyhub-portability-'))
const traceFile = join(temp, 'gh-trace')
appendFileSync(traceFile, '')
const stubBin = installGhStub(temp, traceFile)
let raw = ''
let term
try {
  term = pty.spawn(process.execPath, [BIN], {
    name: 'linux', cols: COLS, rows: ROWS, cwd: ROOT,
    env: {
      PATH: `${stubBin}${delimiter}${process.env.PATH}`, HOME: temp, USER: 'lazyhub', GHUI_REPO: 'o/r',
      TERM: 'linux', LANG: 'C', NO_COLOR: '1', LAZYHUB_NO_DAEMON: '1', LAZYHUB_CACHE_DIR: join(temp, 'cache'),
    },
  })
  term.onData(data => { raw += data })

  const screens = {}
  const steps = [['focus', null], ['prs', 'gp'], ['detail', '\r'], ['diff', 'd'], ['back', '\x1b'], ['list', '\x1b'], ['issues', 'gi']]
  for (const [name, keys] of steps) {
    // Chords go one key at a time (Ink reads "gp" as a single string).
    if (keys) for (const ch of keys) { term.write(ch); await sleep(50) }
    await sleep(1500)
    const screen = new Screen()
    screen.feed(raw)
    screens[name] = screen
    if (process.env.LAZYHUB_SHOW_SCREENS) process.stdout.write(`--- ${name} --- unhandled: ${[...screen.unhandled]}\n${screen.text()}\n`)
  }
  term.write('q')
  await sleep(300)

  assert.doesNotMatch(raw, /[^\x00-\x7f]/, 'every byte written to a TERM=linux/LANG=C terminal must be ASCII')
  // eslint-disable-next-line no-control-regex
  assert.doesNotMatch(raw, /\x1b\[[0-9;]*(?<![0-9;])(?:3[0-9]|4[0-9]|9[0-7]|10[0-7]|38|48)[;m]/, 'NO_COLOR output must carry no color SGR codes')
  for (const [name, screen] of Object.entries(screens)) {
    assert.equal(screen.wraps, 0, `${name}: a line was wider than ${COLS} columns`)
  }

  const text = name => screens[name].text()
  assert.match(text('focus'), /Focus|Pull Requests/, 'focus screen rendered')
  assert.match(text('prs'), /PTY harness fixture PR/, 'PR list shows the PR title')
  assert.match(text('prs'), /Pull Requests/, 'PR list keeps its pane title')
  assert.match(text('prs'), /open\/closed\/merged . mine/, 'PR filter bar is not garbled at 80 columns')
  assert.match(text('detail'), /Fixture body/, 'PR detail shows the body')
  assert.match(text('diff'), /src\/alpha\.js/, 'diff shows the first file')
  assert.match(text('issues'), /Debug state fixture issue|Issues/, 'issues pane rendered')
  process.stdout.write('portability smoke passed (TERM=linux, LANG=C, NO_COLOR, 80x24)\n')
} finally {
  try { term?.kill() } catch {}
  rmSync(temp, { recursive: true, force: true })
}
