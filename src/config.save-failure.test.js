/**
 * config.save-failure.test.js — saving config never throws into key handlers (#435).
 * The TOML writer is mocked to fail, so nothing reads or writes the real ~/.config/lazyhub.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const w = vi.hoisted(() => ({ writeConfig: vi.fn(), writeState: vi.fn() }))
vi.mock('./config/writer.js', async () => {
  const actual = await vi.importActual('./config/writer.js')
  return { ...actual, writeConfig: w.writeConfig, writeState: w.writeState }
})

import { saveConfig, saveDefaultRepo } from './config.js'
import { setConfigWriteNotifier } from './config/writer.js'

let seen
beforeEach(() => {
  w.writeConfig.mockReset()
  setConfigWriteNotifier(() => {}) // drain anything queued by other tests
  seen = []
  setConfigWriteNotifier(m => seen.push(m))
})

describe('saveConfig / saveDefaultRepo failure paths', () => {
  it('saveConfig reports the failure instead of throwing', () => {
    w.writeConfig.mockImplementation(() => { throw new Error('lazyhub.toml is not valid TOML; nothing was written') })
    expect(() => saveConfig({ mouse: true })).not.toThrow()
    expect(seen).toEqual(['Could not save settings: lazyhub.toml is not valid TOML; nothing was written'])
  })

  it('saveDefaultRepo reports the failure instead of throwing', () => {
    w.writeConfig.mockImplementation(() => { throw new Error('EACCES: permission denied') })
    expect(() => saveDefaultRepo('acme/platform')).not.toThrow()
    expect(seen).toEqual(['Could not save settings: EACCES: permission denied'])
  })

  it('still writes on success and reports nothing', () => {
    w.writeConfig.mockReturnValue({})
    saveDefaultRepo('acme/platform')
    expect(w.writeConfig).toHaveBeenCalledWith(expect.objectContaining({ defaults: expect.objectContaining({ repo: 'acme/platform' }) }))
    expect(seen).toEqual([])
  })
})
