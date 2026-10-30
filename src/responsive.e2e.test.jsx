/**
 * Responsive layout e2e: the real App shell (real useLayout / useTerminalSize,
 * Sidebar, StatusBar, FooterKeys, HelpOverlay) rendered at many terminal sizes and
 * resized live. Feature panes are stubbed; the shell geometry is what is under test.
 */

import React from 'react'
import { Text } from 'ink'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from './app.jsx'
import { cleanup, flush, renderWithProviders } from './test/test-helpers.jsx'

const inputHandlers = vi.hoisted(() => new Set())

vi.mock('ink', async () => {
  const React = await import('react')
  const actual = await vi.importActual('ink')
  return {
    ...actual,
    useInput: (handler) => {
      React.useEffect(() => {
        inputHandlers.add(handler)
        return () => inputHandlers.delete(handler)
      }, [handler])
    },
  }
})

vi.mock('./config.js', async () => {
  const actual = await vi.importActual('./config.js')
  const base = actual.loadConfig()
  return {
    ...actual,
    loadConfig: () => ({ ...base, panes: ['prs', 'issues', 'branches', 'actions', 'notifications'], defaultPane: 'prs', default_pane: 'prs' }),
  }
})
vi.mock('./ipc.js', () => ({ emitIPC: () => {}, startIPC: () => '/tmp/lazyhub.sock' }))
vi.mock('./components/Toaster.jsx', () => ({ Toaster: () => null }))
vi.mock('./components/ErrorBoundary.jsx', () => ({ ErrorBoundary: ({ children }) => children }))
vi.mock('./features/prs/list.jsx', () => ({ PRList: () => <Text>PR LIST BODY</Text> }))
vi.mock('./features/prs/detail.jsx', () => ({ PRDetail: () => <Text>PR DETAIL</Text> }))
vi.mock('./features/prs/diff.jsx', () => ({ PRDiff: () => <Text>DIFF</Text> }))
vi.mock('./features/prs/comments.jsx', () => ({ PRComments: () => <Text>COMMENTS</Text> }))
vi.mock('./features/prs/ConflictView.jsx', () => ({ ConflictView: () => <Text>CONFLICT</Text> }))
vi.mock('./features/issues/list.jsx', () => ({ IssueList: () => <Text>ISSUES BODY</Text> }))
vi.mock('./features/issues/detail.jsx', () => ({ IssueDetail: () => <Text>ISSUE DETAIL</Text> }))
vi.mock('./features/branches/index.jsx', () => ({ BranchList: () => <Text>BRANCHES BODY</Text> }))
vi.mock('./features/actions/index.jsx', () => ({ ActionList: () => <Text>ACTIONS BODY</Text> }))
vi.mock('./features/notifications/index.jsx', () => ({ NotificationList: () => <Text>NOTIFICATIONS BODY</Text> }))
vi.mock('./features/settings/index.jsx', () => ({ SettingsPane: () => <Text>SETTINGS</Text> }))
vi.mock('./features/logs/index.jsx', () => ({ LogPane: () => <Text>LOGS</Text> }))
vi.mock('./features/tabs/view.jsx', () => ({ TabView: () => <Text>TAB</Text> }))
vi.mock('./components/CustomPane.jsx', () => ({ CustomPane: () => <Text>CUSTOM</Text> }))
vi.mock('./components/AIAssistant.jsx', () => ({ AIAssistant: () => <Text>AI</Text> }))

// eslint-disable-next-line no-control-regex
const stripAnsi = s => s.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '')

function setSize(stdout, columns, rows) {
  Object.defineProperty(stdout, 'columns', { value: columns, configurable: true })
  Object.defineProperty(stdout, 'rows', { value: rows, configurable: true })
}

async function mountAt(columns, rows) {
  inputHandlers.clear()
  const view = renderWithProviders(<App repo="owner/repo" />)
  // ink-testing-library's stdout has a fixed 100 columns; make it behave like a resizable TTY.
  setSize(view.stdout, columns, rows)
  view.stdout.emit('resize')
  await flush(120)
  return view
}

const frame = view => stripAnsi(view.lastFrame() ?? '')
const press = async (input, key = {}) => {
  for (const handler of [...inputHandlers]) handler(input, key)
  await flush(60)
}

const SIZES = [[200, 50], [120, 40], [100, 30], [81, 24], [80, 24], [70, 20], [60, 18], [50, 15], [45, 12], [40, 10]]

describe('responsive shell: no frame is wider or taller than the terminal', () => {
  beforeEach(() => { vi.useFakeTimers({ shouldAdvanceTime: true }) })
  afterEach(() => { cleanup(); vi.useRealTimers() })

  for (const [cols, rows] of SIZES) {
    it(`list frame fits ${cols}x${rows}`, async () => {
      const view = await mountAt(cols, rows)
      const lines = frame(view).split('\n')
      expect(Math.max(...lines.map(l => [...l].length)), `widest line\n${frame(view)}`).toBeLessThanOrEqual(cols)
      expect(lines.length, `height\n${frame(view)}`).toBeLessThanOrEqual(rows)
    })

    it(`help overlay fits ${cols}x${rows}`, async () => {
      const view = await mountAt(cols, rows)
      await press('?')
      const lines = frame(view).split('\n')
      expect(frame(view)).toContain('Keyboard Reference')
      expect(Math.max(...lines.map(l => [...l].length)), `widest line\n${frame(view)}`).toBeLessThanOrEqual(cols)
      expect(lines.length, `height\n${frame(view)}`).toBeLessThanOrEqual(rows)
    })
  }
})

describe('responsive shell: breakpoints', () => {
  afterEach(() => { cleanup() })

  it('wide: sidebar is shown', async () => {
    const view = await mountAt(120, 40)
    expect(frame(view)).toContain('Notifications')
    expect(frame(view)).toContain('lazyhub')
  })

  it('narrow (< 80 cols): the sidebar collapses to a one-row tab strip', async () => {
    const view = await mountAt(70, 20)
    const out = frame(view)
    expect(out).not.toContain('⌂ lazyhub')
    expect(out.split('\n')[0]).toMatch(/Pull Requests/)
  })

  it('too small: one clear message replaces the frame', async () => {
    const view = await mountAt(36, 9)
    const out = frame(view)
    expect(out).toMatch(/Terminal too small/)
    expect(out).toMatch(/needs 40x10/)
    expect(out).not.toContain('PR LIST BODY')
  })

  it('keeps the footer on one row and keeps "? help" when it must drop hints', async () => {
    const view = await mountAt(80, 24)
    const lines = frame(view).split('\n')
    expect(lines.at(-1)).toMatch(/\? help/)
    expect(lines.at(-2)).toMatch(/^─+$/)
    expect(lines).toHaveLength(24)
  })
})

describe('responsive shell: live resize', () => {
  afterEach(() => { cleanup() })

  it('re-lays-out when the terminal shrinks and grows, with no stale content', async () => {
    const view = await mountAt(120, 40)
    expect(frame(view)).toContain('⌂ lazyhub')

    setSize(view.stdout, 60, 18)
    view.stdout.emit('resize')
    await flush(150)
    let lines = frame(view).split('\n')
    expect(Math.max(...lines.map(l => [...l].length))).toBeLessThanOrEqual(60)
    expect(lines.length).toBeLessThanOrEqual(18)
    expect(frame(view)).not.toContain('⌂ lazyhub')

    setSize(view.stdout, 120, 40)
    view.stdout.emit('resize')
    await flush(150)
    lines = frame(view).split('\n')
    expect(frame(view)).toContain('⌂ lazyhub')
    expect(lines.length).toBeLessThanOrEqual(40)
  })

  it('survives a burst of rapid resizes and settles on the last size', async () => {
    const view = await mountAt(120, 40)
    for (const [c, r] of [[100, 30], [50, 15], [90, 24], [36, 9], [70, 20], [81, 24]]) {
      setSize(view.stdout, c, r)
      view.stdout.emit('resize')
      await flush(5)
    }
    await flush(200)
    const lines = frame(view).split('\n')
    expect(Math.max(...lines.map(l => [...l].length))).toBeLessThanOrEqual(81)
    expect(lines.length).toBeLessThanOrEqual(24)
    expect(frame(view)).not.toMatch(/too small/i)
  })
})
