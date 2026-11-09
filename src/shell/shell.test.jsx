import { describe, it, expect, afterEach, vi } from 'vitest'
import React from 'react'
import { Text } from 'ink'
import { cleanup } from 'ink-testing-library'
import { renderWithProviders } from '../test/test-helpers.jsx'
import { Shell, LeaderHint } from './Shell.jsx'
import { scopeIndicator } from './scopeIndicator.js'
import { useChords } from './useChords.js'
import { getArmedPrefix, disarmPrefix } from '../config/keymap.js'

afterEach(() => { cleanup(); disarmPrefix(); vi.useRealTimers() })

describe('scopeIndicator', () => {
  it('is empty for the resting scopes and upper-cased otherwise', () => {
    for (const s of ['global', 'pane', 'list']) expect(scopeIndicator(s)).toBeNull()
    expect(scopeIndicator('dialog')).toBe('DIALOG')
    expect(scopeIndicator('input')).toBe('INPUT')
  })
})

describe('<Shell>', () => {
  const base = { appCtx: {}, rows: 12, compactFooter: false }

  it('draws body, status bar, footer and toasts once, in one frame', () => {
    const view = renderWithProviders(
      <Shell {...base} overflow="hidden" bodyProps={{ overflow: 'hidden' }}
        status={{ repo: 'acme/app', pane: 'prs', mode: 'NORMAL' }}
        footer={[{ key: 'Esc', label: 'back' }]}
        toasts={[{ id: 1, message: 'hello toast', variant: 'info' }]}>
        <Text>BODY</Text>
      </Shell>
    )
    const frame = view.lastFrame()
    expect(frame).toContain('BODY')
    expect(frame).toContain('acme/app')
    expect(frame).toContain('back')
    expect(frame).toContain('hello toast')
  })

  it('draws no status bar or footer when a view supplies none, and no body box when bodyProps is null', () => {
    const view = renderWithProviders(<Shell {...base} bodyProps={null}><Text>ONLY</Text></Shell>)
    const frame = view.lastFrame()
    expect(frame).toContain('ONLY')
    expect(frame).not.toContain('NORMAL')
  })

  it('shows the leader hint above the status bar', () => {
    const view = renderWithProviders(
      <Shell {...base} leaderHint={<LeaderHint text="t theme" />} status={{ repo: 'a/b', pane: 'prs', mode: 'NORMAL' }}>
        <Text>BODY</Text>
      </Shell>
    )
    expect(view.lastFrame()).toContain('<Space>')
    expect(view.lastFrame()).toContain('t theme')
  })
})

describe('useChords', () => {
  function Probe({ onApi }) {
    const api = useChords()
    onApi(api)
    return <Text>{api.leaderActive ? 'LEADER' : 'idle'}|{api.prefixPopup ? api.prefixPopup.prefix : 'none'}</Text>
  }

  it('closes the leader and prefix windows by themselves after 1.5s and disarms the prefix', async () => {
    vi.useFakeTimers()
    let api
    const view = renderWithProviders(<Probe onApi={(a) => { api = a }} />)
    api.armLeader()
    api.armPrefixChord('g', [{ key: 'p', global: true }])
    await vi.advanceTimersByTimeAsync(10)
    expect(view.lastFrame()).toContain('LEADER|g')
    expect(getArmedPrefix()).toBeTruthy()
    await vi.advanceTimersByTimeAsync(1600)
    expect(view.lastFrame()).toContain('idle|none')
    expect(getArmedPrefix()).toBeFalsy()
  })

  it('clearLeader and clearPrefix close the windows immediately', async () => {
    vi.useFakeTimers()
    let api
    const view = renderWithProviders(<Probe onApi={(a) => { api = a }} />)
    api.armLeader()
    api.armPrefixChord('g', [{ key: 'p', global: true }])
    await vi.advanceTimersByTimeAsync(10)
    api.clearLeader()
    api.clearPrefix()
    await vi.advanceTimersByTimeAsync(10)
    expect(view.lastFrame()).toContain('idle|none')
    expect(getArmedPrefix()).toBeFalsy()
  })

  it('disarms the prefix when unmounted (a repository switch remounts App)', async () => {
    let api
    const view = renderWithProviders(<Probe onApi={(a) => { api = a }} />)
    api.armPrefixChord('g', [{ key: 'p', global: true }])
    expect(getArmedPrefix()).toBeTruthy()
    view.unmount()
    await new Promise(r => setTimeout(r, 20))
    expect(getArmedPrefix()).toBeFalsy()
  })
})
