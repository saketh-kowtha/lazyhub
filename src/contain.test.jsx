import React from 'react'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Text } from 'ink'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { containHandler, getContainedToast, getSwallowed, logSwallowed, reportContained, resetContained, resetSwallowed } from './contain.js'
import { getGhHealthSnapshot } from './hooks/useGhHealth.js'
import { useKeymapInput } from './config/keymap.js'
import { ErrorBoundary } from './components/ErrorBoundary.jsx'
import { StatusBar } from './components/StatusBar.jsx'
import { sendInput } from './test/input-bus.js'
import { cleanup, flush, renderWithProviders, waitForExpectation } from './test/test-helpers.jsx'

vi.mock('ink', async () => {
  const React = await import('react')
  return { ...await vi.importActual('ink'), useInput: (await import('./test/input-bus.js')).mockUseInput(React) }
})

afterEach(() => { cleanup(); resetContained(); resetSwallowed(); vi.unstubAllEnvs() })

describe('handler errors are contained (#490)', () => {
  it('a throwing handler is logged and shown as a toast instead of escaping', () => {
    const wrapped = containHandler(() => { throw new Error('boom') }, 'pr.merge')
    expect(() => wrapped('x', {})).not.toThrow()
    expect(getContainedToast()).toMatch(/pr\.merge.*boom/)
    expect(getGhHealthSnapshot().toast).toMatch(/boom/)
  })

  it('a rejected promise from an async handler is contained too', async () => {
    containHandler(async () => { throw new Error('late') })('x', {})
    await flush(5)
    expect(getContainedToast()).toMatch(/late/)
  })

  it('passes arguments and return values through when nothing throws', () => {
    expect(containHandler((a, b) => a + b)(1, 2)).toBe(3)
    expect(getContainedToast()).toBeNull()
  })

  it('the toast clears itself', async () => {
    vi.useFakeTimers()
    try {
      reportContained('key', new Error('x'))
      expect(getContainedToast()).not.toBeNull()
      await vi.advanceTimersByTimeAsync(7000)
      expect(getContainedToast()).toBeNull()
    } finally { vi.useRealTimers() }
  })

  it('a pane key handler that throws keeps the app running and shows the toast in the status bar', async () => {
    const seen = []
    function Pane() {
      useKeymapInput((input) => {
        seen.push(input)
        if (input === 'x') throw new Error('pane handler bug')
      })
      return <Text>pane alive</Text>
    }
    const view = renderWithProviders(<><Pane /><StatusBar repo="o/r" pane="prs" count={1} ghHealth={getGhHealthSnapshot()} /></>)
    await flush(5)
    await expect(sendInput('x')).resolves.toBeUndefined()
    await sendInput('y')
    expect(seen).toEqual(['x', 'y'])
    expect(view.lastFrame()).toContain('pane alive')
    expect(getContainedToast()).toMatch(/pane handler bug/)
  })
})

describe('ErrorBoundary reset (#490)', () => {
  const crash = { on: true }
  function Bomb() {
    if (crash.on) throw new Error('render crash')
    return <Text>recovered</Text>
  }

  it('r remounts the subtree; dismiss alone does not loop silently', async () => {
    crash.on = true
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    const view = renderWithProviders(<ErrorBoundary><Bomb /></ErrorBoundary>)
    await waitForExpectation(() => expect(view.lastFrame()).toContain('Something went wrong'))
    expect(view.lastFrame()).toContain('render crash')
    expect(view.lastFrame()).toMatch(/\[r\] reset/)

    await sendInput('r')
    await waitForExpectation(() => expect(view.lastFrame()).toContain('Something went wrong')) // still crashing: back on the error screen
    crash.on = false
    await sendInput('r')
    await waitForExpectation(() => expect(view.lastFrame()).toContain('recovered'))
    errors.mockRestore()
  })

  it('has no literal colours: it takes them from the theme', () => {
    const src = readFileSync(new URL('./components/ErrorBoundary.jsx', import.meta.url), 'utf8')
    expect(src).not.toMatch(/['"]#[0-9a-fA-F]{3,8}['"]/)
    expect(src).toMatch(/useTheme/)
  })
})

describe('no app code reaches for Ink useInput directly', () => {
  it('keeps containment in one place (every non-test source file)', () => {
    const walk = dir => readdirSync(dir, { withFileTypes: true }).flatMap(e => {
      const full = join(dir, e.name)
      if (e.isDirectory()) return e.name === 'test' ? [] : walk(full)
      return /\.(?:js|jsx)$/.test(e.name) && !/\.test\./.test(e.name) ? [full] : []
    })
    const root = fileURLToPath(new URL('.', import.meta.url))
    const offenders = walk(root)
      .filter(f => !f.endsWith(join('hooks', 'useSafeInput.js')))
      .filter(f => /import\s*\{[^}]*\buseInput\b[^}]*\}\s*from\s*'ink'/.test(readFileSync(f, 'utf8')))
    expect(offenders.map(f => f.slice(root.length))).toEqual([])
  })
})

describe('logSwallowed replaces silent catches (#490 R12)', () => {
  it('records the scope and message only when LAZYHUB_DEBUG is set, and never throws', () => {
    vi.stubEnv('LAZYHUB_DEBUG', '')
    logSwallowed('a.b', new Error('quiet'))
    expect(getSwallowed()).toEqual([])
    vi.stubEnv('LAZYHUB_DEBUG', '1')
    expect(() => logSwallowed('c.d', new Error('seen\nsecond line'))).not.toThrow()
    expect(getSwallowed()).toMatchObject([{ scope: 'c.d', message: 'seen' }])
    expect(() => logSwallowed('c.e', undefined)).not.toThrow()
  })

  it('collapses a repeating failure so a hot path cannot flood the log', () => {
    vi.stubEnv('LAZYHUB_DEBUG', '1')
    for (let i = 0; i < 20; i++) logSwallowed('hot.path', new Error('same'))
    expect(getSwallowed()).toHaveLength(1)
  })

  it('no UI path keeps an empty catch block or an empty .catch(() => {})', () => {
    const walk = dir => readdirSync(dir, { withFileTypes: true }).flatMap(e => {
      const full = join(dir, e.name)
      if (e.isDirectory()) return walk(full)
      return /\.(?:js|jsx)$/.test(e.name) && !/\.test\./.test(e.name) ? [full] : []
    })
    const root = fileURLToPath(new URL('.', import.meta.url))
    const dirs = ['features', 'components', 'ui', 'hooks'].map(d => join(root, d))
    const files = [...dirs.flatMap(walk), join(root, 'app.jsx'), join(root, 'app-views.jsx'), join(root, 'app-panels.jsx')]
    const silent = /catch\s*(?:\(\w*\))?\s*\{\s*(?:\/\*[^*]*\*\/|\/\/[^\n]*)?\s*\}|\.catch\(\s*\(\s*\w*\s*\)\s*=>\s*\{\s*\}\s*\)/
    const offenders = files.filter(f => silent.test(readFileSync(f, 'utf8')))
    expect(offenders).toEqual([])
  })
})

describe('a crashing section does not take the screen down (#490 R12)', () => {
  it('a section boundary shows one line and leaves its siblings alone', () => {
    function Bomb() { throw new Error('sidebar crash') }
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    const view = renderWithProviders(<><ErrorBoundary section="Sidebar"><Bomb /></ErrorBoundary><Text>main pane alive</Text></>)
    expect(view.lastFrame()).toContain('Sidebar unavailable')
    expect(view.lastFrame()).toContain('main pane alive')
    errors.mockRestore()
  })
})
