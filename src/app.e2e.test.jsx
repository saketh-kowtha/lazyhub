import React, { useContext } from 'react'
import { Text, useInput } from 'ink'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { sendInput } from './test/input-bus.js'
import { InputDriver } from './test/input-driver.jsx'
import { disarmPrefix, getArmedPrefix } from './config/keymap.js'
import { App } from './app.jsx'
import { AppContext } from './context.js'
import { renderWithProviders, flush, cleanup, waitForExpectation } from './test/test-helpers.jsx'

const exitSpy = vi.hoisted(() => vi.fn())
const paletteProps = vi.hoisted(() => ({ current: null }))

vi.mock('ink', async () => {
  const React = await import('react')
  const actual = await vi.importActual('ink')
  return {
    ...actual,
    useApp: () => ({ exit: exitSpy }),
    useInput: (await import('./test/input-bus.js')).mockUseInput(React),
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
    }),
  }
})

vi.mock('./hooks/useLayout.js', () => ({
  useLayout: () => ({
    cols: 120,
    rows: 30,
    sidebarWidth: 18,
    previewWidth: 40,
    borderStyle: 'round',
    compactFooter: false,
    showSidebar: false,
    showPreview: false,
    listHeight: 12,
  }),
}))

vi.mock('./ipc.js', () => ({
  emitIPC: () => {},
  startIPC: () => '/tmp/lazyhub.sock',
}))

vi.mock('./components/Sidebar.jsx', () => ({ Sidebar: () => <Text>SIDEBAR</Text> }))
vi.mock('./components/TabStrip.jsx', () => ({ TabStrip: () => <Text>TABS</Text> }))
vi.mock('./components/Toaster.jsx', () => ({ Toaster: () => null }))
vi.mock('./components/StatusBar.jsx', () => ({ StatusBar: ({ pane, mode }) => <Text>{`STATUS ${pane} ${mode}`}</Text> }))
vi.mock('./components/FooterKeys.jsx', () => ({ FooterKeys: () => null }))
vi.mock('./components/ErrorBoundary.jsx', () => ({ ErrorBoundary: ({ children }) => children }))
vi.mock('./components/AIAssistant.jsx', () => ({ AIAssistant: () => <Text>AI</Text> }))
vi.mock('./components/CommandPalette.jsx', () => ({
  CommandPalette: (props) => { paletteProps.current = props; return <Text>PALETTE</Text> },
}))
vi.mock('./components/CustomPane.jsx', () => ({ CustomPane: () => <Text>CUSTOM</Text> }))
vi.mock('./features/tabs/view.jsx', () => ({ TabView: () => <Text>TAB VIEW</Text> }))
vi.mock('./features/issues/list.jsx', () => ({ IssueList: () => <Text>ISSUES LIST</Text> }))
vi.mock('./features/issues/detail.jsx', () => ({ IssueDetail: ({ issueNumber }) => <Text>{`ISSUE DETAIL ${issueNumber}`}</Text> }))
vi.mock('./features/branches/index.jsx', () => ({ BranchList: () => <Text>BRANCHES LIST</Text> }))
vi.mock('./features/actions/index.jsx', () => ({ ActionList: () => <Text>ACTIONS LIST</Text> }))
vi.mock('./features/settings/index.jsx', () => ({ SettingsPane: () => <Text>SETTINGS PANE</Text> }))
vi.mock('./features/logs/index.jsx', () => ({ LogPane: () => <Text>LOGS</Text> }))
vi.mock('./features/notifications/index.jsx', () => ({ NotificationList: () => <Text>NOTIFICATIONS LIST</Text> }))
vi.mock('./features/prs/comments.jsx', () => ({ PRComments: ({ prNumber }) => <Text>{`COMMENTS ${prNumber}`}</Text> }))
vi.mock('./features/prs/ConflictView.jsx', () => ({ ConflictView: ({ pr }) => <Text>{`CONFLICT ${pr.number}`}</Text> }))
vi.mock('./features/prs/list.jsx', () => ({
  PRList: ({ onSelectPR, onOpenDiff }) => {
    const { notifyDialog } = useContext(AppContext)
    useInput((input) => {
      if (input === 'x') notifyDialog(true)
      if (input === 'o') onSelectPR({ number: 7, title: 'Open detail' })
      if (input === 'd') onOpenDiff({ number: 9, title: 'Open diff' })
    })
    return <Text>PRS LIST</Text>
  },
}))
vi.mock('./features/prs/detail.jsx', () => ({
  PRDetail: ({ prNumber }) => <Text>{`PR DETAIL ${prNumber}`}</Text>,
}))
vi.mock('./features/prs/diff.jsx', () => ({
  PRDiff: ({ prNumber }) => <Text>{`PR DIFF ${prNumber}`}</Text>,
}))


describe('App shell user flows', () => {
  afterEach(() => {
    cleanup()
    disarmPrefix()
  })

  it('opens PR detail from the list', async () => {
    const view = renderWithProviders(
      <>
        <App repo="owner/repo" />
        <InputDriver events={[{ input: 'o' }]} />
      </>
    )

    await flush(20)
    expect(view.lastFrame()).toContain('PR DETAIL 7')
  })

  it('opens PR diff from the list', async () => {
    const view = renderWithProviders(
      <>
        <App repo="owner/repo" />
        <InputDriver events={[{ input: 'd' }]} />
      </>
    )

    await flush(20)
    expect(view.lastFrame()).toContain('PR DIFF 9')
  })

  it('opens the help overlay from the shell', async () => {
    const view = renderWithProviders(
      <>
        <App repo="owner/repo" />
        <InputDriver events={[{ input: '?' }]} />
      </>
    )

    await flush(20)
    expect(view.lastFrame()).toContain('Keyboard Reference')
  })

  it('help overlay rows have unique React keys even when two actions share a key (B-88)', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const view = renderWithProviders(
        <>
          <App repo="owner/repo" />
          <InputDriver events={[{ input: '?' }]} />
        </>
      )
      await flush(20)
      expect(view.lastFrame()).toContain('Keyboard Reference')
      const dupKeyWarnings = errSpy.mock.calls.filter(c => String(c[0]).includes('two children with the same key'))
      expect(dupKeyWarnings).toEqual([])
    } finally {
      errSpy.mockRestore()
    }
  })

  it('Esc on a top-level list does not quit; q does', async () => {
    exitSpy.mockClear()
    renderWithProviders(
      <>
        <App repo="owner/repo" />
        <InputDriver events={[{ input: '', key: { escape: true } }]} />
      </>
    )
    await flush(20)
    expect(exitSpy).not.toHaveBeenCalled()
    cleanup()

    renderWithProviders(
      <>
        <App repo="owner/repo" />
        <InputDriver events={[{ input: 'q' }]} />
      </>
    )
    await waitForExpectation(() => expect(exitSpy).toHaveBeenCalledTimes(1))
  })

  it('Esc still steps back from detail to the list', async () => {
    const view = renderWithProviders(
      <>
        <App repo="owner/repo" />
        <InputDriver events={[{ input: 'o' }]} />
      </>
    )
    await waitForExpectation(() => expect(view.lastFrame()).toContain('PR DETAIL 7'))
    await sendInput('', { escape: true })
    await waitForExpectation(() => expect(view.lastFrame()).toContain('PRS LIST'))
  })

  it('number keys jump to the Nth active pane from the list and from detail', async () => {
    const view = renderWithProviders(<App repo="owner/repo" />)
    await flush(20)
    // panes in this harness: prs, issues, branches, actions, notifications
    await sendInput('2')
    await waitForExpectation(() => expect(view.lastFrame()).toContain('ISSUES LIST'))
    await sendInput('5')
    await waitForExpectation(() => expect(view.lastFrame()).toContain('NOTIFICATIONS LIST'))
    await sendInput('4')
    await waitForExpectation(() => expect(view.lastFrame()).toContain('ACTIONS LIST'))
    await sendInput('3')
    await waitForExpectation(() => expect(view.lastFrame()).toContain('BRANCHES LIST'))
    await sendInput('1')
    await waitForExpectation(() => expect(view.lastFrame()).toContain('PRS LIST'))
    await sendInput('9') // out of range: ignored
    await flush(10)
    expect(view.lastFrame()).toContain('PRS LIST')
    await sendInput('o')
    await waitForExpectation(() => expect(view.lastFrame()).toContain('PR DETAIL 7'))
    await sendInput('2')
    await waitForExpectation(() => expect(view.lastFrame()).toContain('ISSUES LIST'))
  })

  it('number keys do nothing while a pane dialog (search, pickers) is open', async () => {
    const view = renderWithProviders(<App repo="owner/repo" />)
    await flush(20)
    await sendInput('x') // mock PRList reports an open dialog, as list search does
    await sendInput('2')
    await flush(10)
    expect(view.lastFrame()).toContain('PRS LIST')
  })

  it('number keys do nothing while the help overlay is open', async () => {
    const view = renderWithProviders(<App repo="owner/repo" />)
    await flush(20)
    await sendInput('?')
    await waitForExpectation(() => expect(view.lastFrame()).toContain('Keyboard Reference'))
    await sendInput('2')
    await flush(10)
    await sendInput('', { escape: true })
    expect(view.lastFrame()).toContain('PRS LIST')
  })

  it('g opens a which-key popup and g i jumps to Issues', async () => {
    const view = renderWithProviders(<App repo="owner/repo" />)
    await flush(20)

    await sendInput('g')
    await waitForExpectation(() => expect(view.lastFrame()).toContain('go to / prefix'))
    expect(view.lastFrame()).toContain('issues')
    expect(getArmedPrefix()).not.toBeNull()

    await sendInput('i')
    await waitForExpectation(() => expect(view.lastFrame()).toContain('ISSUES LIST'))
    expect(view.lastFrame()).not.toContain('go to / prefix')
    expect(getArmedPrefix()).toBeNull()
  })

  it('Esc cancels a pending g prefix without navigating', async () => {
    const view = renderWithProviders(<App repo="owner/repo" />)
    await flush(20)
    await sendInput('g')
    await waitForExpectation(() => expect(view.lastFrame()).toContain('go to / prefix'))
    await sendInput('', { escape: true })
    await waitForExpectation(() => expect(view.lastFrame()).not.toContain('go to / prefix'))
    expect(view.lastFrame()).toContain('PRS LIST')
    expect(getArmedPrefix()).toBeNull()
  })

  it('g p returns to Pull Requests from another pane', async () => {
    const view = renderWithProviders(<App repo="owner/repo" />)
    await flush(20)
    await sendInput('g')
    await sendInput('b')
    await waitForExpectation(() => expect(view.lastFrame()).toContain('BRANCHES LIST'))
    await sendInput('g')
    await sendInput('p')
    await waitForExpectation(() => expect(view.lastFrame()).toContain('PRS LIST'))
  })

  it('palette "go to PR/issue #N" opens that item, not just the list (B-87)', async () => {
    const view = renderWithProviders(<App repo="owner/repo" />)
    await flush(20)
    await sendInput(':')
    await waitForExpectation(() => expect(view.lastFrame()).toContain('PALETTE'))
    paletteProps.current.onNavigate({ pane: 'issues', view: 'detail', itemNumber: 17 })
    await waitForExpectation(() => expect(view.lastFrame()).toContain('ISSUE DETAIL 17'))
    await flush(20)

    await sendInput('', { escape: true })
    await waitForExpectation(() => expect(view.lastFrame()).toContain('ISSUES LIST'))
    await sendInput(':')
    await waitForExpectation(() => expect(view.lastFrame()).toContain('PALETTE'))
    paletteProps.current.onNavigate({ pane: 'prs', view: 'diff', itemNumber: 42 })
    await waitForExpectation(() => expect(view.lastFrame()).toContain('PR DIFF 42'))
  })

  it('opens settings from the shell', async () => {
    const view = renderWithProviders(
      <>
        <App repo="owner/repo" />
        <InputDriver events={[{ input: ',' }]} />
      </>
    )

    await flush(20)
    expect(view.lastFrame()).toContain('SETTINGS PANE')
  })
})
