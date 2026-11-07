import { describe, expect, it } from 'vitest'
import { MERGE_OPTIONS, preferredMergeIndex, rememberMergeMethod, rememberedMergeIndex } from './merge-methods.js'

// HOME is a throwaway directory for every test worker (src/test/setup-hermetic.js).
describe('remembered merge method (#314)', () => {
  it('defaults to squash, then to the method last used in that repository', () => {
    expect(preferredMergeIndex(MERGE_OPTIONS, 'acme/one')).toBe(1)
    rememberMergeMethod('acme/one', 'rebase')
    expect(preferredMergeIndex(MERGE_OPTIONS, 'acme/one')).toBe(2)
    expect(rememberedMergeIndex(MERGE_OPTIONS, 'acme/one')).toBe(2)
  })

  it('keeps choices per repository', () => {
    rememberMergeMethod('acme/two', 'merge')
    expect(preferredMergeIndex(MERGE_OPTIONS, 'acme/two')).toBe(0)
    expect(preferredMergeIndex(MERGE_OPTIONS, 'acme/three')).toBe(1)
  })

  it('never remembers bypass or auto-merge, and ignores a method the repository no longer allows', () => {
    rememberMergeMethod('acme/four', 'admin-squash')
    rememberMergeMethod('acme/four', 'auto-merge')
    expect(rememberedMergeIndex(MERGE_OPTIONS, 'acme/four')).toBe(-1)
    rememberMergeMethod('acme/five', 'rebase')
    const squashOnly = MERGE_OPTIONS.filter(o => o.value === 'squash')
    expect(preferredMergeIndex(squashOnly, 'acme/five')).toBe(0)
  })
})
