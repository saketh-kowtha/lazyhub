/**
 * config.savedRepo.test.js — a saved [defaults].repo is only used under the host it was saved on (#290).
 * The loader is mocked so nothing reads or writes the real ~/.config/lazyhub.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const loaded = vi.hoisted(() => ({ defaults: {} }))
vi.mock('./config/loader.js', () => ({
  loadConfig: () => loaded,
  USER_CONFIG_PATH: '/nonexistent/lazyhub.toml',
}))

import { loadSavedRepo } from './config.js'

let prevHost
beforeEach(() => { prevHost = process.env.GH_HOST; delete process.env.GH_HOST })
afterEach(() => {
  if (prevHost === undefined) delete process.env.GH_HOST
  else process.env.GH_HOST = prevHost
})

describe('loadSavedRepo', () => {
  it('returns null when nothing is saved', () => {
    loaded.defaults = { repo: '', repo_host: '' }
    expect(loadSavedRepo()).toBeNull()
  })

  it('returns the repo when it was saved under the active host', () => {
    loaded.defaults = { repo: 'acme/platform', repo_host: 'github.com' }
    expect(loadSavedRepo()).toBe('acme/platform')
    process.env.GH_HOST = 'GHE.example.com'
    loaded.defaults = { repo: 'acme/platform', repo_host: 'ghe.example.com' }
    expect(loadSavedRepo()).toBe('acme/platform')
  })

  it('ignores a repo saved under a different host', () => {
    process.env.GH_HOST = 'ghe.example.com'
    loaded.defaults = { repo: 'acme/platform', repo_host: 'github.com' }
    expect(loadSavedRepo()).toBeNull()
  })

  it('accepts a hand-written repo with no recorded host', () => {
    process.env.GH_HOST = 'ghe.example.com'
    loaded.defaults = { repo: 'acme/platform', repo_host: '' }
    expect(loadSavedRepo()).toBe('acme/platform')
  })
})
