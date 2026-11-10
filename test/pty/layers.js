// WARM-GH gate (#597, lane V3): overlays are layers and navigation keeps views alive, so none of these
// may spawn a gh process once the data they show is cached and fresh:
//   - open + close of help, the command palette and the AI assistant over the PR list,
//   - list -> detail -> back (after the detail has loaded),
//   - re-entering the same detail within its freshness window (reported only: the detail's files query is V4a's).
// Every gh call of the fake gh is logged (LAZYHUB_GH_LOG); the script counts the lines written during
// each step. Set LAZYHUB_LAYERS_REPORT_ONLY=1 to print the numbers without asserting (baseline runs).
import assert from 'assert/strict'
import { mkdtempSync, readFileSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { delimiter, dirname, join } from 'path'
import pty from 'node-pty'
import { removeTempDir, stopTerminal } from './cleanup.js'
import { nodePtyProblem, skipOrFail, TerminalScreen } from './fixtures.js'
import { installShim } from '../support/gh-shim/shim.mjs'

const ROOT = new URL('../..', import.meta.url).pathname
const BIN = join(ROOT, 'dist', 'lazyhub.js')
const REPORT_ONLY = process.env.LAZYHUB_LAYERS_REPORT_ONLY === '1'
// eslint-disable-next-line no-control-regex
const CLEAR = /\x1b\[[23]J/g
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

const ptyProblem = nodePtyProblem(pty, ROOT)
if (ptyProblem) skipOrFail(`node-pty cannot spawn in this shell: ${ptyProblem}`)

const temp = mkdtempSync(join(tmpdir(), 'lazyhub-pty-layers-'))
const stubBin = dirname(installShim(join(temp, 'bin'), 'pty'))
const ghLog = join(temp, 'gh.log')
const screen = new TerminalScreen(100, 30)
let term
const callLines = () => (existsSync(ghLog) ? readFileSync(ghLog, 'utf8').split('\n').filter(Boolean) : [])
const calls = () => callLines().length
let lastCounted = []
async function waitFor(pattern, label, timeoutMs = 15000) {
  const started = Date.now()
  while (!pattern.test(screen.text())) {
    if (Date.now() - started > timeoutMs) throw new Error(`timed out waiting for ${label}\n${screen.text()}`)
    await sleep(50)
  }
}
async function step(keys, settleMs = 700) { term.write(keys); await sleep(settleMs) }
/** Run `fn` and return how many gh calls it caused. */
async function counted(fn) { const before = calls(); await fn(); await sleep(500); lastCounted = callLines().slice(before); return lastCounted.length }

try {
  term = pty.spawn(process.execPath, [BIN], {
    name: 'xterm-256color', cols: 100, rows: 30, cwd: ROOT,
    env: {
      PATH: `${stubBin}${delimiter}${process.env.PATH}`, HOME: temp, USER: process.env.USER || 'lazyhub',
      GHUI_REPO: 'saketh-kowtha/lazyhub', TERM: 'xterm-256color', COLORTERM: 'truecolor', NO_COLOR: '1',
      LAZYHUB_NO_DAEMON: '1', LAZYHUB_GH_MANY: '30', LAZYHUB_GH_LOG: ghLog,
    },
  })
  let stream = ''
  term.onData(data => { stream += data; screen.feed(data) })
  await waitFor(/Focus/, 'first paint')
  await sleep(600)
  term.write('2') // Pull Requests
  await waitFor(/Fixture PR 300/, 'the PR list')
  await sleep(1500)
  await step('j', 300); await step('j', 300)
  await sleep(1500) // the focused row's preview fetch is the list's own, not an effect of an overlay
  const firstPaint = stream.length

  const overlays = await counted(async () => {
    await step('?'); await waitFor(/Keyboard Reference/, 'help'); await step('\x1b')
    await step(':'); await step('\x1b')
    await step('\x01'); await step('\x1b')
  })
  await waitFor(/30 items/, 'the list after the overlays')

  await step('\r', 400)
  await waitFor(/Fixture body \d+/, 'detail')
  const opened = /Fixture body (\d+)/.exec(screen.text())[1]
  await sleep(1500)
  const back = await counted(async () => { await step('\x1b') })
  await waitFor(/30 items/, 'the list after back')
  const reentry = await counted(async () => { await step('\r', 600); await step('\x1b') })
  const reentryCalls = lastCounted.join(' ')
  const clears = (stream.slice(firstPaint).match(CLEAR) || []).length

  process.stdout.write(`WARM-GH: overlays open+close ${overlays}, list->detail->back ${back}, detail re-entry ${reentry}${reentry ? ` (${reentryCalls.slice(0, 300)})` : ''}; CLEAR ${clears}; detail opened #${opened} after two j (cursor kept: ${opened === '302'})\n`)
  if (!REPORT_ONLY) {
    assert.equal(overlays, 0, 'help/palette/AI open+close must not spawn gh')
    assert.equal(back, 0, 'list -> detail -> back must not spawn gh')
    // Detail re-entry is reported, not gated: the detail's own files query is not cached yet (lane V4a owns it).
    assert.equal(clears, 0, 'no full-terminal clear')
    assert.equal(opened, '302', 'the list cursor survives the overlays')
  }
  term.write('q')
} finally {
  await stopTerminal(term)
  removeTempDir(temp)
}
process.stdout.write('PTY layers gate passed\n')
