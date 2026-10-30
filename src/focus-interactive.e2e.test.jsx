/**
 * focus-interactive.e2e.test.jsx -- the default Focus dashboard is interactive (#279).
 *
 * Drives the real App on the `focus` pane: a cursor moves across the rows,
 * Enter opens the right PR/issue in its existing detail view, Esc returns with
 * the selection kept, `o` opens the browser, `r` refreshes, and the footer and
 * `?` help list only keys that work.
 */

import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Text } from 'ink'
import { sendInput } from './test/input-bus.js'
import { App } from './app.jsx'
import { useGh } from './hooks/useGh.js'
import * as executor from './executor.js'
import { disarmPrefix } from './config/keymap.js'
import { resetTabSelection } from './features/tabs/view.jsx'
import { renderWithProviders, flush, cleanup, waitForExpectation } from './test/test-helpers.jsx'

const execaSpy = vi.hoisted(() => vi.fn(() => Object.assign(Promise.resolve({}), { stdin: { end: () => {} } })))
const refetchSpy = vi.hoisted(() => vi.fn())

vi.mock('ink', async () => {
  const React = await import('react')
  const actual = await vi.importActual('ink')
  return {
    ...actual,
    useApp: () => ({ exit: vi.fn() }),
    useInput: (await import('./test/input-bus.js')).mockUseInput(React),
  }
})

vi.mock('execa', () => ({ execa: execaSpy }))
vi.mock('./hooks/useGh.js', () => ({ useGh: vi.fn() }))

vi.mock('./config.js', async () => {
  const actual = await vi.importActual('./config.js')
  const base = actual.loadConfig()
  return {
    ...actual,
    loadConfig: () => ({ ...base, panes: ['focus', 'prs', 'issues'], defaultPane: 'focus' }),
  }
})

vi.mock('./hooks/useLayout.js', () => ({
  useLayout: () => ({
    cols: 80, rows: 40, sidebarWidth: 18, previewWidth: 40, borderStyle: 'round',
    compactFooter: false, showSidebar: false, showPreview: false, listHeight: 30,
  }),
}))
vi.mock('./ipc.js', () => ({ emitIPC: () => {}, startIPC: () => '/tmp/lazyhub.sock' }))
vi.mock('./editor.js', () => ({ openInEditor: vi.fn(), editorLabel: 'Editor' }))
vi.mock('./ai/index.js', () => ({ AIError: class AIError extends Error {}, getAICodeReview: vi.fn() }))
vi.mock('./components/TabStrip.jsx', () => ({ TabStrip: () => <Text>TABS</Text> }))
vi.mock('./components/Toaster.jsx', () => ({ Toaster: () => null }))
vi.mock('./components/StatusBar.jsx', () => ({ StatusBar: () => null }))

vi.mock('./executor.js', () => {
  const fns = [
    'listPRs', 'listIssues', 'getPR', 'getIssue', 'getRepoInfo', 'getPRChecks', 'getBranchProtection',
    'listLabels', 'listCollaborators', 'getCurrentBranch', 'listBranches', 'listRuns',
  ]
  return { ...Object.fromEntries(fns.map(name => [name, vi.fn()])), classifyGhFailure: () => ({ message: 'x' }) }
})

const pr = (number, title) => ({
  number, title, state: 'OPEN', isDraft: false, updatedAt: '2026-06-06T10:00:00Z', url: `https://example.test/pull/${number}`,
  author: { login: 'alice' }, labels: [], assignees: [], reviews: [], reviewRequests: [], files: [], statusCheckRollup: [],
  baseRefName: 'main', headRefName: 'f', headRefOid: 'a'.repeat(40), mergeable: 'MERGEABLE', mergeStateStatus: 'CLEAN', body: `body ${number}`,
})
const issue = (number, title) => ({
  number, title, state: 'OPEN', updatedAt: '2026-06-06T10:00:00Z', url: `https://example.test/issues/${number}`,
  author: { login: 'bob' }, labels: [], assignees: [], comments: [], body: `body ${number}`,
})

const REVIEW = [pr(101, 'Review alpha'), pr(102, 'Review beta')]
const MINE = [pr(201, 'Mine gamma')]
const ASSIGNED = [issue(301, 'Issue delta'), issue(302, 'Issue epsilon')]
let reviewItems

function ghResult(data) {
  return { data, loading: false, error: null, refetch: refetchSpy, mutate: vi.fn(), isStale: false }
}

const key = (input, flags = {}) => ({ input, key: flags })
const ENTER = key('', { return: true })
const ESC = key('', { escape: true })

async function press(steps) {
  for (const step of steps) {
    await sendInput(step.input, step.key)
    await flush(15)
  }
}

const rowLine = (view, title) => view.lastFrame().split('\n').find(l => l.includes(title)) || ''
const isSelected = (view, title) => rowLine(view, title).includes('▸')

async function mount() {
  const view = renderWithProviders(<App repo="owner/repo" />)
  await waitForExpectation(() => expect(view.lastFrame()).toContain('Review alpha'))
  await flush(30)
  return view
}

describe('Focus dashboard is interactive (#279)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    reviewItems = REVIEW
    useGh.mockImplementation((fn, deps = []) => {
      if (fn === executor.listPRs) return ghResult(deps[1]?.reviewer ? reviewItems : MINE)
      if (fn === executor.listIssues) return ghResult(ASSIGNED)
      if (fn === executor.getPR) return ghResult([...REVIEW, ...MINE].find(p => p.number === deps[1]))
      if (fn === executor.getIssue) return ghResult(ASSIGNED.find(i => i.number === deps[1]))
      if (fn === executor.getRepoInfo) return ghResult({ squashMergeAllowed: true, viewerPermission: 'WRITE' })
      if (fn === executor.getPRChecks) return ghResult([])
      if (fn === executor.getBranchProtection) return ghResult({ requiredReviews: 1 })
      return ghResult(null)
    })
  })
  afterEach(() => { disarmPrefix(); resetTabSelection(); cleanup() })

  it('selects the first row and moves with j/k', async () => {
    const view = await mount()
    expect(isSelected(view, 'Review alpha')).toBe(true)
    await press([key('j')])
    expect(isSelected(view, 'Review beta')).toBe(true)
    expect(isSelected(view, 'Review alpha')).toBe(false)
    await press([key('k')])
    expect(isSelected(view, 'Review alpha')).toBe(true)
  })

  it('Enter opens the selected PR detail and Esc returns with the selection kept', async () => {
    const view = await mount()
    await press([key('j'), ENTER])
    await waitForExpectation(() => expect(useGh).toHaveBeenCalledWith(executor.getPR, ['owner/repo', 102]))
    await waitForExpectation(() => expect(view.lastFrame()).toContain('body 102'))
    await press([ESC])
    await waitForExpectation(() => expect(view.lastFrame()).toContain('Review alpha'))
    expect(isSelected(view, 'Review beta')).toBe(true)
  })

  it('moves between sections with ] and [ and opens an issue in the issue detail', async () => {
    const view = await mount()
    await press([key(']'), key(']'), key('j'), ENTER])
    await waitForExpectation(() => expect(useGh).toHaveBeenCalledWith(executor.getIssue, ['owner/repo', 302]))
    await waitForExpectation(() => expect(view.lastFrame()).toContain('body 302'))
    await press([ESC])
    await waitForExpectation(() => expect(view.lastFrame()).toContain('Issue delta'))
    expect(isSelected(view, 'Issue epsilon')).toBe(true)
    await press([key('[')])
    expect(isSelected(view, 'Mine gamma')).toBe(true)
    expect(isSelected(view, 'Issue epsilon')).toBe(false)
  })

  it('o opens the selected item in the browser', async () => {
    const view = await mount()
    await press([key('j'), key('o')])
    await waitForExpectation(() => expect(execaSpy).toHaveBeenCalledWith(expect.any(String), ['https://example.test/pull/102']))
    expect(view.lastFrame()).toContain('Review beta')
  })

  it('r refreshes the dashboard panes', async () => {
    await mount()
    refetchSpy.mockClear()
    await press([key('r')])
    expect(refetchSpy).toHaveBeenCalled()
  })

  it('Enter on an empty section opens nothing', async () => {
    reviewItems = []
    const view = renderWithProviders(<App repo="owner/repo" />)
    await waitForExpectation(() => expect(view.lastFrame()).toContain('No items'))
    await press([ENTER, key('o')])
    expect(useGh).not.toHaveBeenCalledWith(executor.getPR, expect.anything())
    expect(execaSpy).not.toHaveBeenCalled()
  })

  it('the footer and ? help list the keys that work', async () => {
    const view = await mount()
    const footer = view.lastFrame()
    expect(footer).toMatch(/Enter\s+open/)
    expect(footer).toMatch(/o\s+browser/)
    await press([key('?')])
    await waitForExpectation(() => expect(view.lastFrame()).toContain('Keyboard Reference'))
    const help = view.lastFrame()
    expect(help).toContain('Open the selected')
    expect(help).toMatch(/browser/)
    expect(help).toContain('Next section')
    expect(help).toContain('Refresh the active')
    // list-only verbs Focus does not implement stay out
    expect(help).not.toContain('Open PR detail')
    expect(help).not.toMatch(/Search|Filter/)
    expect(help).not.toContain('Approve')
  })
})
