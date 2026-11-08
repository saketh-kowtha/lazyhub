import { beforeEach, describe, expect, it, vi } from 'vitest'
import { runGh } from './core.js'
import { getClaimsContext, getIssuesForClaims, listPRFilesWithPatches, CLAIMS_FILE_LIMIT } from './claims.js'
import { classifyGh } from '../daemon/protocol.js'

vi.mock('./core.js', () => ({ getRepo: r => r, runGh: vi.fn() }))
beforeEach(() => vi.clearAllMocks())

describe('claims reads', () => {
  it('pages the file list to the end, read-only, and flags the GitHub cap', async () => {
    runGh.mockResolvedValue('{"path":"a.js","status":"modified","additions":1,"deletions":0,"patch":"@@","patchTruncated":false}\nnot json\n')
    const r = await listPRFilesWithPatches('o/r', 7)
    const args = runGh.mock.calls[0][0]
    expect(args).toContain('--paginate')
    expect(args[1]).toContain('per_page=100')
    expect(classifyGh(args)).toBe('read')
    expect(r).toEqual({ files: [{ path: 'a.js', status: 'modified', additions: 1, deletions: 0, patch: '@@', patchTruncated: false }], truncated: false })
    runGh.mockResolvedValue(Array.from({ length: CLAIMS_FILE_LIMIT }, (_, i) => JSON.stringify({ path: `f${i}`, patch: '' })).join('\n'))
    expect((await listPRFilesWithPatches('o/r', 7)).truncated).toBe(true)
  })

  it('maps a missing issue to null and a failed lookup to absent', async () => {
    runGh.mockImplementation(async (args) => {
      const n = args[2]
      if (n === '1') return { number: 1, state: 'OPEN', body: 'b' }
      if (n === '2') throw new Error('Could not resolve to an issue with the number of 2.')
      throw new Error('timeout')
    })
    const out = await getIssuesForClaims('o/r', [1, 2, 3])
    expect(out).toEqual({ 1: { number: 1, state: 'OPEN', body: 'b' }, 2: null })
    expect('3' in out).toBe(false)
  })

  it('gathers files, closing links and issues together', async () => {
    runGh.mockImplementation(async (args) => {
      if (args[0] === 'api') return '{"path":"a.js","patch":""}'
      if (args[0] === 'pr') return { closingIssuesReferences: [{ number: 4 }, { number: 'x' }] }
      return { number: 4, state: 'OPEN', body: '' }
    })
    const r = await getClaimsContext('o/r', 9, [4])
    expect(r.closing).toEqual([4])
    expect(r.files).toHaveLength(1)
    expect(r.issues[4]).toMatchObject({ number: 4 })
  })
})
