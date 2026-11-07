/**
 * list.test.js — PR list helpers.
 */

import { describe, it, expect } from 'vitest'
import { canToggleAutoMergeFromList } from './list.jsx'

describe('canToggleAutoMergeFromList', () => {
  it('allows focused open non-draft PRs to claim the M key', () => {
    expect(canToggleAutoMergeFromList({ state: 'OPEN', isDraft: false })).toBe(true)
  })

  it('leaves M available for the merged filter outside eligible PRs', () => {
    expect(canToggleAutoMergeFromList({ state: 'OPEN', isDraft: true })).toBe(false)
    expect(canToggleAutoMergeFromList({ state: 'MERGED', isDraft: false })).toBe(false)
    expect(canToggleAutoMergeFromList(null)).toBe(false)
  })
})
