import { beforeEach, describe, expect, it, vi } from 'vitest'
import { runGh } from './core.js'
import { getPRPatches, getPRWithFiles, listOpenPRsWithFiles } from './collisions.js'
import { classifyGh } from '../daemon/protocol.js'

vi.mock('./core.js', () => ({ getRepo: (r) => r, runGh: vi.fn() }))

beforeEach(() => vi.clearAllMocks())

const node = (number, extra = {}) => ({
  number, title: `t${number}`, isDraft: false, state: 'OPEN', baseRefName: 'main', additions: 1, deletions: 2,
  author: { login: 'a' }, files: { totalCount: 1, pageInfo: { hasNextPage: false, endCursor: null }, nodes: [{ path: 'a.js', additions: 1, deletions: 2, changeType: 'MODIFIED' }] }, ...extra,
})

describe('collision radar executor (#360)', () => {
  it('pages open PRs by cursor with the file list inline and reports the total', async () => {
    runGh.mockResolvedValue({ data: { repository: { pullRequests: { totalCount: 120, pageInfo: { hasNextPage: true, endCursor: 'c1' }, nodes: [node(1), null, node(2, { files: { totalCount: 250, pageInfo: { hasNextPage: true, endCursor: 'f1' }, nodes: [] } })] } } } })
    const page = await listOpenPRsWithFiles('o/r', { after: 'c0' })
    const args = runGh.mock.calls[0][0]
    expect(args).toContain('after=c0')
    expect(args).toContain('limit=50')
    expect(args.find(a => a.startsWith('query='))).not.toMatch(/patch/)
    expect(page).toMatchObject({ totalCount: 120, hasNextPage: true, endCursor: 'c1' })
    expect(page.prs.map(p => p.number)).toEqual([1, 2])
    expect(page.prs[1]).toMatchObject({ filesTotal: 250, filesCursor: 'f1' })
  })

  it('fetches one PR by number and fails clearly when it is missing', async () => {
    runGh.mockResolvedValue({ data: { repository: { pullRequest: node(9, { state: 'MERGED' }) } } })
    expect(await getPRWithFiles('o/r', 9)).toMatchObject({ number: 9, state: 'MERGED' })
    expect(runGh.mock.calls[0][0]).toContain('number=9')
    runGh.mockResolvedValue({ data: { repository: { pullRequest: null } } })
    await expect(getPRWithFiles('o/r', 9)).rejects.toThrow(/not found/)
  })

  it('walks REST pages to the end and names only the wanted paths to jq', async () => {
    const full = Array.from({ length: 100 }, (_, i) => ({ path: `f${i}`, status: 'modified', additions: 1, deletions: 0, patch: null }))
    runGh.mockResolvedValueOnce(full).mockResolvedValueOnce([{ path: 'a.js', oldPath: 'b.js', status: 'renamed', additions: 1, deletions: 1, patch: '@@ -1 +1 @@\n-a\n+b' }])
    const res = await getPRPatches('o/r', 7, ['a.js', 'we"ird.js'])
    expect(runGh).toHaveBeenCalledTimes(2)
    expect(runGh.mock.calls[1][0][1]).toContain('page=2')
    expect(runGh.mock.calls[0][0].find(a => a.startsWith('[.[]'))).toContain(JSON.stringify('we"ird.js'))
    expect(res.files).toHaveLength(101)
    expect(res.files[100]).toMatchObject({ path: 'a.js', oldPath: 'b.js', patch: '@@ -1 +1 @@\n-a\n+b' })
    expect(res.truncated).toBe(false)
  })

  it('reports truncation when the page ceiling is hit', async () => {
    runGh.mockResolvedValue(Array.from({ length: 100 }, (_, i) => ({ path: `f${i}` })))
    const res = await getPRPatches('o/r', 7, [])
    expect(runGh).toHaveBeenCalledTimes(10)
    expect(res.truncated).toBe(true)
  })

  it('every call is an allowlisted read', async () => {
    runGh.mockResolvedValue([])
    await getPRPatches('o/r', 7, ['a.js']).catch(() => {})
    runGh.mockResolvedValue({ data: { repository: { pullRequests: { nodes: [], pageInfo: {} } } } })
    await listOpenPRsWithFiles('o/r')
    runGh.mockResolvedValue({ data: { repository: { pullRequest: node(1) } } })
    await getPRWithFiles('o/r', 1)
    for (const [args] of runGh.mock.calls) expect(classifyGh(args), args.join(' ').slice(0, 80)).toBe('read')
  })
})
