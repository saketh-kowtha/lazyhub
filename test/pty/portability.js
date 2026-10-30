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
import { installGhStub, nodePtyProblem, skipOrFail, TerminalScreen as Screen } from './fixtures.js'

const ROOT = new URL('../..', import.meta.url).pathname
const BIN = join(ROOT, 'dist', 'lazyhub.js')
const ptyProblem = nodePtyProblem(pty, ROOT)
if (ptyProblem) skipOrFail(`node-pty cannot spawn: ${ptyProblem}`)
const COLS = 80
const ROWS = 24
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

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
    const screen = new Screen(COLS, ROWS)
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
