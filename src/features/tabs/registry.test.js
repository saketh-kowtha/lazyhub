/**
 * features/tabs/registry.test.js — TOML tab registry tests.
 */

import { describe, expect, it } from 'vitest'
import { getTabs } from './registry.js'

describe('getTabs', () => {
  it('sorts tabs and rejects built-in id collisions', () => {
    const result = getTabs({
      tabs: [
        { id: 'prs', label: 'Bad' },
        { id: 'team', order: 2 },
        { id: 'focus', order: 1 },
      ],
    })

    expect(result.tabs.map(t => t.id)).toEqual(['focus', 'team'])
    expect(result.warnings[0]).toContain('collides')
  })
})
