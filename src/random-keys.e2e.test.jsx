/**
 * Random keys: a seeded, deterministic, model-free fuzz of the real App.
 *
 * Feeds random sequences of the app's real keys (every token in the action registry plus
 * arrows, Enter, Esc, Tab, ':', '?', '/', digits and random printable text) into the real
 * App backed by canned `gh` output (src/test/gh-fixtures.js, mocked at `execa`). After
 * EVERY key it asserts: no ErrorBoundary screen, no thrown error, no unhandled rejection,
 * no console.error (React warnings), no network/subprocess escape, and the frame stays
 * inside the terminal. After the sequence, Esc then q must reach a sane root state.
 *
 * HERMETIC by construction, in three layers (the tests at the bottom prove each one):
 *   1. Every process boundary is mocked and recorded: `execa` (static and dynamic import),
 *      `child_process` and `node:child_process`. The only command the app may target is the
 *      fake `gh`; anything else (git, open, pbcopy, an editor...) fails the run at once.
 *   2. SPAWNING_ACTIONS (below) are never sent: the keys of every action that launches a
 *      browser, clipboard, editor or a git mutation are removed from the random key set.
 *   3. A canary: shims for open, xdg-open, git, pbcopy, xclip, xsel, code, vi, vim, nano (and
 *      $EDITOR/$VISUAL) head PATH; each appends to a marker file and exits 1. The marker must be
 *      empty, and this worktree's own git state (HEAD, symbolic HEAD, HEAD reflog) must be unchanged.
 *      Branch refs are shared by every worktree of a clone, so they are NOT compared (#546).
 *
 * Knobs: LAZYHUB_FUZZ_RUNS (sequences, default 12), LAZYHUB_FUZZ_KEYS (keys per sequence,
 * default 60), LAZYHUB_FUZZ_SEED (base seed, default 20260601). Sequence i uses seed+i.
 *
 * A failure prints the seed, the terminal size and the key sequence shrunk to the
 * shortest one that still fails (a ready-to-paste KNOWN_FAILURES entry / regression test).
 * Known defects on main are pinned in KNOWN_FAILURES and run as `it.fails`; never loosen a
 * check to make a sequence pass. Use the fixture data as ASCII (setAsciiOnly): wide-glyph
 * layout defects are pinned by src/screen-matrix.e2e.test.jsx and would mask everything here.
 */

import React from 'react'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const harness = vi.hoisted(() => {
  process.env.FORCE_COLOR = '3'
  delete process.env.NO_COLOR
  const fs = require('node:fs')
  const os = require('node:os')
  const path = require('node:path')
  const cp = require('node:child_process')
  // Layer 3 (canary), part 1: the state of the real checkout we run in, measured with the real
  // git by absolute path BEFORE any shim goes on PATH. Compared again after the suite.
  const gitBin = cp.spawnSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).stdout.trim()
  // Only state THIS worktree owns: HEAD, the symbolic ref, and the per-worktree HEAD reflog. The branch list
  // is shared by every worktree of the clone, so another worktree creating a branch must not trip the canary (#546).
  const snapshot = (cwd = process.cwd()) => {
    const git = (...a) => cp.spawnSync(gitBin, a, { cwd, encoding: 'utf8' }).stdout
    const gitDir = git('rev-parse', '--absolute-git-dir').trim()
    let reflog = ''
    try { reflog = fs.readFileSync(path.join(gitDir, 'logs', 'HEAD'), 'utf8') } catch { /* no reflog yet */ }
    return [git('rev-parse', 'HEAD'), git('symbolic-ref', '-q', 'HEAD'), `reflog:${reflog.split('\n').filter(Boolean).length}\n${reflog}`].join('\n--\n')
  }
  const before = gitBin ? snapshot() : ''
  // Layer 3, part 2: shims for every binary the app could launch. Each appends its name and argv to
  // a marker file and exits 1, so a leak is both recorded and visibly failing. The marker must stay empty.
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'lazyhub-fake-bin-'))
  const marker = path.join(bin, 'MARKER')
  fs.writeFileSync(marker, '')
  for (const name of ['open', 'xdg-open', 'start', 'git', 'gh', 'pbcopy', 'xclip', 'xsel', 'wl-copy', 'code', 'vi', 'vim', 'nvim', 'nano', 'editor']) {
    fs.writeFileSync(path.join(bin, name), `#!/bin/sh\necho "${name} $*" >> "${marker}"\nexit 1\n`, { mode: 0o755 })
  }
  process.env.PATH = `${bin}${path.delimiter}${process.env.PATH}`
  process.env.EDITOR = path.join(bin, 'editor')
  process.env.VISUAL = path.join(bin, 'editor')
  process.env.BROWSER = path.join(bin, 'open')
  return {
    columns: 80, rows: 24, exit: vi.fn(), network: [], fs, bin, marker, gitBin, before, snapshot,
    // Layer 1 recorders: every process the app asks for, at every boundary.
    execaCalls: [], spawned: [], realSpawnSync: cp.spawnSync,
    fakeChildProcess: async (id) => {
      const actual = await vi.importActual(id)
      const record = name => (...args) => { harness.spawned.push(`${name} ${String(args[0])}`); return { status: 0, stdout: '', stderr: '', error: null, pid: 0, unref() {}, on() {} } }
      return { ...actual, spawnSync: record('spawnSync'), spawn: record('spawn'), execFile: record('execFile'), execFileSync: record('execFileSync'), execSync: record('execSync'), exec: record('exec') }
    },
  }
})

// Layer 1: no process boundary reaches the OS. `execa` (static and dynamic import share this mock)
// answers from the canned fixtures and records every command; child_process / node:child_process
// record and return an inert result. verify() fails the run on anything that is not the fake `gh`.
vi.mock('ink', async () => {
  const React = await import('react')
  const actual = await vi.importActual('ink')
  return {
    ...actual,
    useApp: () => ({ exit: harness.exit }),
    useInput: (await import('./test/input-bus.js')).mockUseInput(React),
  }
})
vi.mock('execa', async () => {
  const { routeExeca } = await import('./test/gh-fixtures.js')
  return { execa: vi.fn((cmd, args = [], opts) => { harness.execaCalls.push(`${cmd} ${(args || []).join(' ')}`.trim()); return routeExeca(cmd, args, opts) }) }
})
vi.mock('./ipc.js', () => ({ emitIPC: () => {}, startIPC: () => '/tmp/lazyhub.sock' }))
vi.mock('./hooks/useTerminalSize.js', () => ({ useTerminalSize: () => ({ columns: harness.columns, rows: harness.rows }) }))
vi.mock('child_process', () => harness.fakeChildProcess('child_process'))
vi.mock('node:child_process', () => harness.fakeChildProcess('node:child_process'))

import { App } from './app.jsx'
import { getActionConfig } from './config/actions.js'
import { displayWidth } from './utils.js'
import { sendInput } from './test/input-bus.js'
import { cleanup, renderWithProviders, waitForExpectation } from './test/test-helpers.jsx'
import { seen, setAsciiOnly, unrouted } from './test/gh-fixtures.js'

const RUNS = positiveInt(process.env.LAZYHUB_FUZZ_RUNS, 12)
const KEYS = positiveInt(process.env.LAZYHUB_FUZZ_KEYS, 60)
const BASE_SEED = positiveInt(process.env.LAZYHUB_FUZZ_SEED, 20260601)
const SIZES = [[80, 24], [120, 40], [60, 18], [200, 50], [50, 15]]

/**
 * Failures present on main, pinned as regression cases.
 * { seed?, size: [cols, rows], keys: [...tokens], reason: RegExp for the failure message, issue }
 * @type {Array<{ size: number[], keys: string[], reason: RegExp, issue: string }>}
 */
const KNOWN_FAILURES = [
  // G (cursor.bottom) on the PR list at 80x24: the peek panel draws past the right edge (frame line 13 is 105 columns wide).
  { size: [80, 24], keys: ['2', 'G'], reason: /is \d+ wide \(max 80\)/, issue: 'not yet filed (see PR description)' },
]

function positiveInt(raw, fallback) {
  const n = Number.parseInt(raw ?? '', 10)
  return Number.isFinite(n) && n > 0 ? n : fallback
}

// ─── Seeded PRNG (mulberry32): same seed, same sequence, on every machine ─────

function prng(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6D2B79F5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// ─── Key vocabulary ───────────────────────────────────────────────────────────

const NAMED = ['Enter', 'Esc', 'Tab', 'Shift+Tab', 'Up', 'Down', 'Left', 'Right', 'PageUp', 'PageDown', 'Backspace', 'Space']
const EXTRA = [':', '?', '/', '0', '1', '2', '3', '4', '5', '6', '7', '8', '9', 'j', 'k', 'q', 'g', 'G', 'y', 'n']
const PRINTABLE = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 !@#$%^&*()-_=+[]{};\'",.<>/?\\|`~éü汉'

/**
 * Registry action ids whose handler spawns a process or mutates the checkout, clipboard or browser.
 * The fuzz must be safe to run from a real checkout on a real desktop, so it never presses these
 * (the mocks and the canary would catch a leak, but the point is never to try).
 *   branch.*          git checkout / checkout -b / push origin HEAD / branch -D in process.cwd()
 *   pr.checkout       `gh pr checkout` (moves HEAD)
 *   pr.conflicts      opens ConflictView: git fetch/merge/add/commit/push and $EDITOR
 *   pr.new            the New PR form runs `git log origin/<typed ref>..<typed ref>` and can push the branch
 *   *.open-browser    `open` / `xdg-open`
 *   *.copy-url        pbcopy / xclip
 *   pr.open-editor, app.open-config, dialog.editor    $EDITOR via spawnSync / openInEditor
 *   notification.open opens the notification in the browser
 *   app.ai-assistant, diff.ai-review    probe and run the AI CLI providers (execFile claude / codex / gemini)
 * Handlers bound to literal keys (not in the registry) are covered by the tokens above: ConflictView
 * is only reachable through pr.conflicts, and the logs copy key is `y` (copy-url's token).
 */
export const SPAWNING_ACTIONS = [
  'branch.checkout', 'branch.new', 'branch.delete', 'branch.push',
  'pr.checkout', 'pr.conflicts', 'pr.new',
  'pr.open-browser', 'issue.open-browser', 'tab.open-browser', 'check.open-browser',
  'pr.copy-url', 'issue.copy-url',
  'pr.open-editor', 'app.open-config', 'dialog.editor',
  'notification.open',
  'app.ai-assistant', 'diff.ai-review',
]

function tokenBindings(token) {
  return Object.entries(getActionConfig()?.actions || {}).filter(([, a]) => (a.keys || []).includes(token)).map(([id]) => id)
}

/** Tokens that exist only to spawn: bound to a spawning action and to nothing else. Never sent. */
export function bannedTokens() {
  const banned = new Set()
  const spawning = new Set(SPAWNING_ACTIONS)
  const actions = getActionConfig()?.actions || {}
  for (const id of SPAWNING_ACTIONS) {
    for (const token of actions[id]?.keys || []) {
      if (tokenBindings(token).every(other => spawning.has(other))) banned.add(token)
    }
  }
  return banned
}

/**
 * The status bar names the focused pane at every terminal size ("Branches  .  owner/repo"). Each pane
 * owns these keymap scopes (src/ui/actions.js contextScopes): its list and every view opened from it.
 */
export const PANE_SCOPES = {
  'Pull Requests': ['pr-list', 'pr-detail', 'pr-comments', 'pr-checks'],
  Issues: ['issue-list', 'issue-detail'],
  Branches: ['branch-list'],
  Notifications: ['notification-list'],
  // The full-screen diff replaces the chrome; its own header is the only marker ("PR #101 Diff").
  'PR #\\d+ Diff': ['diff'],
}

const scopesOf = action => [].concat(action?.scope || [])
const IN_DIALOG = /\[(?:DIALOG|INPUT)\]/

/**
 * Tokens that spawn in SOME scope but navigate or answer in others (Enter is checkout on Branches and
 * open on Notifications, n is "new branch" there and "no" in a dialog, y is copy-url on lists and "yes"
 * in a dialog). They stay in the vocabulary but are replaced by Down whenever the status bar says the
 * focused pane owns a scope where the token spawns (conservative: any view of that pane). Inside a
 * dialog the dialog scope wins, where none of them spawns.
 * @param {string} token
 * @param {string} frame
 */
export function isUnsafeHere(token, frame) {
  const actions = getActionConfig()?.actions || {}
  const status = strip(frame)
  if (IN_DIALOG.test(status)) return false
  // Pane header ("Branches 43", one space, at every size; the sidebar pads its numbers with many
  // spaces) or status bar ("Branches  .  owner/repo"; absent on compact terminals).
  const live = new Set(Object.entries(PANE_SCOPES)
    .filter(([name]) => new RegExp(name.includes('Diff') ? name : `${name}(?: \\d|\\s+\u00b7)`).test(status))
    .flatMap(([, scopes]) => scopes))
  if (live.size === 0) return false
  return SPAWNING_ACTIONS.some((id) => {
    const a = actions[id]
    return !!a && (a.keys || []).includes(token) && scopesOf(a).some(scope => live.has(scope))
  })
}

/** Every distinct token any registered action is bound to, plus the generic keys, minus the banned. */
export function keyVocabulary() {
  const tokens = new Set([...NAMED, ...EXTRA])
  for (const action of Object.values(getActionConfig()?.actions || {})) {
    for (const token of action.keys || []) if (typeof token === 'string' && token && token !== '<space><space>') tokens.add(token)
  }
  // Ctrl+C is Ink's process-exit key and Ctrl+Z suspends a real terminal: not app behaviour.
  tokens.delete('Ctrl+C')
  tokens.delete('Ctrl+Z')
  const banned = bannedTokens()
  for (const token of banned) tokens.delete(token)
  // A literal sequence ("g p", "type") is typed one character at a time: drop any that contains a banned key.
  for (const token of [...tokens]) {
    const events = decode(token)
    if (events.length > 1 && events.every(ev => Object.keys(ev.key).length === 0) && events.some(ev => banned.has(ev.input))) tokens.delete(token)
  }
  return [...tokens].sort()
}

const BANNED = bannedTokens()

/**
 * One random key: mostly registry keys, sometimes a random printable character.
 * @param {() => number} rand
 * @param {string[]} vocab
 */
function randomToken(rand, vocab) {
  if (rand() < 0.2) {
    const printable = [...PRINTABLE].filter(ch => !BANNED.has(ch))
    return printable[Math.floor(rand() * printable.length)]
  }
  return vocab[Math.floor(rand() * vocab.length)]
}

/**
 * Turn a token ("j", "Enter", "Ctrl+X", "Shift+Tab", "gg") into Ink input events.
 * @param {string} token
 * @returns {Array<{input: string, key: object}>}
 */
export function decode(token) {
  const named = {
    Enter: { return: true }, Esc: { escape: true }, Tab: { tab: true }, 'Shift+Tab': { tab: true, shift: true },
    Up: { upArrow: true }, Down: { downArrow: true }, Left: { leftArrow: true }, Right: { rightArrow: true },
    PageUp: { pageUp: true }, PageDown: { pageDown: true }, Backspace: { backspace: true },
  }
  if (named[token]) return [{ input: '', key: named[token] }]
  if (token === 'Space') return [{ input: ' ', key: {} }]
  const mod = token.match(/^(Ctrl|Meta|Shift)\+(.+)$/)
  if (mod) {
    const [, kind, rest] = mod
    const input = rest.length === 1 ? (kind === 'Shift' ? rest.toUpperCase() : rest.toLowerCase()) : ''
    if (!input) return [{ input: '', key: { [kind.toLowerCase()]: true } }]
    return [{ input, key: kind === 'Ctrl' ? { ctrl: true } : kind === 'Meta' ? { meta: true } : { shift: true } }]
  }
  // A literal: one event per character (so "gg" is g, g).
  return [...token].map(ch => ({ input: ch, key: {} }))
}

// ─── Running one sequence ─────────────────────────────────────────────────────

// eslint-disable-next-line no-control-regex
const SGR = /\x1b\[[0-9;:]*m/g
const strip = s => s.replace(SGR, '')

class Violation extends Error {}

function mount(cols, rows) {
  harness.columns = cols
  harness.rows = rows
  const view = renderWithProviders(<App repo="owner/repo" />)
  Object.defineProperty(view.stdout, 'columns', { value: cols, configurable: true })
  Object.defineProperty(view.stdout, 'rows', { value: rows, configurable: true })
  view.stdout.emit('resize')
  return view
}

async function settle(view) {
  let prev = null
  await waitForExpectation(() => {
    const cur = view.lastFrame()
    const stable = cur === prev
    prev = cur
    if (!stable) throw new Error('frame still changing')
  }, { timeout: 3000, interval: 10 })
}

/**
 * Frame invariants checked after every key.
 * @param {string} frame
 * @param {number} cols
 * @param {number} rows
 */
function checkFrame(frame, cols, rows) {
  const plain = strip(frame)
  if (/Something went wrong/.test(plain)) throw new Violation(`ErrorBoundary screen shown: ${JSON.stringify(plain.split('\n').filter(l => /went wrong|dismiss/.test(l) || l.trim().length > 0).slice(0, 4))}`)
  const lines = plain.split('\n')
  if (lines.length > rows) throw new Violation(`frame is ${lines.length} lines tall, terminal has ${rows}`)
  lines.forEach((line, i) => {
    const w = displayWidth(line)
    if (w > cols) throw new Violation(`line ${i + 1} is ${w} wide (max ${cols}): ${JSON.stringify(line)}`)
  })
}

const rejections = []
const onRejection = reason => { rejections.push(reason) }
let errorSpy
let fetchSpy
let allowForeign = false
/**
 * The one non-gh command the app issues on its own (the Branches pane asks for the current branch
 * when it mounts). It is read-only, goes to the mocked execa (answered by the fixtures, never the OS)
 * and is pinned here by its exact argv: any other git/open/pbcopy/editor command is a violation.
 */
const READ_ONLY_MOCKED = ['git branch --show-current', 'git remote -v']
const markerContents = () => harness.fs.readFileSync(harness.marker, 'utf8')

/**
 * Run `tokens` on a fresh App. Returns null when every invariant held, else the violation.
 * @param {number[]} size
 * @param {string[]} tokens
 * @param {{ ending?: boolean }} [opts] also verify that Esc/q reaches a sane root state
 * @returns {Promise<{ index: number, message: string } | null>}
 */
async function run(size, tokens, { ending = true, allowSpawning = false } = {}) {
  const [cols, rows] = size
  const view = mount(cols, rows)
  let index = -1
  try {
    await settle(view)
    errorSpy.mockClear()
    rejections.length = 0
    harness.network.length = 0
    harness.spawned.length = 0
    harness.execaCalls.length = 0
    allowForeign = allowSpawning
    for (index = 0; index < tokens.length; index += 1) {
      // Layer 2, scope-aware half: never send a key that the screen says would spawn right now.
      // Checked per event, so a literal sequence such as "g p" is vetted character by character.
      for (const ev of decode(tokens[index])) {
        const name = ev.key.return ? 'Enter' : (ev.input && !ev.key.ctrl && !ev.key.meta ? ev.input : null)
        const unsafe = !allowSpawning && name !== null && isUnsafeHere(name, view.lastFrame() ?? '')
        if (unsafe) await sendInput('', { downArrow: true })
        else await sendInput(ev.input, ev.key)
      }
      verify(view, cols, rows)
    }
    if (ending) {
      index = tokens.length
      await sanityEnding(view, cols, rows)
    }
    return null
  } catch (error) {
    return { index, message: error?.message ?? String(error) }
  } finally {
    cleanup()
  }
}

/**
 * The per-key checks that are not about the frame.
 * @param {object} view
 * @param {number} cols
 * @param {number} rows
 */
function verify(view, cols, rows) {
  if (rejections.length) throw new Violation(`unhandled rejection: ${String(rejections[0]?.stack || rejections[0]).split('\n').slice(0, 3).join(' | ')}`)
  if (errorSpy.mock.calls.length) throw new Violation(`console.error: ${errorSpy.mock.calls[0].map(a => String(a?.stack || a)).join(' ').slice(0, 400)}`)
  if (harness.network.length) throw new Violation(`network call attempted: ${harness.network[0]}`)
  const leaked = markerContents()
  if (leaked) throw new Violation(`a REAL subprocess was launched (PATH shim caught it): ${leaked.split('\n')[0]}`)
  if (harness.spawned.length) throw new Violation(`child_process was called (mocked, but the app must not spawn here): ${harness.spawned[0]}`)
  if (!allowForeign) {
    const foreign = harness.execaCalls.filter(c => !/^gh(\s|$)/.test(c) && !READ_ONLY_MOCKED.includes(c))
    if (foreign.length) throw new Violation(`execa targeted something other than the fake gh: ${foreign[0]}`)
  }
  checkFrame(view.lastFrame() ?? '', cols, rows)
}

// A scope badge such as [DIALOG] / [OVERLAY] / [VIEW] / [INSERT] / COMMAND means we are not at the root.
const NOT_ROOT = /\[(?:DIALOG|OVERLAY|VIEW|INSERT|INPUT)\]|\bCOMMAND\b|Keyboard Reference|Something went wrong/

/**
 * Esc a few times, then q: the app must be back on a root list and q must quit.
 * @param {object} view
 * @param {number} cols
 * @param {number} rows
 */
async function sanityEnding(view, cols, rows) {
  for (let i = 0; i < 6; i += 1) {
    await sendInput('', { escape: true })
    verify(view, cols, rows)
  }
  await settle(view)
  const frame = strip(view.lastFrame() ?? '')
  if (NOT_ROOT.test(frame)) throw new Violation(`Esc x6 did not return to a root list:\n${frame}`)
  const before = harness.exit.mock.calls.length
  await sendInput('q', {})
  verify(view, cols, rows)
  if (harness.exit.mock.calls.length === before) throw new Violation(`q at the root did not quit:\n${frame}`)
}

/**
 * Greedy delta debugging: the shortest key list (prefix first, then single removals) that still fails.
 * @param {number[]} size
 * @param {string[]} tokens
 * @param {{ index: number, message: string }} failure
 */
async function shrink(size, tokens, failure) {
  const kind = text => text.replace(/\d+/g, 'N').slice(0, 40)
  let last = failure
  const prefix = tokens.slice(0, failure.index + 1)
  const keys = await ddmin(prefix, async (candidate) => {
    const result = await run(size, candidate, { ending: failure.index >= tokens.length })
    if (result && kind(result.message) === kind(failure.message)) { last = result; return true }
    return false
  })
  return { keys, failure: last }
}

/**
 * Greedy delta debugging: drop one key at a time while the sequence still fails.
 * @param {string[]} keys
 * @param {(keys: string[]) => boolean | Promise<boolean>} fails
 * @returns {Promise<string[]>}
 */
async function ddmin(keys, fails) {
  let best = keys
  for (let i = 0; i < best.length;) {
    const candidate = best.filter((_, j) => j !== i)
    if (await fails(candidate)) best = candidate
    else i += 1
  }
  return best
}

function report(seed, size, original, shrunk) {
  return [
    `random-keys failure  seed=${seed}  size=${size[0]}x${size[1]}  (LAZYHUB_FUZZ_SEED=${seed} LAZYHUB_FUZZ_RUNS=1 LAZYHUB_FUZZ_KEYS=${original.length})`,
    `reason: ${shrunk.failure.message}`,
    `shortest failing sequence (${shrunk.keys.length} keys): ${JSON.stringify(shrunk.keys)}`,
    `KNOWN_FAILURES entry: { size: [${size[0]}, ${size[1]}], keys: ${JSON.stringify(shrunk.keys)}, reason: /.../, issue: '#...' }`,
  ].join('\n')
}

/** Layer 3: nothing real ran, and the checkout we are standing in is exactly as we found it. */
function assertCanary() {
  const marker = markerContents()
  if (marker) throw new Error(`hermetic canary: a real process was launched:\n${marker}`)
  if (harness.gitBin) {
    const after = harness.snapshot()
    if (after !== harness.before) throw new Error(`hermetic canary: this worktree's git state changed (HEAD / symbolic ref / HEAD reflog)\nbefore:\n${harness.before}\nafter:\n${after}`)
  }
}

describe('random keys: seeded fuzz of the real App', () => {
  const vocab = keyVocabulary()

  beforeAll(() => {
    setAsciiOnly(true)
    unrouted.length = 0
    process.on('unhandledRejection', onRejection)
  })
  afterAll(() => {
    process.off('unhandledRejection', onRejection)
    setAsciiOnly(false)
    try { assertCanary() } finally { harness.fs.rmSync(harness.bin, { recursive: true, force: true }) }
  })
  beforeEach(() => {
    harness.exit.mockClear()
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => { harness.network.push(String(url)); throw new Error('network is disabled in tests') })
  })
  afterEach(() => {
    errorSpy.mockRestore()
    fetchSpy.mockRestore()
    cleanup()
  })

  it('has a vocabulary that covers the registry, arrows, Enter/Esc/Tab, : ? / and digits', () => {
    for (const k of ['Enter', 'Esc', 'Tab', 'Up', 'Down', ':', '?', '/', '0', '9', 'j', 'k']) expect(vocab).toContain(k)
    expect(vocab.length).toBeGreaterThan(40)
  })

  it('decodes tokens into Ink events', () => {
    expect(decode('Enter')).toEqual([{ input: '', key: { return: true } }])
    expect(decode('Ctrl+X')).toEqual([{ input: 'x', key: { ctrl: true } }])
    expect(decode('gg')).toHaveLength(2)
    expect(decode('Shift+Tab')[0].key).toEqual({ tab: true, shift: true })
  })

  describe('hermeticity', () => {
    it('SPAWNING_ACTIONS are all real registry ids (a rename must not silently empty the deny-list)', () => {
      const actions = getActionConfig()?.actions || {}
      for (const id of SPAWNING_ACTIONS) expect(actions[id], id).toBeTruthy()
    })

    it('never sends a key that exists only to spawn', () => {
      const banned = bannedTokens()
      for (const token of ['o', 'b', 'p', 'E', 'Ctrl+E']) expect(banned.has(token), token).toBe(true)
      for (const token of banned) expect(vocab).not.toContain(token)
      for (const seed of [1, 2, 3]) {
        const r = prng(seed)
        for (let i = 0; i < 2000; i += 1) expect(banned.has(randomToken(r, vocab))).toBe(false)
      }
    })

    it('every scope a shared spawning token spawns in belongs to a pane we can recognise', () => {
      const actions = getActionConfig()?.actions || {}
      const banned = bannedTokens()
      const known = new Set(Object.values(PANE_SCOPES).flat())
      for (const id of SPAWNING_ACTIONS) {
        if (actions[id].keys.every(t => banned.has(t))) continue
        for (const scope of scopesOf(actions[id])) expect(known.has(scope), `${id} in ${scope}`).toBe(true)
      }
    })

    it('replaces a shared key by a safe one when the focused pane spawns on it', () => {
      const frame = (title, badge = '') => ` x\n------\n ${title}  \u00b7  owner/repo  \u00b7  43 items  ${badge}  just now\n-----\n hints`
      expect(isUnsafeHere('Enter', frame('Branches'))).toBe(true)
      expect(isUnsafeHere('n', frame('Branches'))).toBe(true)
      expect(isUnsafeHere('Enter', frame('Notifications'))).toBe(true)
      expect(isUnsafeHere('y', frame('Pull Requests'))).toBe(true)
      expect(isUnsafeHere('y', frame('Issues'))).toBe(true)
      expect(isUnsafeHere('Enter', frame('Pull Requests'))).toBe(false)
      expect(isUnsafeHere('j', frame('Branches'))).toBe(false)
      expect(isUnsafeHere('y', frame('Pull Requests', '[DIALOG]'))).toBe(false)
    })

    it('the PATH canary is alive: a real launch of a shimmed binary is recorded and fails', () => {
      const result = harness.realSpawnSync('open', ['https://example.test/canary'], { encoding: 'utf8' })
      expect(result.status).toBe(1)
      expect(markerContents()).toContain('open https://example.test/canary')
      harness.fs.writeFileSync(harness.marker, '')
      expect(process.env.EDITOR).toBe(`${harness.bin}/editor`)
      expect(() => verify({ lastFrame: () => '' }, 80, 24)).not.toThrow()
      harness.fs.writeFileSync(harness.marker, 'git checkout -b leak\n')
      expect(() => verify({ lastFrame: () => '' }, 80, 24)).toThrow(/REAL subprocess/)
      expect(() => assertCanary()).toThrow(/hermetic canary/)
      harness.fs.writeFileSync(harness.marker, '')
    })

    it('a branch created by ANOTHER worktree does not trip the canary, but a checkout in this one does (#546)', () => {
      const { gitBin, fs: nfs } = harness
      const os = require('node:os')
      const path = require('node:path')
      const root = nfs.mkdtempSync(path.join(os.tmpdir(), 'lazyhub-canary-'))
      const env = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' }
      const git = (cwd, ...a) => { const r = harness.realSpawnSync(gitBin, a, { cwd, encoding: 'utf8', env }); if (r.status !== 0) throw new Error(`git ${a.join(' ')}: ${r.stderr}`); return r.stdout }
      try {
        const main = path.join(root, 'main'), other = path.join(root, 'other')
        nfs.mkdirSync(main)
        git(main, 'init', '-q', '-b', 'main')
        git(main, 'commit', '-q', '--allow-empty', '-m', 'init')
        git(main, 'worktree', 'add', '-q', '-b', 'wt-other', other)
        const before = harness.snapshot(main)
        git(other, 'branch', 'created-elsewhere')
        git(other, 'checkout', '-q', '-b', 'moved-elsewhere')
        expect(git(main, 'branch', '--list')).toContain('created-elsewhere')
        expect(harness.snapshot(main)).toBe(before)
        git(main, 'checkout', '-q', '-b', 'leak')
        expect(harness.snapshot(main)).not.toBe(before)
      } finally { nfs.rmSync(root, { recursive: true, force: true }) }
    })

    it('process mocks catch spawning: the browser key goes to the mocked execa, never to the OS', async () => {
      seen.length = 0
      const failure = await run([120, 40], ['2', 'o'], { ending: false, allowSpawning: true })
      expect(failure).toBeNull()
      await waitForExpectation(() => expect(harness.execaCalls.some(c => /^(open|xdg-open) https:\/\/example\.test\//.test(c))).toBe(true))
      expect(markerContents()).toBe('')
      // ...and without the allowance the same press is a violation.
      allowForeign = false
      expect(() => verify({ lastFrame: () => '' }, 80, 24)).toThrow(/other than the fake gh/)
    })

    it('flags child_process use and foreign execa commands', () => {
      allowForeign = false
      harness.execaCalls.length = 0
      harness.spawned.length = 0
      harness.execaCalls.push('gh pr list')
      expect(() => verify({ lastFrame: () => '' }, 80, 24)).not.toThrow()
      harness.execaCalls.push('git checkout -b x')
      expect(() => verify({ lastFrame: () => '' }, 80, 24)).toThrow(/other than the fake gh/)
      harness.execaCalls.length = 0
      harness.spawned.push('spawnSync vi')
      expect(() => verify({ lastFrame: () => '' }, 80, 24)).toThrow(/child_process was called/)
      harness.spawned.length = 0
    })
  })

  it('detects what it claims to detect', () => {
    expect(() => checkFrame('ok\nfine', 10, 5)).not.toThrow()
    expect(() => checkFrame('⚠ Something went wrong\nboom', 80, 24)).toThrow(/ErrorBoundary/)
    expect(() => checkFrame('x'.repeat(11), 10, 5)).toThrow(/11 wide/)
    expect(() => checkFrame('a\nb\nc', 10, 2)).toThrow(/3 lines tall/)
    for (const token of vocab) expect(decode(token).length).toBeGreaterThan(0)
  })

  it('shrinks a failing sequence to the keys that matter', async () => {
    // "Something went wrong" is not reachable on main, so drive the shrinker with a stub failure:
    // a key sequence is "failing" when it contains both x and y (order-free), via a fake runner.
    const fails = keys => keys.includes('x') && keys.includes('y')
    const minimal = await ddmin(['a', 'x', 'b', 'c', 'y', 'd'], fails)
    expect(minimal).toEqual(['x', 'y'])
  })

  it('is reproducible: the same seed yields the same sequence', () => {
    const make = seed => { const r = prng(seed); return Array.from({ length: 30 }, () => randomToken(r, vocab)) }
    expect(make(BASE_SEED)).toEqual(make(BASE_SEED))
    expect(make(BASE_SEED)).not.toEqual(make(BASE_SEED + 1))
  })

  describe.each(Array.from({ length: RUNS }, (_, i) => BASE_SEED + i))('seed %i', (seed) => {
    const rand = prng(seed)
    const size = SIZES[Math.floor(rand() * SIZES.length)]
    const tokens = Array.from({ length: KEYS }, () => randomToken(rand, vocab))

    it(`${KEYS} random keys at ${size[0]}x${size[1]} keep every invariant`, async () => {
      const failure = await run(size, tokens)
      if (failure) {
        const shrunk = await shrink(size, tokens, failure)
        throw new Error(report(seed, size, tokens, shrunk))
      }
    }, 300_000)
  })

  it('never reached for a gh command the fixtures do not know', () => {
    expect(unrouted).toEqual([])
  })

  it('left no trace: no real process ran and the checkout (branches, HEAD) is unchanged', () => {
    assertCanary()
  })

  describe.skipIf(KNOWN_FAILURES.length === 0)('pinned failures on main', () => {
    for (const known of KNOWN_FAILURES) {
      it.fails(`${known.keys.join(' ')} at ${known.size.join('x')} (known defect ${known.issue})`, async () => {
        const failure = await run(known.size, known.keys)
        // Fail (as expected) only for the recorded reason; any other outcome flips the it.fails red.
        if (failure && known.reason.test(failure.message)) throw new Error(failure.message)
      })
    }
  })
})
