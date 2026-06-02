/**
 * features/tabs/filter-to-gh.test.js — TOML filter translation tests.
 */

import { describe, expect, it } from 'vitest'
import { filterToGh } from './filter-to-gh.js'

describe('filterToGh', () => {
  it('keeps supported declarative filters structured', () => {
    const result = filterToGh({ reviewer: '@me', state: 'open', is_draft: false }, { limit: 10 })

    expect(result.filter).toEqual({ reviewer: '@me', state: 'open', isDraft: false, limit: 10 })
    expect(result.warnings).toEqual([])
  })

  it('warns on unknown filter keys', () => {
    const result = filterToGh({ wild: 'nope' })

    expect(result.filter).toEqual({ limit: 25 })
    expect(result.warnings[0]).toContain('unsupported filter key')
  })
})
