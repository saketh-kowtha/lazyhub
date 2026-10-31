/**
 * Screen matrix: a deterministic, model-free QA suite.
 *
 * Renders the REAL App (real panes, real executor, real useGh and useLayout) against
 * canned `gh` output (src/test/gh-fixtures.js, mocked at the `execa` boundary) at every
 * size x theme x colour mode, and checks the invariants of every frame of every screen:
 *
 *   width    no line is wider than the terminal (string-width, as the app measures);
 *   height   the frame is no taller than the terminal;
 *   control  no raw escape/control character other than SGR colour codes;
 *   colour   under NO_COLOR=1 no foreground/background colour code reaches the terminal;
 *   footer   the footer is one separator + one hint line and the status bar is visible;
 *   entity   no undecoded HTML entity (&#x27;, &amp;) in the text;
 *   small    "Terminal too small" shows below the documented minimum, and only there.
 *
 * Known defects on main are pinned in KNOWN_DEFECTS: the case still runs everything else
 * as a normal test, and the broken invariant runs as `it.fails` so it flips red the day
 * the defect is fixed (remove the entry then). Never loosen a check to make a case pass.
 *
 * Debug a frame: MATRIX_DUMP=80x24 npx vitest run src/screen-matrix.e2e.test.jsx
 */

import React from 'react'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

const size = vi.hoisted(() => {
  // Colour on, so SGR sequences are really present in the frames under test.
  process.env.FORCE_COLOR = '3'
  delete process.env.NO_COLOR
  return { columns: 80, rows: 24 }
})

vi.mock('ink', async () => {
  const React = await import('react')
  const actual = await vi.importActual('ink')
  return { ...actual, useInput: (await import('./test/input-bus.js')).mockUseInput(React) }
})
vi.mock('execa', async () => ({ execa: vi.fn((await import('./test/gh-fixtures.js')).routeExeca) }))
vi.mock('./ipc.js', () => ({ emitIPC: () => {}, startIPC: () => '/tmp/lazyhub.sock' }))
// The terminal size is the only thing faked; useLayout/computeLayout stay real.
vi.mock('./hooks/useTerminalSize.js', () => ({ useTerminalSize: () => ({ columns: size.columns, rows: size.rows }) }))

import { App } from './app.jsx'
import { MIN_COLS, MIN_ROWS } from './hooks/useLayout.js'
import { terminalPrefs, wrapStdout } from './theme/terminal.js'
import { displayWidth } from './utils.js'
import { sendInput } from './test/input-bus.js'
import { cleanup, renderWithProviders, waitForExpectation } from './test/test-helpers.jsx'
import { unrouted } from './test/gh-fixtures.js'

const SIZES = [[50, 15], [60, 18], [80, 24], [120, 40], [200, 50]]
const THEMES = [
  { name: 'default', legacy: 'github-dark', scheme: 'lazyhub-dark' },
  { name: 'catppuccin-latte', legacy: 'catppuccin-latte', scheme: 'lazyhub-light' },
]
const VARIANTS = [
  { label: 'default theme', theme: THEMES[0], mode: 'color' },
  { label: 'catppuccin-latte theme', theme: THEMES[1], mode: 'color' },
  { label: 'default theme, NO_COLOR=1', theme: THEMES[0], mode: 'NO_COLOR' },
]

const key = (input, k = {}) => ({ input, key: k })
const ENTER = key('', { return: true })

// Every screen, reached from a fresh mount (which starts on the Focus dashboard).
//   marker: text that proves we are really on the screen (survives truncation)
//   chrome: 'shell' = StatusBar + FooterKeys below the content; 'own' = the view owns the whole frame
//   help:   the footer must still advertise "? help"
const SCREENS = [
  { id: 'focus', keys: [], marker: /Focus/, chrome: 'shell', help: true },
  { id: 'prs', keys: [key('2')], marker: /Pull Requests/, chrome: 'shell', help: true },
  { id: 'issues', keys: [key('3')], marker: /Issues/, chrome: 'shell', help: true },
  { id: 'branches', keys: [key('4')], marker: /Branches/, chrome: 'shell', help: true },
  { id: 'actions', keys: [key('5')], marker: /Actions/, chrome: 'shell', help: true },
  { id: 'notifications', keys: [key('6')], marker: /Notifications/, chrome: 'shell', help: true },
  { id: 'pr-detail', keys: [key('2'), ENTER], marker: /\[VIEW\]/, chrome: 'shell', help: true },
  { id: 'pr-diff', keys: [key('2'), key('d')], marker: /PR #101 Diff/, chrome: 'own' },
  { id: 'issue-detail', keys: [key('3'), ENTER], marker: /\[VIEW\]/, chrome: 'shell', help: true },
  { id: 'help', keys: [key('?')], marker: /\[OVERLAY\]/, chrome: 'shell' },
  { id: 'command-palette', keys: [key(':')], marker: /COMMAND/, chrome: 'shell' },
  { id: 'dialog-checkout', keys: [key('4'), key('j'), ENTER], marker: /\[DIALOG\]/, chrome: 'shell' },
]

/**
 * Defects present on main. `at` selects the cases ("COLSxROWS"; omitted = every size);
 * `kind` is the invariant that is broken there. Each links the issue that tracks it.
 * @type {Array<{ screen: string, kind: string, at?: string[], issue: string }>}
 */
const KNOWN_DEFECTS = [
  { screen: 'notifications', kind: 'width', at: ['50x15', '60x18', '80x24'], issue: '#428' },
  { screen: 'notifications', kind: 'footer', at: ['50x15'], issue: '#428' },
  { screen: 'issues', kind: 'width', at: ['60x18', '80x24'], issue: '#429' },
  { screen: 'issues', kind: 'footer', at: ['50x15', '80x24'], issue: '#429' },
  { screen: 'actions', kind: 'footer', at: ['50x15'], issue: '#430' },
  { screen: 'focus', kind: 'width', at: ['50x15'], issue: '#431' },
  { screen: 'focus', kind: 'footer', at: ['50x15', '60x18', '80x24'], issue: '#431' },
]

// eslint-disable-next-line no-control-regex
const SGR = /\x1b\[[0-9;:]*m/g
// Everything that is not printable text: C0 (except \n), DEL, C1 and any stray ESC.
// eslint-disable-next-line no-control-regex
const CONTROL = /[\x00-\x09\x0b-\x1f\x7f-\x9f]/

const strip = s => s.replace(SGR, '')

function hasColourParam(seq) {
  const parts = seq.slice(2, -1).split(/[;:]/).filter(Boolean).map(Number)
  return parts.some(n => (n >= 30 && n <= 49) || (n >= 90 && n <= 107))
}

// Mount the App on a fake stdout that reports the given size, as a real TTY does.
function mount(cols, rows, theme = THEMES[0]) {
  size.columns = cols
  size.rows = rows
  const view = renderWithProviders(<App repo="owner/repo" />, { legacyTheme: theme.legacy, schemeTheme: theme.scheme })
  // ink-testing-library's stdout is fixed at 100 columns; Ink lays out against stdout.columns.
  Object.defineProperty(view.stdout, 'columns', { value: cols, configurable: true })
  Object.defineProperty(view.stdout, 'rows', { value: rows, configurable: true })
  view.stdout.emit('resize')
  return view
}

// Resolve once the frame has stopped changing (render + effects + mocked gh settled).
async function settle(view) {
  let prev = null
  await waitForExpectation(() => {
    const cur = view.lastFrame()
    const stable = cur === prev
    prev = cur
    if (!stable) throw new Error('frame still changing')
  }, { timeout: 3000, interval: 10 })
}

// The frame as the terminal would receive it in the given colour mode.
function terminalFrame(view, mode) {
  const raw = view.lastFrame() ?? ''
  if (mode === 'color') return raw
  // renderApp() writes frames through wrapStdout(terminalPrefs(...)); NO_COLOR strips colour there.
  let out = ''
  const sink = { write: chunk => { out += chunk }, columns: size.columns, rows: size.rows }
  wrapStdout(sink, terminalPrefs({}, { NO_COLOR: '1' })).write(raw)
  return out
}

/**
 * Check one frame; returns every broken invariant as { kind, message }.
 * @param {string} frame the frame as the terminal receives it
 * @param {{cols:number, rows:number, mode:string, screen: object}} ctx
 */
function violations(frame, { cols, rows, mode, screen }) {
  const found = []
  const add = (kind, message) => found.push({ kind, message })
  const plain = strip(frame)
  const lines = plain.split('\n')

  if (mode === 'NO_COLOR') {
    // Bold/dim/inverse survive NO_COLOR; foreground/background colour codes must not.
    const colour = [...frame.matchAll(SGR)].map(m => m[0]).find(hasColourParam)
    if (colour) add('colour', `colour code ${JSON.stringify(colour)} survived NO_COLOR`)
  }

  if (lines.length > rows) add('height', `frame is ${lines.length} lines, terminal has ${rows}`)

  lines.forEach((line, i) => {
    const w = displayWidth(line)
    if (w > cols) add('width', `line ${i + 1} is ${w} wide (max ${cols}): ${JSON.stringify(line)}`)
    const bad = line.match(CONTROL)
    if (bad) add('control', `raw control char ${JSON.stringify(bad[0])} on line ${i + 1}: ${JSON.stringify(line)}`)
  })

  // Text that went through an HTML escaper (highlighter, API) must be decoded before it is drawn.
  const entity = plain.match(/&(?:#x?[0-9a-f]+|amp|lt|gt|quot|apos);/i)
  if (entity) add('entity', `undecoded HTML entity ${JSON.stringify(entity[0])}: ${JSON.stringify(lines.find(l => l.includes(entity[0])))}`)

  const small = cols < MIN_COLS || rows < MIN_ROWS
  if (/Terminal too small/.test(plain) !== small) {
    add('small', `"Terminal too small" ${small ? 'missing below' : 'shown at or above'} the ${MIN_COLS}x${MIN_ROWS} minimum`)
  }
  if (small) return found

  if (screen.marker && !screen.marker.test(plain)) add('identity', `not on screen "${screen.id}" (no ${screen.marker})`)

  if (screen.chrome === 'shell') {
    if (rows >= 20) {
      // FooterKeys: a separator line and exactly one hint line, last in the frame.
      if (!/^─+$/.test(lines.at(-2) ?? '') || /^─+$/.test(lines.at(-1) ?? '') || !(lines.at(-1) ?? '').trim()) {
        add('footer', `footer is not one separator + one hint line: ${JSON.stringify(lines.slice(-3))}`)
      } else if (screen.help && !/\? help/.test(lines.at(-1))) {
        add('footer', `footer lost "? help": ${JSON.stringify(lines.at(-1))}`)
      }
      if (!/owner\/repo/.test(lines.at(-3) ?? '')) add('footer', `status bar not directly above the footer: ${JSON.stringify(lines.at(-3))}`)
    } else if (!/owner\/repo/.test(lines.at(-1) ?? '')) {
      // Compact footer (< 20 rows): hints are dropped, the status bar is the last line.
      add('footer', `status bar missing from the last line: ${JSON.stringify(lines.at(-1))}`)
    }
  } else if (!(lines.at(-1) ?? '').trim()) {
    add('footer', 'view footer line is empty')
  }
  return found
}

const KINDS = ['entity', 'width', 'height', 'control', 'colour', 'footer', 'small', 'identity']
const dumpOf = frame => `\n${strip(frame)}`
const describeCase = c => `[${c.cols}x${c.rows} ${c.theme.name}${c.mode === 'NO_COLOR' ? ' NO_COLOR' : ''} ${c.screen.id}]`

function knownFor(c, kind) {
  const at = `${c.cols}x${c.rows}`
  return KNOWN_DEFECTS.find(d => d.screen === c.screen.id && d.kind === kind && (!d.at || d.at.includes(at)))
}

async function reach(c) {
  if (c.mode === 'NO_COLOR') process.env.NO_COLOR = '1'
  const view = mount(c.cols, c.rows, c.theme)
  await settle(view)
  for (const step of c.screen.keys) await sendInput(step.input, step.key)
  await settle(view)
  if (process.env.MATRIX_DUMP === `${c.cols}x${c.rows}`) console.log(`--- ${c.screen.id}\n${strip(view.lastFrame())}`)
  return view
}

describe('screen matrix: real App against fixtures', () => {
  beforeAll(() => { unrouted.length = 0 })
  afterEach(() => { cleanup(); delete process.env.NO_COLOR })
  afterAll(() => { delete process.env.NO_COLOR })

  describe.each(SIZES)('%ix%i', (cols, rows) => {
    describe.each(VARIANTS)('$label', ({ theme, mode }) => {
      for (const screen of SCREENS) {
        const c = { cols, rows, theme, mode, screen }
        const known = KINDS.filter(kind => knownFor(c, kind))

        it(screen.id, async () => {
          const view = await reach(c)
          const frame = terminalFrame(view, mode)
          const unexpected = violations(frame, c).filter(v => !known.includes(v.kind))
          expect(unexpected.map(v => `${v.kind}: ${v.message}`).join('\n'), `${describeCase(c)}${dumpOf(frame)}`).toBe('')
        })

        for (const kind of known) {
          // Tracked defect: fails today, goes red when fixed (then delete the KNOWN_DEFECTS entry).
          it.fails(`${screen.id}: ${kind} (known defect ${knownFor(c, kind).issue})`, async () => {
            const view = await reach(c)
            const frame = terminalFrame(view, mode)
            const broken = violations(frame, c).filter(v => v.kind === kind)
            expect(broken.map(v => `${v.kind}: ${v.message}`).join('\n'), `${describeCase(c)}${dumpOf(frame)}`).toBe('')
          })
        }
      }
    })
  })

  describe('"Terminal too small"', () => {
    const screen = { id: 'too-small', chrome: 'none' }
    it.each([[39, 24], [40, 9], [36, 9], [20, 5], [200, 9], [39, 50]])('%ix%i shows exactly the message', async (cols, rows) => {
      const view = mount(cols, rows)
      await settle(view)
      const frame = view.lastFrame()
      expect(violations(frame, { cols, rows, mode: 'color', screen }).map(v => v.message), dumpOf(frame)).toEqual([])
      expect(strip(frame)).toContain(`needs ${MIN_COLS}x${MIN_ROWS}`)
      expect(strip(frame)).toContain(`now ${cols}x${rows}`)
    })

    it.each([[40, 10], [41, 10], [40, 11]])('%ix%i (the minimum) renders the app instead', async (cols, rows) => {
      const view = mount(cols, rows)
      await settle(view)
      const plain = strip(view.lastFrame())
      expect(plain).not.toMatch(/Terminal too small/)
      expect(plain.split('\n').length).toBeLessThanOrEqual(rows)
    })
  })

  it('never reached for a gh command the fixtures do not know', () => {
    expect(unrouted).toEqual([])
  })
})
