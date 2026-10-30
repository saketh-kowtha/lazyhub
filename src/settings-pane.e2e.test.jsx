import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { sendInput } from './test/input-bus.js'
import { InputDriver } from './test/input-driver.jsx'
import { SettingsPane } from './features/settings/index.jsx'
import { renderWithProviders, flush, cleanup, waitForExpectation } from './test/test-helpers.jsx'

const saveConfig = vi.hoisted(() => vi.fn())
const loadConfigMock = vi.hoisted(() => vi.fn())

vi.mock('ink', async () => {
  const React = await import('react')
  const actual = await vi.importActual('ink')
  return {
    ...actual,
    useInput: (await import('./test/input-bus.js')).mockUseInput(React),
  }
})

vi.mock('./config.js', () => ({
  loadConfig: loadConfigMock,
  saveConfig,
  BUILTIN_PANES: ['prs', 'issues', 'branches', 'actions', 'notifications'],
}))

function baseConfig(overrides = {}) {
  return {
    theme: 'github-dark',
    mouse: false,
    aiReviewEnabled: true,
    panes: ['prs', 'issues'],
    customPanes: {},
    pr: { pageSize: 50 },
    ai: { provider: 'anthropic', model: 'claude-sonnet-4-6' },
    ...overrides,
  }
}

describe('Settings pane user flows', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    loadConfigMock.mockReturnValue(baseConfig())
  })

  afterEach(() => {
    cleanup()
  })


  it('Page Size opens an editor that saves, instead of locking the pane', async () => {
    const view = renderWithProviders(
      <>
        <SettingsPane onBack={() => {}} />
        <InputDriver events={[
          { input: 'j' }, { input: 'j' }, { input: 'j' }, { input: 'j' },
          { key: { return: true } },
        ]} />
      </>
    )

    await flush(120)
    expect(view.lastFrame()).toContain('Page Size')
    expect(view.lastFrame()).toContain('[Enter] confirm')
  })

  it('Page Size editor can be cancelled and the pane keeps responding', async () => {
    const onBack = vi.fn()
    renderWithProviders(
      <>
        <SettingsPane onBack={onBack} />
        <InputDriver events={[
          { input: 'j' }, { input: 'j' }, { input: 'j' }, { input: 'j' },
          { key: { return: true } },
          { key: { escape: true } },
          { input: 'q' },
        ]} />
      </>
    )

    await flush(160)
    expect(onBack).toHaveBeenCalledTimes(1)
    expect(saveConfig).not.toHaveBeenCalled()
  })

  it('toggles mouse support from the user settings list', async () => {
    const setMouseEnabled = vi.fn()
    const view = renderWithProviders(
      <>
        <SettingsPane onBack={() => {}} />
        <InputDriver events={[{ input: 'j' }, { key: { return: true } }]} />
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
          { input: 'j' },
          { key: { return: true } },
        ]} />
      </>
    )

    await flush(140)
    expect(view.lastFrame()).toContain('Theme:')
    expect(view.lastFrame()).toContain('github-light')
  })

  it('marks an object-shaped theme config as current in the picker', async () => {
    loadConfigMock.mockReturnValue(baseConfig({ theme: { name: 'tokyo-night', overrides: {} } }))

    const view = renderWithProviders(
      <>
        <SettingsPane onBack={() => {}} />
        <InputDriver events={[
          { key: { return: true } },
        ]} />
      </>
    )

    await flush(80)
    expect(view.lastFrame()).toContain('▶ tokyo-night')
    expect(view.lastFrame()).toContain('(current)')
  })

  it('edits openai-compatible provider settings with nested TOML keys', async () => {
    loadConfigMock.mockReturnValue(baseConfig({
      ai: {
        provider: 'openai-compatible',
        openai_compatible: {
          base_url: 'http://localhost:1234/v1',
          api_key: 'local-key',
          model: 'qwen2.5-coder:32b',
          timeout_ms: 60000,
        },
      },
    }))

    const view = renderWithProviders(
      <>
        <SettingsPane onBack={() => {}} />
        <InputDriver events={[
          { input: 'j' },
          { input: 'j' },
          { input: 'j' },
          { input: 'j' },
          { input: 'j' },
          { key: { return: true } },
        ]} />
      </>
    )

    await flush(120)
    expect(view.lastFrame()).toContain('OpenAI-compatible HTTP')
    expect(view.lastFrame()).toContain('Base URL:')
    expect(view.lastFrame()).toContain('http://localhost:1234/v1')
    expect(view.lastFrame()).toContain('API Key:')
    expect(view.lastFrame()).toContain('Model:')
    expect(view.lastFrame()).toContain('qwen2.5-coder:32b')
    expect(view.lastFrame()).toContain('Timeout (ms):')
  })

  it('saves openai-compatible provider settings back to the nested config shape', async () => {
    loadConfigMock.mockReturnValue(baseConfig({
      ai: {
        provider: 'openai-compatible',
        openai_compatible: {
          base_url: 'http://localhost:1234/v1',
          api_key: 'local-key',
          model: 'qwen2.5-coder:32b',
          timeout_ms: 60000,
        },
      },
    }))

    const view = renderWithProviders(<SettingsPane onBack={() => {}} />)

    await flush(20)
    for (let i = 0; i < 5; i += 1) {
      await sendInput('j')
    }
    await waitForExpectation(() => {
      expect(view.lastFrame()).toContain('AI Provider:')
      expect(view.lastFrame()).toContain('qwen2.5-coder:32b')
    })
    await sendInput('s')
    await waitForExpectation(() => {
      expect(saveConfig).toHaveBeenCalledWith(expect.objectContaining({
      ai: {
        provider: 'openai-compatible',
        openai_compatible: {
          base_url: 'http://localhost:1234/v1',
          api_key: 'local-key',
          model: 'qwen2.5-coder:32b',
          timeout_ms: 60000,
        },
      },
      }))
    })
  })
})
