// Lane V3 acceptance tests (#597): overlays are layers, navigation keeps views alive.
// Mounts are counted per view (REMOUNT) and gh calls are counted by a stand-in for the data layer (WARM-GH):
// a view that mounts again would fetch again, so "mount count stays 1" is what keeps the gh count at 0.
import React, { useState } from 'react'
import { Text } from 'ink'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { sendInput } from '../test/input-bus.js'
import { App } from '../app.jsx'
import { useInput } from '../hooks/useSafeInput.js'
import { useCovered } from './covered.js'
import { renderWithProviders, flush, cleanup } from '../test/test-helpers.jsx'
import { disarmPrefix } from '../config/keymap.js'

const probe = vi.hoisted(() => ({ mounts: {}, ghCalls: 0, bumpList: null, palette: null, picker: null }))

vi.mock('ink', async () => {
  const React = await import('react')
  const actual = await vi.importActual('ink')
  return { ...actual, useApp: () => ({ exit: vi.fn() }), useInput: (await import('../test/input-bus.js')).mockUseInput(React) }
})
vi.mock('../config.js', async () => {
  const actual = await vi.importActual('../config.js')
  const base = actual.loadConfig()
  return { ...actual, loadConfig: () => ({ ...base, panes: ['prs', 'issues', 'branches', 'actions', 'notifications'], defaultPane: 'prs' }) }
})
vi.mock('../hooks/useLayout.js', () => ({
  useLayout: () => ({ cols: 120, rows: 30, termRows: 31, sidebarWidth: 18, previewWidth: 40, borderStyle: 'round', compactFooter: false, showSidebar: false, showPreview: false, listHeight: 12 }),
}))
vi.mock('../ipc.js', () => ({ emitIPC: () => {}, startIPC: () => '/tmp/lazyhub.sock' }))
vi.mock('../components/AIAssistant.jsx', () => ({ AIAssistant: () => <Text>AI OVERLAY</Text> }))
vi.mock('../components/CommandPalette.jsx', () => ({ CommandPalette: (props) => { probe.palette = props; return <Text>PALETTE OVERLAY</Text> } }))
vi.mock('../features/onboarding/Onboarding.jsx', () => ({ RepoSwitcher: (props) => { probe.picker = props; return <Text>REPO PICKER OVERLAY</Text> } }))
vi.mock('../features/prs/comments.jsx', () => ({ PRComments: ({ prNumber }) => <Text>{`COMMENTS ${prNumber}`}</Text> }))

// A view mounts "fetching": each mount stands for one gh call it would make.
function useMountCount(name) {
  React.useEffect(() => {
    probe.mounts[name] = (probe.mounts[name] || 0) + 1
    probe.ghCalls += 1
  }, [name])
}

vi.mock('../features/prs/list.jsx', () => ({
  PRList: ({ onSelectPR, onPaneState }) => {
    useMountCount('list')
    const [cursor, setCursor] = useState(0)
    const covered = useCovered()
    probe.bumpList = () => setCursor(c => c + 100)
    React.useEffect(() => { onPaneState?.({ count: 3, actionCtx: { kind: 'list' } }) }, [onPaneState])
    useInput((input) => {
      if (input === 'j') setCursor(c => c + 1)
      if (input === 'o') onSelectPR({ number: 7, title: 'Seven' })
    })
    return <Text>{`LIST cursor=${cursor} covered=${covered}`}</Text>
  },
}))
vi.mock('../features/prs/detail.jsx', () => ({
  PRDetail: ({ prNumber, onOpenDiff }) => {
    useMountCount('detail')
    useInput((input) => { if (input === 'd') onOpenDiff({ number: prNumber, title: 'Seven' }) })
    return <Text>{`DETAIL ${prNumber}`}</Text>
  },
}))
vi.mock('../features/prs/diff.jsx', () => ({
  PRDiff: ({ prNumber, onViewComments }) => {
    useMountCount('diff')
    useInput((input) => { if (input === 'v') onViewComments() })
    return <Text>{`DIFF ${prNumber}`}</Text>
  },
}))

const press = async (input, key = {}) => { sendInput(input, key); await flush(20) }
const esc = () => press('', { escape: true })
const mount = () => {
  const view = renderWithProviders(<App repo="owner/repo" />)
  return view
}

describe('layers (#597 V3)', () => {
  beforeEach(() => { probe.mounts = {}; probe.ghCalls = 0 })
  afterEach(() => { cleanup(); disarmPrefix() })

  it('help, palette, AI and the repo picker open and close over the list: REMOUNT 0, WARM-GH 0, cursor kept', async () => {
    const view = mount()
    await flush(30)
    await press('j'); await press('j')
    expect(view.lastFrame()).toContain('cursor=2')
    const gh = probe.ghCalls

    await press('?')
    expect(view.lastFrame()).toContain('Keyboard Reference')
    expect(view.lastFrame()).not.toContain('LIST cursor')
    await press('?')
    expect(view.lastFrame()).toContain('cursor=2')

    await press(':')
    expect(view.lastFrame()).toContain('PALETTE OVERLAY')
    probe.palette.onClose(); await flush(20)
    expect(view.lastFrame()).toContain('cursor=2')

    await press(':')
    probe.palette.onNavigate({ pane: 'prs' }); await flush(20)
    await press(':')
    probe.palette.context.onSwitchRepo(); await flush(20)
    probe.palette.onClose(); await flush(20)
    expect(view.lastFrame()).toContain('REPO PICKER OVERLAY')
    probe.picker.onDone({ status: 'cancelled' }); await flush(20)
    expect(view.lastFrame()).toContain('cursor=2')

    sendInput('a', { ctrl: true }); await flush(20)
    expect(view.lastFrame()).toContain('AI OVERLAY')
    await esc()

    expect(probe.mounts.list).toBe(1)
    expect(probe.ghCalls).toBe(gh)
  })

  it('list -> detail -> back keeps the list mounted with its cursor (REMOUNT 0, WARM-GH 0)', async () => {
    const view = mount()
    await flush(30)
    await press('j'); await press('j'); await press('j')
    await press('o')
    expect(view.lastFrame()).toContain('DETAIL 7')
    expect(view.lastFrame()).not.toContain('LIST cursor')
    const gh = probe.ghCalls
    await esc()
    expect(view.lastFrame()).toContain('LIST cursor=3')
    expect(probe.mounts.list).toBe(1)
    expect(probe.ghCalls).toBe(gh)
    // detail again: a fresh mount of the detail only (it was dropped on the way back), the list is untouched
    await press('o')
    expect(probe.mounts.detail).toBe(2)
    expect(probe.mounts.list).toBe(1)
  })

  it('a covered view does not receive keys', async () => {
    const view = mount()
    await flush(30)
    await press('o')
    await press('j'); await press('j')
    await esc()
    expect(view.lastFrame()).toContain('cursor=0')
  })

  it('a covered view that updates its state draws no new frame', async () => {
    const view = mount()
    await flush(30)
    await press('o')
    // Ink drops a frame equal to the last one (ink.js lastOutput); the test renderer is in debug mode and
    // records every render, so assert on content: the hidden update changes no byte of the screen.
    const shown = view.lastFrame()
    const before = view.frames.length
    probe.bumpList()
    await flush(30)
    expect(new Set(view.frames.slice(before - 1)).size).toBe(1)
    expect(view.lastFrame()).toBe(shown)
    await esc()
    expect(view.lastFrame()).toContain('cursor=100')
  })

  it('a covered view does not overwrite the pane state of the view on screen, and restores its own on return', async () => {
    const view = mount()
    await flush(30)
    await press('o')
    await esc()
    expect(view.lastFrame()).toContain('LIST cursor=0')
    expect(view.lastFrame()).toContain('covered=false')
  })

  it('4-deep navigation evicts the oldest view; coming back rebuilds it (list -> detail -> diff -> comments)', async () => {
    const view = mount()
    await flush(30)
    await press('j')
    await press('o'); await press('d'); await press('v')
    expect(view.lastFrame()).toContain('COMMENTS 7')
    expect(probe.mounts).toMatchObject({ list: 1, detail: 1, diff: 1 })
    await esc() // comments -> diff (kept)
    expect(view.lastFrame()).toContain('DIFF 7')
    expect(probe.mounts.diff).toBe(1)
    await esc() // diff -> detail (kept)
    expect(view.lastFrame()).toContain('DETAIL 7')
    expect(probe.mounts.detail).toBe(1)
    await esc() // detail -> list: evicted when comments opened, so it mounts again
    expect(view.lastFrame()).toContain('LIST')
    expect(probe.mounts.list).toBe(2)
  })
})
