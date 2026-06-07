import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { __sendInput } from 'ink'
import { SettingsPane } from './features/settings/index.jsx'
import { renderWithProviders, flush, cleanup } from './test/test-helpers.jsx'

const saveConfig = vi.hoisted(() => vi.fn())
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
    __sendInput: (input, key = {}) => {
      for (const handler of [...inputHandlers]) handler(input, key)
    },
  }
})

vi.mock('./config.js', () => ({
  loadConfig: () => ({
    theme: 'github-dark',
    mouse: false,
    aiReviewEnabled: true,
    panes: ['prs', 'issues'],
    customPanes: {},
    pr: { pageSize: 50 },
    ai: { provider: 'anthropic', model: 'claude-sonnet-4-6' },
  }),
  saveConfig,
  BUILTIN_PANES: ['prs', 'issues', 'branches', 'actions', 'notifications'],
}))

describe('Settings pane user flows', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    cleanup()
  })

  function InputDriver({ events }) {
    React.useEffect(() => {
      let alive = true
      ;(async () => {
        for (const event of events) {
          if (!alive) return
          if (event.wait) {
            await new Promise(resolve => setTimeout(resolve, event.wait))
            continue
          }
          __sendInput(event.input || '', event.key || {})
          await new Promise(resolve => setTimeout(resolve, 0))
        }
      })()
      return () => { alive = false }
    }, [events])

    return null
  }

  it('toggles mouse support from the user settings list', async () => {
    const setMouseEnabled = vi.fn()
    const view = renderWithProviders(
      <>
        <SettingsPane onBack={() => {}} />
        <InputDriver events={[{ input: 'j' }, { wait: 20 }, { key: { return: true } }]} />
      </>,
      { appContext: { setMouseEnabled } }
    )

    await flush(60)

    expect(view.lastFrame()).toContain('Mouse Support:')
    expect(view.lastFrame()).toContain('Enabled')
  })

  it('shows the current theme and persists a theme change', async () => {
    const view = renderWithProviders(
      <>
        <SettingsPane onBack={() => {}} />
        <InputDriver events={[
          { key: { return: true } },
          { wait: 20 },
          { input: 'j' },
          { wait: 20 },
          { key: { return: true } },
          { wait: 40 },
        ]} />
      </>
    )

    await flush(140)
    expect(view.lastFrame()).toContain('Theme:')
    expect(view.lastFrame()).toContain('github-light')
  })
})
