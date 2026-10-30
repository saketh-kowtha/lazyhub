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
  // Belt and braces: even if some code path reaches a real subprocess (the `o` key spawns
  // open/xdg-open through execa; editors via spawnSync), the binary it finds first on PATH is a
  // harmless script that only logs. A non-empty log fails the run (see verify()).
  const fs = require('node:fs')
  const os = require('node:os')
  const path = require('node:path')
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'lazyhub-fake-bin-'))
  const log = path.join(bin, 'calls.log')
  fs.writeFileSync(log, '')
  for (const name of ['open', 'xdg-open', 'start', 'pbcopy', 'xclip', 'xsel', 'wl-copy', 'code', 'vi', 'vim', 'nvim', 'nano', 'editor', 'gh']) {
    fs.writeFileSync(path.join(bin, name), `#!/bin/sh\necho "${name} $*" >> "${log}"\nexit 0\n`, { mode: 0o755 })
  }
  process.env.PATH = `${bin}${path.delimiter}${process.env.PATH}`
  process.env.EDITOR = path.join(bin, 'editor')
  process.env.VISUAL = path.join(bin, 'editor')
  process.env.BROWSER = path.join(bin, 'open')
  return { columns: 80, rows: 24, exit: vi.fn(), network: [], spawned: [], bin, log, fs }
})

vi.mock('ink', async () => {
  const React = await import('react')
  const actual = await vi.importActual('ink')
  return {
    ...actual,
    useApp: () => ({ exit: harness.exit }),
    useInput: (await import('./test/input-bus.js')).mockUseInput(React),
  }
})
vi.mock('execa', async () => ({ execa: vi.fn((await import('./test/gh-fixtures.js')).routeExeca) }))
vi.mock('./ipc.js', () => ({ emitIPC: () => {}, startIPC: () => '/tmp/lazyhub.sock' }))
vi.mock('./hooks/useTerminalSize.js', () => ({ useTerminalSize: () => ({ columns: harness.columns, rows: harness.rows }) }))
// $EDITOR launches and daemon spawns must never leave the process.
vi.mock('child_process', async () => {
  const actual = await vi.importActual('child_process')
  const record = name => (...args) => { harness.spawned.push(`${name} ${String(args[0])}`); return { status: 0, stdout: '', stderr: '', error: null, pid: 0, unref() {}, on() {} } }
  return { ...actual, spawnSync: record('spawnSync'), spawn: record('spawn'), execFile: record('execFile'), execFileSync: record('execFileSync'), execSync: record('execSync'), exec: record('exec') }
})
vi.mock('node:child_process', async () => {
  const actual = await vi.importActual('node:child_process')
  const record = name => (...args) => { harness.spawned.push(`${name} ${String(args[0])}`); return { status: 0, stdout: '', stderr: '', error: null, pid: 0, unref() {}, on() {} } }
  return { ...actual, spawnSync: record('spawnSync'), spawn: record('spawn'), execFile: record('execFile'), execFileSync: record('execFileSync'), execSync: record('execSync'), exec: record('exec') }
})

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
const KNOWN_FAILURES = []

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

/** Every distinct token any registered action is bound to, plus the generic keys. */
export function keyVocabulary() {
  const tokens = new Set([...NAMED, ...EXTRA])
  for (const action of Object.values(getActionConfig()?.actions || {})) {
    for (const token of action.keys || []) if (typeof token === 'string' && token && token !== '<space><space>') tokens.add(token)
  }
  // Ctrl+C is Ink's process-exit key and Ctrl+Z suspends a real terminal: not app behaviour.
  tokens.delete('Ctrl+C')
  tokens.delete('Ctrl+Z')
  return [...tokens].sort()
}

/**
 * One random key: mostly registry keys, sometimes a random printable character.
 * @param {() => number} rand
 * @param {string[]} vocab
 */
function randomToken(rand, vocab) {
  if (rand() < 0.2) return PRINTABLE[Math.floor(rand() * PRINTABLE.length)]
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

/**
 * Run `tokens` on a fresh App. Returns null when every invariant held, else the violation.
 * @param {number[]} size
 * @param {string[]} tokens
 * @param {{ ending?: boolean }} [opts] also verify that Esc/q reaches a sane root state
 * @returns {Promise<{ index: number, message: string } | null>}
 */
async function run(size, tokens, { ending = true } = {}) {
  const [cols, rows] = size
  const view = mount(cols, rows)
  let index = -1
  try {
    await settle(view)
    errorSpy.mockClear()
    rejections.length = 0
    harness.network.length = 0
    harness.spawned.length = 0
    harness.fs.writeFileSync(harness.log, '')
    for (index = 0; index < tokens.length; index += 1) {
      for (const ev of decode(tokens[index])) await sendInput(ev.input, ev.key)
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
  const leaked = harness.fs.readFileSync(harness.log, 'utf8')
  if (leaked) throw new Violation(`a real subprocess was launched (fake PATH shim caught it): ${leaked.split('\n')[0]}`)
  if (harness.spawned.length) throw new Violation(`subprocess escaped the mocks: ${harness.spawned[0]}`)
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
    harness.fs.rmSync(harness.bin, { recursive: true, force: true })
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

  it('keeps the browser-opening key inside the mocks (PATH shim never hit)', async () => {
    seen.length = 0
    const failure = await run([120, 40], ['2', 'o'], { ending: false })
    expect(failure).toBeNull()
    await waitForExpectation(() => expect(seen.some(c => /^(open|xdg-open) https:\/\/example\.test\//.test(c))).toBe(true))
    expect(harness.fs.readFileSync(harness.log, 'utf8')).toBe('')
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
    })
  })

  it('never reached for a gh command the fixtures do not know', () => {
    expect(unrouted).toEqual([])
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
