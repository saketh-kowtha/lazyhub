/**
 * config/keymap.test.js — TOML keymap resolution tests.
 */

import { describe, expect, it } from 'vitest'
import { buildEffectiveActionKeys, createKeymap, eventToTokens, normalizeKeyToken } from './keymap.js'

describe('normalizeKeyToken', () => {
  it('normalizes nvim-style special keys and modifiers', () => {
    expect(normalizeKeyToken('<space>')).toBe('Space')
    expect(normalizeKeyToken('<C-x>')).toBe('Ctrl+X')
    expect(normalizeKeyToken('enter')).toBe('Enter')
  })
})

describe('eventToTokens', () => {
  it('maps Ink key events to comparable tokens', () => {
    expect([...eventToTokens('x', { ctrl: true })]).toContain('Ctrl+X')
    expect([...eventToTokens('', { return: true })]).toContain('Enter')
    expect([...eventToTokens(' ', {})]).toContain('Space')
  })
})

describe('createKeymap', () => {
  const config = {
    actions: {
      'cursor.down': { keys: ['j'] },
      'pr.merge': { keys: ['m'] },
    },
    keymaps: {
      'pr-list': {
        J: 'cursor.down',
        unbind: { m: true },
      },
    },
  }

  it('resolves aliases from [keymaps.<scope>]', () => {
    expect(createKeymap('pr-list', config).resolve('J', {})).toBe('cursor.down')
  })

  it('applies unbinds to effective action keys', () => {
    expect(buildEffectiveActionKeys(config)['cursor.down']).toEqual(['j', 'J'])
    expect(buildEffectiveActionKeys(config)['pr.merge']).toEqual([])
  })
})
