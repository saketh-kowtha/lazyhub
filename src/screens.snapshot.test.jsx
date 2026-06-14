/**
 * Golden render snapshots for major lazyhub screens.
 *
 * Update intentionally with:
 *   npx vitest run src/screens.snapshot.test.jsx -u
 *
 * Rule: snapshot updates ship in the same PR as the implementation they represent,
 * so frame diffs are reviewed as product changes.
 */

import React from 'react'
import { Text, useInput } from 'ink'
import { __sendInput } from 'ink'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from './app.jsx'
import { cleanup, flush, renderWithProviders } from './test/test-helpers.jsx'

const inputHandlers = vi.hoisted(() => new Set())
const layoutState = vi.hoisted(() => ({ cols: 80, rows: 24 }))

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
    __sendInput: (input, key = {}) => {
      for (const handler of [...inputHandlers]) handler(input, key)
    },
  }
})

vi.mock('./config.js', async () => {
  const actual = await vi.importActual('./config.js')
  const base = actual.loadConfig()
  return {
    ...actual,
    loadConfig: () => ({
      ...base,
      panes: ['prs', 'issues', 'branches', 'actions', 'notifications'],
      defaultPane: 'prs',
      default_pane: 'prs',
    }),
  }
})

vi.mock('./hooks/useLayout.js', () => ({
  useLayout: () => ({
    cols: layoutState.cols,
    rows: layoutState.rows,
    sidebarWidth: 18,
    previewWidth: 40,
    borderStyle: 'round',
    compactFooter: false,
    showSidebar: layoutState.cols >= 100,
    showPreview: false,
    listHeight: Math.max(6, layoutState.rows - 8),
  }),
}))

vi.mock('./ipc.js', () => ({
  emitIPC: () => {},
  startIPC: () => '/tmp/lazyhub.sock',
}))

function ScreenBody({ title, lines = [] }) {
  return (
    <>
      <Text>{title}</Text>
      {lines.map(line => <Text key={line}>{line}</Text>)}
    </>
  )
}

vi.mock('./components/Toaster.jsx', () => ({ Toaster: () => null }))
vi.mock('./components/ErrorBoundary.jsx', () => ({ ErrorBoundary: ({ children }) => children }))
vi.mock('./components/CustomPane.jsx', () => ({ CustomPane: () => <ScreenBody title="CUSTOM PANE" /> }))
vi.mock('./features/tabs/view.jsx', () => ({ TabView: () => <ScreenBody title="FOCUS TAB" lines={['review requested', 'my open prs']} /> }))
vi.mock('./features/prs/list.jsx', () => ({
  PRList: ({ onSelectPR, onOpenDiff }) => {
    useInput((input) => {
      if (input === 'enter') onSelectPR({ number: 42, title: 'Fix deterministic snapshots' })
      if (input === 'd') onOpenDiff({ number: 42, title: 'Fix deterministic snapshots' })
    })
    return <ScreenBody title="PR LIST" lines={['#42 Fix deterministic snapshots  ci:fail  review:required', '#41 Phase K daemon cache  ci:pass']} />
  },
}))
vi.mock('./features/prs/detail.jsx', () => ({ PRDetail: ({ prNumber }) => <ScreenBody title={`PR DETAIL #${prNumber}`} lines={['author @octocat', 'labels testing ux']} /> }))
vi.mock('./features/prs/diff.jsx', () => ({ PRDiff: ({ prNumber }) => <ScreenBody title={`DIFF VIEW #${prNumber}`} lines={['@@ src/app.jsx', '- old frame', '+ stable frame']} /> }))
vi.mock('./features/prs/comments.jsx', () => ({ PRComments: ({ prNumber }) => <ScreenBody title={`COMMENTS #${prNumber}`} /> }))
vi.mock('./features/prs/ConflictView.jsx', () => ({ ConflictView: ({ pr }) => <ScreenBody title={`CONFLICT #${pr.number}`} /> }))
vi.mock('./features/issues/list.jsx', () => ({
  IssueList: ({ onSelectIssue }) => {
    useInput((input) => {
      if (input === 'enter') onSelectIssue({ number: 9, title: 'Golden snapshots' })
    })
    return <ScreenBody title="ISSUE LIST" lines={['#9 Golden snapshots  p1 testing', '#8 Design references  p0 ux']} />
  },
}))
vi.mock('./features/issues/detail.jsx', () => ({ IssueDetail: ({ issueNumber }) => <ScreenBody title={`ISSUE DETAIL #${issueNumber}`} lines={['state open', 'assignee @octocat']} /> }))
vi.mock('./features/branches/index.jsx', () => ({ BranchList: () => <ScreenBody title="BRANCHES" lines={['main protected', 'feat/daemon active']} /> }))
vi.mock('./features/actions/index.jsx', () => ({ ActionList: () => <ScreenBody title="ACTIONS" lines={['CI completed success', 'Release queued']} /> }))
vi.mock('./features/notifications/index.jsx', () => ({ NotificationList: () => <ScreenBody title="NOTIFICATIONS" lines={['review requested', 'workflow failed']} /> }))
vi.mock('./features/settings/index.jsx', () => ({ SettingsPane: () => <ScreenBody title="SETTINGS" /> }))
vi.mock('./features/logs/index.jsx', () => ({ LogPane: () => <ScreenBody title="LOGS" /> }))
vi.mock('./components/AIAssistant.jsx', () => ({ AIAssistant: () => <ScreenBody title="AI ASSISTANT" /> }))

async function snapshotScreen(name, { cols = 80, rows = 24, events = [] } = {}) {
  inputHandlers.clear()
  layoutState.cols = cols
  layoutState.rows = rows
  const view = renderWithProviders(
    <App repo="owner/repo" />
  )
  await flush(30)
  for (const event of events) {
    __sendInput(event.input || '', event.key || {})
    await flush(80)
  }
  await flush(30)
  expect(view.lastFrame()).toMatchSnapshot(name)
  cleanup()
  inputHandlers.clear()
}

describe('major screen golden snapshots', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    vi.setSystemTime(new Date('2026-06-13T12:00:00Z'))
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  it('covers all 80-column major screens', async () => {
    await snapshotScreen('80x24 pr list')
    await snapshotScreen('80x24 pr detail', { events: [{ input: 'enter' }] })
    await snapshotScreen('80x24 diff view', { events: [{ input: 'd' }] })
    await snapshotScreen('80x24 issue list', { events: [{ input: '2' }] })
    await snapshotScreen('80x24 issue detail', { events: [{ input: '2' }, { input: 'enter' }] })
    await snapshotScreen('80x24 branches', { events: [{ input: '3' }] })
    await snapshotScreen('80x24 actions', { events: [{ input: '4' }] })
    await snapshotScreen('80x24 notifications', { events: [{ input: '5' }] })
    await snapshotScreen('80x24 help overlay', { events: [{ input: '?' }] })
    await snapshotScreen('80x24 command palette', { events: [{ input: ':' }] })
  })

  it('covers wide PR list and diff frames', async () => {
    await snapshotScreen('120x30 pr list', { cols: 120, rows: 30 })
    await snapshotScreen('120x30 diff view', { cols: 120, rows: 30, events: [{ input: 'd' }] })
  })
})
