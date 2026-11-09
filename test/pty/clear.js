// CLEAR gate (#597): a 50-key session in an 80x24 terminal must never make Ink clear the screen.
//
// Ink 4 writes `clearTerminal + whole output` whenever the rendered output is at least as tall as the
// terminal, so a root as tall as the terminal repaints (and flashes) the entire screen on every frame.
// The app keeps its root at most rows - 1 tall (useLayout); this asserts zero clear sequences
// (ESC[2J, ESC[3J, i.e. ansi-escapes clearTerminal) after the first paint. No resize happens here,
// because a resize legitimately wipes the screen.
//
// It also reports bytes written per keypress, to show the cost of a frame.
import assert from 'assert/strict'
import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { delimiter, dirname, join } from 'path'
import pty from 'node-pty'
import { removeTempDir, stopTerminal } from './cleanup.js'
import { nodePtyProblem, skipOrFail, TerminalScreen } from './fixtures.js'
import { installShim } from '../support/gh-shim/shim.mjs'

const ROOT = new URL('../..', import.meta.url).pathname
const BIN = join(ROOT, 'dist', 'lazyhub.js')
const COLS = 80
const ROWS = 24
// eslint-disable-next-line no-control-regex
const CLEAR = /\x1b\[[23]J/g

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

// Each step is [keys, label]. 50 keystrokes in all: navigation, open detail, back, help, refresh.
const SESSION = [
  ...'jjjjkkjjkkj'.split('').map(k => [k, 'navigate']),
  ['G', 'navigate'], ['g', 'navigate'], ['j', 'navigate'], ['j', 'navigate'],
  ['\r', 'open detail'], ['j', 'scroll detail'], ['j', 'scroll detail'], ['k', 'scroll detail'], ['\x1b', 'back'],
  ['?', 'help'], ['j', 'help'], ['\x1b', 'close help'],
  ['r', 'refresh'], ['j', 'navigate'], ['k', 'navigate'],
  ['\r', 'open detail'], ['\x1b', 'back'],
  ['?', 'help'], ['\x1b', 'close help'],
  ...'jkjkjkjkjkjkjk'.split('').map(k => [k, 'navigate']),
  ['r', 'refresh'], ['j', 'navigate'], ['\r', 'open detail'], ['\x1b', 'back'], ['?', 'help'], ['\x1b', 'close help'],
]
assert.equal(SESSION.length, 50, 'the CLEAR session is 50 keys')

const ptyProblem = nodePtyProblem(pty, ROOT)
if (ptyProblem) skipOrFail(`node-pty cannot spawn in this shell: ${ptyProblem}`)

const temp = mkdtempSync(join(tmpdir(), 'lazyhub-pty-clear-'))
const stubBin = dirname(installShim(join(temp, 'bin'), 'pty'))
const screen = new TerminalScreen(COLS, ROWS)
let term
try {
  term = pty.spawn(process.execPath, [BIN], {
    name: 'xterm-256color', cols: COLS, rows: ROWS, cwd: ROOT,
    env: {
      PATH: `${stubBin}${delimiter}${process.env.PATH}`, HOME: temp, USER: process.env.USER || 'lazyhub',
      GHUI_REPO: 'saketh-kowtha/lazyhub', TERM: 'xterm-256color', COLORTERM: 'truecolor', NO_COLOR: '1',
      LAZYHUB_NO_DAEMON: '1', LAZYHUB_GH_MANY: '30',
    },
  })
  let stream = ''
  term.onData(data => { stream += data; screen.feed(data) })

  const started = Date.now()
  while (!/Focus/.test(screen.text())) {
    if (Date.now() - started > 15000) throw new Error(`no first paint\n${screen.text()}`)
    await sleep(50)
  }
  await sleep(600) // Ink attaches its key handler after the first paint

  const firstPaint = stream.length
  let keyBytes = 0
  for (const [keys] of SESSION) {
    const before = stream.length
    term.write(keys)
    await sleep(150)
    keyBytes += stream.length - before
  }
  await sleep(300)

  const after = stream.slice(firstPaint)
  const clears = (after.match(CLEAR) || []).length
  process.stdout.write(`CLEAR: ${clears} clear sequences in ${SESSION.length} keys at ${COLS}x${ROWS}; ${Math.round(keyBytes / SESSION.length)} bytes written per keypress\n`)
  assert.equal(clears, 0, `CLEAR gate: ${clears} full-terminal clear sequences after first paint (Ink clears when output height >= terminal rows)\n--- screen ---\n${screen.text()}`)
  assert.match(screen.text(), /Focus|Pull Requests/, 'the app is still running after the session')
  term.write('q')
} finally {
  await stopTerminal(term)
  removeTempDir(temp)
}
process.stdout.write('PTY CLEAR gate passed\n')
