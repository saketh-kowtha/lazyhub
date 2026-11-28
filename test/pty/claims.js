// Claims check PTY flow (#361) on the built binary, with the fixture gh in test/support/gh-shim/claims.mjs.
//
// Flows (each with its own throwaway HOME and stub open/xdg-open/pbcopy/git-free environment):
//   check     lazyhub owner/repo#186 -> V -> every claim with its status and evidence, j moves the selection,
//             A (no AI provider configured) fails closed with the deterministic result kept, Esc back, q
//   hostile   every GitHub-authored string carries OSC 52 / OSC 8 / CSI / BEL / C1 / bidi: none reaches the terminal
// Both assert that no gh call was a write.
import assert from 'assert/strict'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { delimiter, join } from 'path'
import pty from 'node-pty'
import { removeTempDir, stopTerminal } from './cleanup.js'
import { nodePtyProblem, skipOrFail, TerminalScreen } from './fixtures.js'
import { installShim } from '../support/gh-shim/shim.mjs'
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
    if (Date.now() - startedAt > timeoutMs) throw new Error(`claims flow: timed out waiting for ${label}\n--- screen ---\n${verdict}`)
    await sleep(40)
  }
}

function start({ cols = 120, rows = 32, env = {} } = {}) {
  const temp = mkdtempSync(join(tmpdir(), 'lazyhub-pty-claims-'))
  const bin = join(temp, 'bin')
  mkdirSync(bin, { recursive: true })
  installShim(bin, 'claims')
  const opened = join(temp, 'opened.log')
  for (const name of ['open', 'xdg-open', 'pbcopy']) {
    writeFileSync(join(bin, name), `#!/bin/sh\necho "${name} $*" >> ${JSON.stringify(opened)}\n`)
    chmodSync(join(bin, name), 0o755)
  }
  const ghLog = join(temp, 'gh.log')
  writeFileSync(ghLog, '')
  const screen = new TerminalScreen(cols, rows)
  const s = { temp, screen, stream: '', opened, term: null }
  s.term = pty.spawn(process.execPath, [BIN, 'saketh-kowtha/lazyhub#186'], {
    name: 'xterm-256color', cols, rows, cwd: temp,
    env: {
      PATH: `${bin}${delimiter}${process.env.PATH}`, HOME: temp, XDG_CONFIG_HOME: join(temp, '.config'), USER: process.env.USER || 'lazyhub',
      GHUI_REPO: 'saketh-kowtha/lazyhub', TERM: 'xterm-256color', COLORTERM: 'truecolor', NO_COLOR: '1', LAZYHUB_NO_DAEMON: '1',
      // The AI pass must never reach a real provider: force the API provider with no key, so `A` fails closed offline.
      LAZYHUB_AI_PROVIDER: 'anthropic-api', LAZYHUB_GH_LOG: ghLog, ...env,
    },
  })
  s.exited = new Promise(resolve => s.term.onExit(resolve))
  s.term.onData(data => { s.stream += data; screen.feed(data) })
  s.showing = (re, want = true) => () => (re.test(screen.text()) === want ? true : screen.text())
  s.waitFor = (re, label, timeoutMs) => waitUntil(s.showing(re), label, timeoutMs)
  s.gone = (re, label) => waitUntil(s.showing(re, false), label)
  s.write = keys => s.term.write(keys)
  /** Re-send an idempotent key until the screen reacts: a freshly mounted view may not have its handler yet. */
  s.sendUntil = async (keys, re, label) => {
    for (let attempt = 0; ; attempt += 1) {
      s.write(keys)
      try { await waitUntil(s.showing(re), label, 2500); return } catch (error) { if (attempt >= 4) throw error }
    }
  }
  s.ghCalls = () => (existsSync(ghLog) ? readFileSync(ghLog, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line)) : [])
  s.quit = async () => { s.write('q'); await Promise.race([s.exited, sleep(4000)]) }
  s.close = async () => { await stopTerminal(s.term); removeTempDir(temp) }
  return s
}

async function runCheck() {
  const s = start()
  try {
    await s.waitFor(/Parser: accept empty input/, 'the PR detail opened by reference')
    await s.waitFor(/Adds tests/, 'the full PR body (not the list seed)')
    await s.sendUntil('V', /Claims check\s+PR #186/, 'V opens the claims check')
    await s.waitFor(/2 of 4 claims verified, 1 contradicted, 1 unverifiable/, 'the summary line')
    const text = s.screen.text()
    assert.match(text, /✓ verified\s+fixes #42\s+"Fixes #42"/)
    assert.match(text, /✓ verified\s+tests/)
    assert.match(text, /✗ contradicted\s+no breaking changes/)
    assert.match(text, /\? unverifiable\s+performance/)
    // The first claim is selected and expanded with its evidence.
    assert.match(text, /src\/parser\.js\s+named in issue #42/)
    // A claim in an HTML comment or a code fence is not a claim.
    assert.doesNotMatch(text, /docs|version bump/)
    assert.match(text, /No AI was used/)
    // j moves to the tests claim: its evidence is the new test case at its line.
    await s.sendUntil('j', /src\/parser\.test\.js:41\s+it\('parses empty input'/, 'the tests claim evidence')
    await s.sendUntil('j', /signature of parse changed/, 'the no-breaking contradiction names the export')
    // A, with no AI provider configured: it fails closed and the deterministic result stays.
    s.write('A')
    await s.waitFor(/AI pass failed/, 'the AI pass says it could not run')
    assert.match(s.screen.text(), /2 of 4 claims verified/)
    assert.doesNotMatch(s.screen.text(), /AI-extracted/)
    s.write('\x1b')
    await s.gone(/Claims check/, 'Esc closes the claims check')
    await s.waitFor(/Parser: accept empty input/, 'back on the PR detail')
    assert.deepEqual(s.ghCalls().filter(args => classifyGh(args) === 'write'), [], 'no GitHub write')
    assert.ok(s.ghCalls().some(args => args[0] === 'api' && /pulls\/186\/files/.test(args[1]) && args.includes('--paginate')), 'the file list was read to the end')
    assert.ok(!existsSync(s.opened), 'nothing opened a browser or touched the clipboard')
    await s.quit()
  } finally {
    await s.close()
  }
}

const RAW_CONTROL = /\x07|\x1b\](?:52|8);|\x1b\[999;999H|\x1bZ|\x9b|\x9d|\u202e/
async function runHostile() {
  const s = start({ env: { LAZYHUB_CLAIMS_HOSTILE: '1' } })
  try {
    await s.waitFor(/Parser: accept empty input/, 'the hostile PR detail')
    await s.sendUntil('V', /Claims check\s+PR #186/, 'V opens the claims check')
    await s.waitFor(/claims verified/, 'the hostile claims summary')
    for (let i = 0; i < 4; i += 1) { s.write('j'); await sleep(80) }
    // A positive probe orders the scan behind every frame above.
    await s.sendUntil('k', /> . \w+\s+no breaking changes/, 'k moves the selection back')
    assert.doesNotMatch(s.stream, RAW_CONTROL, 'no BEL, OSC 52, OSC 8, planted CSI, C1 or bidi control reached the terminal')
    assert.deepEqual(s.ghCalls().filter(args => classifyGh(args) === 'write'), [], 'no GitHub write')
    await s.quit()
  } finally {
    await s.close()
  }
}

const timed = async (name, run) => {
  const at = Date.now()
  await run()
  process.stdout.write(`  claims ${name}: ${((Date.now() - at) / 1000).toFixed(1)}s\n`)
}
await timed('check', runCheck)
await timed('hostile', runHostile)
process.stdout.write('Claims check PTY flows passed\n')
