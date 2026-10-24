import { describe, expect, it, vi } from 'vitest'

vi.mock('../executor/activity.js', () => ({ resolveCurrentRepo: vi.fn() }))
vi.mock('../watch-only/index.js', () => ({ generateWatchOnlyReport: vi.fn() }))

const { runWatchOnly } = await import('./watch-only.js')
const { resolveCurrentRepo } = await import('../executor/activity.js')
const { generateWatchOnlyReport } = await import('../watch-only/index.js')

const sink = () => {
  const chunks = []
  return { write: s => { chunks.push(s) }, text: () => chunks.join('') }
}

describe('runWatchOnly failure handling', () => {
  it('exits 2 on invalid arguments without touching GitHub', async () => {
    const err = sink()
    expect(await runWatchOnly(['--limit', '0'], { out: sink(), err })).toBe(2)
    expect(err.text()).toContain('--limit must be an integer 1-100')
    expect(generateWatchOnlyReport).not.toHaveBeenCalled()
  })

  it('exits 1 and sanitizes control characters when GitHub is unavailable', async () => {
    generateWatchOnlyReport.mockRejectedValueOnce(new Error('gh failed\u001b[31m red'))
    const out = sink()
    const err = sink()
    expect(await runWatchOnly(['--repo', 'o/r'], { out, err })).toBe(1)
    expect(err.text()).toContain('gh failed')
    expect(err.text()).not.toContain('\u001b')
    expect(out.text()).toBe('')
  })

  it('exits 1 when the current repository cannot be resolved', async () => {
    resolveCurrentRepo.mockRejectedValueOnce(new Error('not a git repository'))
    const err = sink()
    expect(await runWatchOnly([], { out: sink(), err })).toBe(1)
    expect(err.text()).toContain('not a git repository')
  })
})
