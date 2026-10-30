/**
 * settings-persist.e2e.test.jsx — Settings writes only the setting the user changed (B-91).
 * The loader path is redirected to a temp file so the real ~/.config/lazyhub is never touched.
 */

import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { InputDriver } from './test/input-driver.jsx'
import { SettingsPane } from './features/settings/index.jsx'
import { saveConfig } from './config.js'
import { renderWithProviders, flush, cleanup, waitForExpectation } from './test/test-helpers.jsx'

const paths = vi.hoisted(() => ({ file: '' }))

vi.mock('ink', async () => {
  const React = await import('react')
  const actual = await vi.importActual('ink')
  return { ...actual, useInput: (await import('./test/input-bus.js')).mockUseInput(React) }
})

vi.mock('./config/loader.js', async () => {
  const actual = await vi.importActual('./config/loader.js')
  return {
    ...actual,
    get USER_CONFIG_PATH() { return paths.file },
    loadConfig: (opts = {}) => actual.loadConfig({ ...opts, configPath: paths.file }),
  }
})

const ENV = ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY']
const SEED = '# user config\n[app]\nmouse = false\n\n[ai]\nprovider = "anthropic"\n\n[features.prs]\npage_size = 25\n'
let dir
let saved

beforeEach(() => {
  saved = Object.fromEntries(ENV.map(k => [k, process.env[k]]))
  process.env.ANTHROPIC_API_KEY = 'env-anthropic-value'
  process.env.OPENAI_API_KEY = 'env-openai-value'
  dir = mkdtempSync(join(tmpdir(), 'lazyhub-settings-'))
  paths.file = join(dir, 'lazyhub.toml')
  writeFileSync(paths.file, SEED)
})

afterEach(() => {
  cleanup()
  for (const k of ENV) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k] }
  rmSync(dir, { recursive: true, force: true })
})

describe('Settings persistence', () => {
  it('toggling Mouse writes only app.mouse, not environment-resolved values', async () => {
    renderWithProviders(
      <>
        <SettingsPane onBack={() => {}} />
        <InputDriver events={[{ input: 'j' }, { key: { return: true } }]} />
      </>
    )
    await flush(60)
    await waitForExpectation(() => expect(readFileSync(paths.file, 'utf8')).toContain('mouse = true'))
    const text = readFileSync(paths.file, 'utf8')
    expect(text).not.toContain('api_key')
    expect(text).not.toContain('env-')
    expect(text.replace('mouse = true', 'mouse = false')).toBe(SEED)
  })

  it('saveConfig never writes an API key that only came from the environment', () => {
    saveConfig({ ai: { provider: 'anthropic', anthropicApiKey: 'env-anthropic-value', openaiApiKey: 'env-openai-value' } })
    expect(readFileSync(paths.file, 'utf8')).not.toContain('api_key')
  })

  it('saveConfig still writes a key the user typed', () => {
    saveConfig({ ai: { provider: 'anthropic', anthropicApiKey: 'typed-value' } })
    expect(readFileSync(paths.file, 'utf8')).toContain('anthropic_api_key = "typed-value"')
  })
})
