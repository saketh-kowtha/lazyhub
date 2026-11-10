// REMOUNT vital (#597, V0): mounts of the base PR list across an overlay open/close and across
// list -> detail -> back, counted in-process with the recorder's mount/unmount events.
//
// Before lane V3 both flows REMOUNTed the list (app-views.jsx returned a different tree per overlay and
// per view); the harness saw that (V0 acceptance 3). With V3 the target holds: 0 extra mounts.
import React, { useEffect } from 'react'
import { Text, useInput } from 'ink'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { sendInput } from '../test/input-bus.js'
import { disarmPrefix } from '../config/keymap.js'
import { App } from '../app.jsx'
import { renderWithProviders, flush, cleanup, waitForExpectation } from '../test/test-helpers.jsx'
import { createRecorder } from './vitals.js'
import { extraMounts, parseEvents } from './vitals-metrics.js'

const sink = vi.hoisted(() => ({ lines: [] }))

vi.mock('ink', async () => {
  const React = await import('react')
  const actual = await vi.importActual('ink')
  return {
    ...actual,
    useApp: () => ({ exit: () => {} }),
    useInput: (await import('../test/input-bus.js')).mockUseInput(React),
  }
})
vi.mock('../config.js', async () => {
  const actual = await vi.importActual('../config.js')
  const base = actual.loadConfig()
  return { ...actual, loadConfig: () => ({ ...base, panes: ['prs', 'issues', 'branches', 'actions', 'notifications'], defaultPane: 'prs' }) }
})
vi.mock('../hooks/useLayout.js', () => ({
  useLayout: () => ({ cols: 120, rows: 30, sidebarWidth: 18, previewWidth: 40, borderStyle: 'round', compactFooter: false, showSidebar: false, showPreview: false, listHeight: 12 }),
}))
vi.mock('../ipc.js', () => ({ emitIPC: () => {}, startIPC: () => '/tmp/lazyhub.sock' }))
vi.mock('../components/Sidebar.jsx', () => ({ Sidebar: () => <Text>SIDEBAR</Text> }))
vi.mock('../components/TabStrip.jsx', () => ({ TabStrip: () => <Text>TABS</Text> }))
vi.mock('../components/Toaster.jsx', () => ({ Toaster: () => null }))
vi.mock('../components/StatusBar.jsx', () => ({ StatusBar: ({ pane, mode }) => <Text>{`STATUS ${pane} ${mode}`}</Text> }))
vi.mock('../components/FooterKeys.jsx', () => ({ FooterKeys: () => null }))
vi.mock('../components/ErrorBoundary.jsx', () => ({ ErrorBoundary: ({ children }) => children }))
vi.mock('../features/prs/detail.jsx', () => ({ PRDetail: ({ prNumber }) => <Text>{`PR DETAIL ${prNumber}`}</Text> }))
vi.mock('../features/prs/list.jsx', async () => {
  const { createRecorder: make } = await import('./vitals.js')
  const rec = make({ enabled: true, file: '/virtual/vitals.jsonl', append: (_file, text) => sink.lines.push(text) })
  return {
    PRList: ({ repo, onSelectPR }) => {
      useEffect(() => { rec.mount('pr-list'); return () => rec.unmount('pr-list') }, [])
      useInput((input) => { if (input === 'o') onSelectPR({ number: 7, title: 'Open detail' }) })
      return <Text>{`PRS LIST ${repo}`}</Text>
    },
  }
})

const events = () => parseEvents(sink.lines.join(''))
const reset = () => { sink.lines.length = 0 }

async function mountApp() {
  reset()
  const view = renderWithProviders(<App repo="owner/repo" />)
  await flush(20)
  await waitForExpectation(() => expect(view.lastFrame()).toContain('PRS LIST'))
  expect(extraMounts(events(), 'pr-list')).toBe(0)
  return view
}

const overlayRoundTrip = async view => {
  await sendInput('?')
  await waitForExpectation(() => expect(view.lastFrame()).toContain('Keyboard Reference'))
  await sendInput('', { escape: true })
  await waitForExpectation(() => expect(view.lastFrame()).toContain('PRS LIST'))
  return extraMounts(events(), 'pr-list')
}

const detailRoundTrip = async view => {
  await sendInput('o')
  await waitForExpectation(() => expect(view.lastFrame()).toContain('PR DETAIL 7'))
  await sendInput('', { escape: true })
  await waitForExpectation(() => expect(view.lastFrame()).toContain('PRS LIST'))
  return extraMounts(events(), 'pr-list')
}

describe('REMOUNT vital', () => {
  afterEach(() => { cleanup(); disarmPrefix() })

  it('recorder sanity: the in-memory recorder used here stays local', () => {
    expect(createRecorder({ enabled: false }).enabled).toBe(false)
  })

  // Lane V3 landed: overlays are layers and the navigation stack keeps the list alive.
  it('target: overlay open+close causes 0 extra mounts of the base list', async () => {
    const view = await mountApp()
    expect(await overlayRoundTrip(view)).toBe(0)
  })

  it('target: list -> detail -> back causes 0 extra mounts of the base list', async () => {
    const view = await mountApp()
    expect(await detailRoundTrip(view)).toBe(0)
  })
})
