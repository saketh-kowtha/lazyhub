import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SettingsPane } from './features/settings/index.jsx'
import { renderWithProviders, flush, cleanup } from './test/test-helpers.jsx'

vi.mock('./config.js', () => ({
  loadConfig: () => ({ theme: { name: 'lazyhub-dark' }, mouse: false, aiReviewEnabled: true, panes: ['prs'], customPanes: {}, pr: { pageSize: 50 }, ai: {} }),
  saveConfig: vi.fn(),
  BUILTIN_PANES: ['prs', 'issues', 'branches', 'actions', 'notifications'],
}))

afterEach(cleanup)

// app.jsx:433 feeds readRawThemeCfg() (the [theme] table, i.e. { name }) into the legacy ThemeProvider.
describe('Settings > Theme row', () => {
  it('shows the theme name when config.theme is the TOML table { name }', async () => {
    const view = renderWithProviders(<SettingsPane onBack={() => {}} />, { legacyTheme: { name: 'lazyhub-dark' } })
    await flush(60)
    expect(view.lastFrame()).not.toContain('[object Object]')
    expect(view.lastFrame()).toMatch(/Theme:\s*lazyhub-dark/)
  })
})
