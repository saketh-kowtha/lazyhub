// Review Alpha gate (#295): the complete read-only maintainer journey, on real PTYs, with the fixture gh
// in test/support/gh-shim/alpha.mjs. No provider, App, MCP or AI configuration exists in any run.
//
// Flows (each has its own throwaway HOME, repository and stub `open`):
//   journey      first launch inside a repo (picker) -> Focus -> queue -> why -> evidence -> back (row kept) -> queue keys -> q
//   boundary     approve / merge / request-changes / close / merged-filter keys in the queue and the evidence view:
//                no gh write, no confirm dialog (with a positive control: the same key opens a dialog in the PR detail)
//   narrow       the journey at 80x24 as a return launch (saved repository, no picker): every frame fits, nothing wraps
//   ascii        LANG=C at 120x30: the whole journey is ASCII; NO_COLOR is set in every flow, so no colour codes at all
//   empty/auth/rate   the queue's empty state and its two day-one failures, each with the cause
//   hostile      GitHub text full of OSC 52 / OSC 8 / CSI / BEL / ESC reaches the terminal as none of them
//
// Waits are on screen text. The only fixed pause is the short gap between the keys of a chord or burst, which
// the app must receive as separate key events. A negative assertion ("nothing happened") is ordered behind a
// positive probe key whose effect proves the earlier keys were handled.
import assert from 'assert/strict'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { delimiter, join } from 'path'
import pty from 'node-pty'
import { removeTempDir, stopTerminal } from './cleanup.js'
import { nodePtyProblem, skipOrFail, TerminalScreen } from './fixtures.js'
import { installShim } from '../support/gh-shim/shim.mjs'
import { makeRepo } from '../support/launch-harness.mjs'
import { classifyGh } from '../../src/daemon/protocol.js'

const ROOT = new URL('../..', import.meta.url).pathname
const BIN = join(ROOT, 'dist', 'lazyhub.js')
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

const ptyProblem = nodePtyProblem(pty, ROOT)
if (ptyProblem) skipOrFail(`node-pty cannot spawn in this shell: ${ptyProblem}`)

async function waitUntil(check, label, timeoutMs = 10000) {
  const startedAt = Date.now()
  for (;;) {
    const verdict = check()
    if (verdict === true) return
    if (Date.now() - startedAt > timeoutMs) throw new Error(`alpha journey: timed out waiting for ${label}\n--- screen ---\n${verdict}`)
    await sleep(40)
  }
}

/** Start lazyhub inside a throwaway repository whose origin is acme/platform, with the alpha fixture gh. */
function start({ cols = 100, rows = 30, env = {}, saved = true } = {}) {
  const temp = mkdtempSync(join(tmpdir(), 'lazyhub-pty-alpha-'))
  const bin = join(temp, 'bin')
  mkdirSync(bin, { recursive: true })
  installShim(bin, 'alpha')
  // The journey must never open a browser or touch the clipboard: stubs that record the call.
  const opened = join(temp, 'opened.log')
  for (const name of ['open', 'xdg-open', 'pbcopy']) {
    writeFileSync(join(bin, name), `#!/bin/sh\necho "${name} $*" >> ${JSON.stringify(opened)}\n`)
    chmodSync(join(bin, name), 0o755)
  }
  const cwd = makeRepo(join(temp, 'work', 'platform'), { origin: 'https://github.com/acme/platform.git' })
  // A return launch has a saved repository (#290) and goes straight to Focus; a first launch shows the picker.
  if (saved) {
    mkdirSync(join(temp, '.config', 'lazyhub'), { recursive: true })
    writeFileSync(join(temp, '.config', 'lazyhub', 'lazyhub.toml'), '[defaults]\nrepo = "acme/platform"\n')
  }
  const ghLog = join(temp, 'gh.log')
  writeFileSync(ghLog, '')
  const screen = new TerminalScreen(cols, rows)
  const s = { temp, screen, stream: '', opened, ghLog, term: null }
  s.term = pty.spawn(process.execPath, [BIN], {
    name: 'xterm-256color', cols, rows, cwd,
    env: {
      PATH: `${bin}${delimiter}${process.env.PATH}`, HOME: temp, XDG_CONFIG_HOME: join(temp, '.config'), USER: process.env.USER || 'lazyhub',
      TERM: 'xterm-256color', COLORTERM: 'truecolor', NO_COLOR: '1', LAZYHUB_NO_DAEMON: '1',
      GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null', LAZYHUB_GH_LOG: ghLog, ...env,
    },
  })
  s.exited = new Promise(resolve => s.term.onExit(resolve))
  s.term.onData(data => { s.stream += data; screen.feed(data) })
  s.text = () => screen.text()
  s.showing = (re, want = true) => () => (re.test(screen.text()) === want ? true : screen.text())
  s.waitFor = (re, label, timeoutMs) => waitUntil(s.showing(re), label, timeoutMs)
  s.gone = (re, label) => waitUntil(s.showing(re, false), label)
  s.write = keys => s.term.write(keys)
  /** Keys written back to back reach Ink as ONE input string, so each key of a chord or a burst gets its own turn. */
  s.keys = async keys => { for (const ch of keys) { s.term.write(ch); await sleep(50) } }
  /**
   * Ink attaches its key handler after the first paint and drops keys sent before that, leaving no output
   * to wait on. `?` toggles the help overlay: re-send it until the overlay shows, then close it.
   */
  s.ready = async () => {
    await s.waitFor(/Focus|Review requested/, 'the Focus screen')
    for (let attempt = 0; ; attempt += 1) {
      s.write('?')
      try { await waitUntil(s.showing(/Keyboard Reference/), 'help overlay', 2500); break } catch (error) { if (attempt >= 5) throw error }
    }
    s.write('\x1b')
    await s.gone(/Keyboard Reference/, 'help overlay closed')
    await s.waitFor(/Enter open|j\/k nav/, 'the pane footer is back')
  }
  /** Re-send an idempotent key until the screen reacts: a freshly mounted pane may not have its handler yet. */
  s.sendUntil = async (keys, re, label) => {
    for (let attempt = 0; ; attempt += 1) {
      s.write(keys)
      try { await waitUntil(s.showing(re), label, 2500); return } catch (error) { if (attempt >= 4) throw error }
    }
  }
  /** Scroll a long view with j until a row is on screen (a short terminal shows only the top of the evidence). */
  s.scrollTo = async (re, label) => {
    for (let step = 0; step < 40 && !re.test(screen.text()); step += 1) { s.write('j'); await sleep(60) }
    await s.waitFor(re, label)
  }
  /** g q. A chord swallowed whole (a pane still mounting) leaves Focus on screen, so it is sent again; a half-delivered one would quit the app, which fails loudly. */
  s.openQueue = async () => {
    for (let attempt = 0; ; attempt += 1) {
      await s.keys('gq')
      try { await waitUntil(s.showing(/Review queue/), 'the review queue', 3000); return } catch (error) { if (attempt >= 3) throw error }
    }
  }
  s.ghCalls = () => (existsSync(ghLog) ? readFileSync(ghLog, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line)) : [])
  s.quit = async () => {
    s.write('q')
    await Promise.race([s.exited, sleep(4000)])
  }
  s.close = async () => { await stopTerminal(s.term); removeTempDir(temp) }
  return s
}

// The group chips mark the current group with brackets; the row marker is the cursor.
const START_GROUP = /\[\S+ Start \d+\]/
const REVIEW_GROUP = /\[\S+ Review \d+\]/
const cursorOn = id => new RegExp(`[▶>]\\s+\\S*${id}`)
const mutating = args => classifyGh(args) === 'write'
  || (args[0] === 'pr' && ['merge', 'review', 'close', 'edit', 'comment', 'ready', 'reopen'].includes(args[1]))
  || (args[0] === 'api' && args.some(a => /(^|[^A-Za-z])mutation\s*[({]/.test(a) || /^(-X|--method)$/i.test(a) || /^(POST|PUT|PATCH|DELETE)$/.test(a)))
const queueReads = s => s.ghCalls().filter(a => a[0] === 'api' && a.some(x => x.includes('reviewRequested: search')))
/** Strings only a confirm / write dialog would draw. */
const DIALOG = /Approve PR|Merge PR|Close PR|Request changes|Squash and merge|auto-merge|\(y\/n\)|Confirm|Are you sure/i

async function runJourney({ cols, rows, label, ascii = false, firstRun = false }) {
  const s = start({ cols, rows, env: ascii ? { LANG: 'C', LC_ALL: 'C' } : {}, saved: !firstRun })
  try {
    if (firstRun) {
      // First launch inside the repo, nothing named anywhere: the picker offers the launch directory's repository.
      await s.waitFor(/Pick a repository to open/, `${label}: the first-run repository list`)
      assert.match(s.text(), /acme\/platform\s+\(current directory\)/, `${label}: the picker offers the repository of the launch directory`)
      // Keys sent before Ink attaches its handler are dropped: re-send Enter until Focus shows.
      for (let attempt = 0; ; attempt += 1) {
        s.write('\r')
        try { await waitUntil(s.showing(/Focus|Review requested/), 'Focus after one key', 2500); break } catch (error) { if (attempt >= 5) throw error }
      }
    }
    await s.ready()
    assert.match(s.text(), /acme\/platform/, `${label}: Focus shows the repository`)

    // 1. Focus -> queue. Every row says why it is there; the strip repeats it for the cursor row.
    await s.openQueue()
    await s.waitFor(/scope: (repo|account)/, `${label}: the scope line`)
    // Once the repo scope (#177 amendment, #643) is on main the queue starts on the launch repository and this
    // branch is the only path; before that the queue is account-wide from the start and the branch is skipped.
    if (/scope: repo/.test(s.text())) {
      assert.match(s.text(), /scope: repo acme\/platform\b/, `${label}: the queue starts on exactly the launch repository`)
      await s.waitFor(/platform#412/, `${label}: the launch repository's rows`)
      assert.doesNotMatch(s.text(), /ledger#88/, `${label}: no other repository's PR is shown in the repo scope`)
      await s.sendUntil('s', /scope: account/, `${label}: s cycles the scope on to account`)
    }
    await s.waitFor(/platform#412/, `${label}: queue rows`)
    await s.waitFor(/ledger#88/, `${label}: second queue row`)
    const row = text => s.text().split('\n').find(l => l.includes(text)) || ''
    assert.match(row('platform#412'), cols < 100 ? /review requested/ : /review requested of you/, `${label}: the row names the attention reason`)
    assert.match(row('ledger#88'), cols < 100 ? /via/ : /via team @acme\/core/, `${label}: a team request is worded as unverified (the full wording is in the strip)`)
    await s.waitFor(/why\s+review requested of you/, `${label}: the why strip`)
    assert.match(s.text(), /scope: account.*read-only/, `${label}: the scope line says account-wide and read-only, also at 80 columns`)
    assert.doesNotMatch(s.text(), /focus\s+·|⟳ \d+s ago|⟳ just now/, `${label}: the bottom status line does not show the pane the queue was opened from`)
    await s.waitFor(/updated/, `${label}: the queue says how fresh it is`)

    // The queue opens on Start here (#177 phase 2): ranked, with the rank keys of the cursor row named.
    await s.waitFor(START_GROUP, `${label}: the queue opens on Start here`)
    await s.waitFor(/rank\s+\d+ of \d+: Needs you > review/, `${label}: the strip names the rank keys`)
    assert.match(s.text(), /NEEDS YOU \d+/, `${label}: Start here lists its sections`)

    // 2. Footer / help actions are live. ] and [ switch group, r refreshes, + loads the next page, o opens the browser.
    s.write(']')
    await s.waitFor(REVIEW_GROUP, `${label}: ] moves to the next group`)
    s.write('[')
    await s.waitFor(START_GROUP, `${label}: [ moves back`)
    const loads = queueReads(s).length
    s.write('r')
    await waitUntil(() => (queueReads(s).length > loads ? true : 'r did not refetch'), `${label}: r refetches the queue`)
    // A load key sent while the refresh is still in flight is ignored by design; + is safe to re-send.
    await s.sendUntil('+', /platform#77/, `${label}: + loads the next page`)
    s.write('o')
    await waitUntil(() => (existsSync(s.opened) && /pull\/\d+/.test(readFileSync(s.opened, 'utf8')) ? true : 'o did not call the (stub) browser opener'), `${label}: o opens the PR URL`)
    s.write('?')
    await s.waitFor(/Keyboard Reference/, `${label}: ? opens help`)
    // The queue's own keys come first, so even 80x24 lists them.
    for (const shown of [/Queue view/, /Enter\s+Open the selected/, /Next status/, /Cycle the queue/, /Load the next page/]) await s.waitFor(shown, `${label}: help lists ${shown}`)
    assert.doesNotMatch(s.text(), /Approve|Merge/, `${label}: the queue help advertises no write`)
    s.write('\x1b')
    await s.gone(/Keyboard Reference/, `${label}: help closes`)

    // 3. Cursor to the second row, open its evidence, come back to the same row.
    s.write('j')
    await s.waitFor(cursorOn('ledger#88'), `${label}: cursor on the second row`)
    await waitUntil(() => (/ledger#88.*(via|team)/.test(row('ledger#88')) ? true : row('ledger#88')), `${label}: the row is fully drawn`)
    const pickedRow = row('ledger#88')
    s.write('\r')
    await s.waitFor(/acme\/ledger#88/, `${label}: the evidence view of the picked PR`)
    await s.waitFor(/read-only/, `${label}: evidence view says read-only`)
    await s.waitFor(/back to queue/, `${label}: evidence footer names where Esc goes`)

    // 4. Partial evidence: freshness is stated, and what could not be read says unknown, not fine.
    await s.waitFor(/Revision/, `${label}: the revision section`)
    assert.match(s.text(), /read\s+\d+s ago/, `${label}: the evidence says how old the read is`)
    await s.scrollTo(/Attention/, `${label}: the attention section`)
    assert.match(s.text(), /review_requested\s+from review_requests: via team @acme\/core/, `${label}: the evidence gives the same attention reason as the queue row, with "via team"`)
    assert.doesNotMatch(s.text(), /no attention reason from the facts below/, `${label}: the evidence does not claim there is no attention reason`)
    await s.scrollTo(/Not read/, `${label}: the evidence lists what it could not read`)
    assert.match(s.text(), /files\s+\S{0,2}unknown \(gh: Something went wrong/, `${label}: the unreadable file list is labelled unknown, with the cause`)
    assert.doesNotMatch(s.text(), /no_test_files_changed/, `${label}: no file observation is invented when the list failed`)

    s.write('\x1b')
    await s.waitFor(/Review queue/, `${label}: Esc returns to the queue`)
    await s.waitFor(cursorOn('ledger#88'), `${label}: position kept`)
    await s.waitFor(START_GROUP, `${label}: group kept`)
    await waitUntil(() => (row('ledger#88') === pickedRow ? true : `${row('ledger#88')}\n!= ${pickedRow}`), `${label}: the same row is under the cursor after coming back`)
    assert.equal(queueReads(s).length, loads + 2, `${label}: coming back reuses the loaded rows (only r and + read the queue)`)

    // 5. q leaves the queue for the pane it came from.
    s.write('q')
    await s.gone(/Review queue/, `${label}: the queue is closed`)
    await s.waitFor(/Focus|Review requested/, `${label}: q returns to the pane`)

    // eslint-disable-next-line no-control-regex
    if (ascii) assert.doesNotMatch(s.text(), /[^\x00-\x7f]/, `${label}: LANG=C renders ASCII only`)
    // eslint-disable-next-line no-control-regex
    assert.doesNotMatch(s.stream, /\x1b\[(?:3[0-7]|9[0-7]|4[0-7]|38|48)[;0-9]*m/, `${label}: NO_COLOR emits no colour codes`)
    if (rows <= 24) {
      assert.equal(s.screen.wraps, 0, `${label}: nothing wider than ${cols} columns was written`)
      assert.ok(s.text().split('\n').every(l => [...l].length <= cols), `${label}: every row fits ${cols} columns`)
    }
    assert.deepEqual(s.ghCalls().filter(mutating), [], `${label}: the journey made no GitHub write`)
    await s.quit()
  } finally {
    await s.close()
  }
}

async function runBoundary() {
  const s = start()
  try {
    await s.ready()
    // Positive control: in the PR detail the same key does open a write dialog, so DIALOG can see one.
    await s.keys('gp')
    await s.waitFor(/PTY harness fixture PR|Pull Requests/, 'the PR list')
    await s.sendUntil('\r', /Fixture body/, 'control: the PR detail')
    await s.sendUntil('a', DIALOG, 'control: a opens the approve dialog in the PR detail')
    s.write('\x1b')
    await s.gone(DIALOG, 'control: the dialog closes')

    await s.openQueue()
    await s.waitFor(/platform#412/, 'queue rows')
    // approve, merge, request changes, close, merged filter, auto-merge, comment, labels, edit: none may act.
    const KEYS = 'amxXMAcle'
    await s.keys(KEYS)
    // Probe: ] is handled by the queue only when no dialog took the keyboard, and its effect proves the keys above were consumed first.
    s.write(']')
    await s.waitFor(REVIEW_GROUP, 'the queue handled ] after the write keys (no dialog took the keyboard)')
    assert.doesNotMatch(s.text(), DIALOG, 'no confirm dialog is on screen in the queue')
    s.write('[')
    await s.waitFor(START_GROUP, 'back to the first group')

    // Evidence view: the same keys, then d (a read) proves they were consumed.
    s.write('\r')
    await s.waitFor(/acme\/platform#412/, 'the evidence view')
    await s.waitFor(/Revision/, 'evidence rows')
    await s.keys(KEYS)
    s.write('d')
    await s.gone(/Evidence\s+acme\/platform#412/, 'd opens the read-only diff, which proves the earlier keys were consumed')
    s.write('\x1b')
    await s.waitFor(/Evidence\s+acme\/platform#412/, 'Esc leaves the diff for the evidence view')
    assert.doesNotMatch(s.text(), DIALOG, 'no confirm dialog is on screen in the evidence view')
    s.write('\x1b')
    await s.waitFor(/Review queue/, 'Esc returns to the queue')

    assert.deepEqual(s.ghCalls().filter(mutating), [], 'no gh write from any key')
    const reviewStream = s.stream.slice(s.stream.lastIndexOf('Review queue'))
    assert.doesNotMatch(reviewStream, /Approve PR|Merge PR|Close PR|Request changes/, 'no write dialog was ever drawn in the review context')
    await s.quit()
  } finally {
    await s.close()
  }
}

async function runQueueState({ name, env, expected, forbidden }) {
  const s = start({ env })
  try {
    await s.ready()
    await s.openQueue()
    await s.waitFor(expected, `${name}: ${expected}`)
    if (forbidden) assert.doesNotMatch(s.text(), forbidden, `${name}: ${forbidden}`)
    assert.deepEqual(s.ghCalls().filter(mutating), [], `${name}: no GitHub write`)
    // The queue is still a working view: q goes back.
    s.write('q')
    await s.gone(/Review queue/, `${name}: q leaves the queue`)
    await s.quit()
  } finally {
    await s.close()
  }
}

// BEL, OSC 52, OSC 8, the planted cursor move, a bare ESC Z and the 8-bit C1 introducers. The inert words of the
// payload may stay visible: sanitize() turns the ESC byte into a picture, so the sequence can no longer act.
// eslint-disable-next-line no-control-regex
const RAW_CONTROL = /\x07|\x1b\](?:52|8);|\x1b\[999;999H|\x1bZ|\x9b|\x9d/
async function runHostile() {
  const s = start({ env: { LAZYHUB_ALPHA_HOSTILE: '1', LAZYHUB_GH_FAILED_CHECK: '1' } })
  try {
    await s.ready()
    await s.openQueue()
    await s.waitFor(/platform#412\s+Retry in/, 'the hostile queue rows render: the escapes are stripped, the words stay')
    await s.waitFor(/why\s+review requested/, 'the why strip')
    s.write('\r')
    await s.waitFor(/acme\/platform#412/, 'the hostile evidence view')
    await s.scrollTo(/src\/retry\.js/, 'the hostile file path')
    await s.scrollTo(/Written by the author/, 'the author-written section')
    s.write('\r') // full PR detail: branch name, labels, body
    await s.waitFor(/Body 412/, 'the hostile PR detail')
    await s.sendUntil('c', /\[Ctrl\+R\] re-run/, 'checks mode')
    await s.sendUntil('\r', /AssertionError|Failure excerpt/, 'the hostile failing-check log')
    // A last positive probe orders the scan behind every frame above: f switches the viewer to the full log.
    s.write('f')
    await s.gone(/Failure excerpt/, 'f switches the log viewer to the full log')
    assert.doesNotMatch(s.stream, RAW_CONTROL, 'no BEL, OSC 52, OSC 8, planted CSI or C1 control reached the terminal')
    assert.ok(s.stream.includes('LINK'), 'the hostile text was rendered (its visible words are on screen)')
    assert.ok(!existsSync(s.opened), 'nothing opened a browser or touched the clipboard')
    assert.deepEqual(s.ghCalls().filter(mutating), [], 'no GitHub write')
    await s.quit()
  } finally {
    await s.close()
  }
}

const started = Date.now()
const timed = async (name, run) => {
  const at = Date.now()
  await run()
  process.stdout.write(`  alpha ${name}: ${((Date.now() - at) / 1000).toFixed(1)}s\n`)
}
await timed('first launch 100x30', () => runJourney({ cols: 100, rows: 30, label: 'first launch 100x30', firstRun: true }))
await timed('read-only boundary', runBoundary)
await timed('narrow 80x24', () => runJourney({ cols: 80, rows: 24, label: 'narrow 80x24' }))
await timed('ascii 120x30', () => runJourney({ cols: 120, rows: 30, label: 'ascii 120x30', ascii: true }))
await timed('empty queue', () => runQueueState({ name: 'empty queue', env: { LAZYHUB_ALPHA_QUEUE: 'empty' }, expected: /Nothing needs your attention here/ }))
await timed('auth failure', () => runQueueState({ name: 'auth failure', env: { LAZYHUB_ALPHA_QUEUE: 'auth' }, expected: /not signed in/i, forbidden: /platform#412/ }))
await timed('rate limit', () => runQueueState({ name: 'rate limit', env: { LAZYHUB_ALPHA_QUEUE: 'rate' }, expected: /rate limit/i, forbidden: /platform#412/ }))
await timed('display safety', runHostile)
process.stdout.write(`PTY Alpha journey passed in ${Math.round((Date.now() - started) / 1000)}s\n`)
