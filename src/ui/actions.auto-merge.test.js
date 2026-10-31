// The command palette really offers auto-merge (#448): it has no default key, so the palette
// and the merge picker are the only ways in, and the description and hint claim it is there.
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../executor.js', async (original) => ({
  ...await original(),
  enableAutoMerge: vi.fn(async () => undefined),
  disableAutoMerge: vi.fn(async () => undefined),
  getRepoInfo: vi.fn(async () => ({ squashMergeAllowed: true })),
}))

const { buildActions } = await import('./actions.js')
const { enableAutoMerge, disableAutoMerge, getRepoInfo } = await import('../executor.js')

const action = () => buildActions({ onNavigate: vi.fn(), onTheme: vi.fn(), onClose: vi.fn(), onQuit: vi.fn() })
  .find(a => a.id === 'pr.auto-merge')

beforeEach(() => vi.clearAllMocks())

describe('palette auto-merge action', () => {
  it('exists in PR list and detail and is a confirmed write', () => {
    const a = action()
    expect(a).toBeDefined()
    expect(a.write).toBe(true)
    expect(a.context).toEqual(['pr-list', 'pr-detail'])
  })

  it('enables auto-merge with the repo preferred method when it is off', async () => {
    const a = action()
    expect(a.confirmText({ selectedItem: { number: 4 } })).toBe('Enable auto-merge on PR #4?')
    await a.run({ repo: 'o/r', selectedItem: { number: 4 }, _confirmed: true })
    expect(getRepoInfo).toHaveBeenCalledWith('o/r')
    expect(enableAutoMerge).toHaveBeenCalledWith('o/r', 4, 'squash')
    expect(disableAutoMerge).not.toHaveBeenCalled()
  })

  it('disables auto-merge when it is on', async () => {
    const a = action()
    const ctx = { repo: 'o/r', selectedItem: { number: 4, autoMergeRequest: { enabledAt: 'x' } } }
    expect(a.confirmText(ctx)).toBe('Disable auto-merge on PR #4?')
    await a.run({ ...ctx, _confirmed: true })
    expect(disableAutoMerge).toHaveBeenCalledWith('o/r', 4)
    expect(enableAutoMerge).not.toHaveBeenCalled()
  })
})

describe('palette auto-merge action guard', () => {
  it('refuses to run without confirmation', () => {
    expect(() => action().run({ repo: 'o/r', selectedItem: { number: 4 } })).toThrow(/needs confirmation/)
    expect(enableAutoMerge).not.toHaveBeenCalled()
  })
})
