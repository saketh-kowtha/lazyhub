import { beforeEach, describe, expect, it, vi } from 'vitest'
import { runGh } from './core.js'
import { listPRFilesPage, getPRFilePatch } from './pr-files.js'
import { classifyGh } from '../daemon/protocol.js'

vi.mock('./core.js', () => ({ getRepo: (r) => r, runGh: vi.fn() }))

beforeEach(() => vi.clearAllMocks())

const gqlPage = (nodes, over = {}) => ({ data: { repository: { pullRequest: { files: {
  totalCount: nodes.length, pageInfo: { hasNextPage: false, endCursor: null }, nodes, ...over,
} } } } })

describe('listPRFilesPage (#509)', () => {
  it('lists changed files by cursor without any patch text', async () => {
    runGh.mockResolvedValue(gqlPage(
      [{ path: 'a.js', additions: 3, deletions: 1, changeType: 'MODIFIED' }, { path: 'b.js', additions: 0, deletions: 9, changeType: 'DELETED' }],
      { totalCount: 250, pageInfo: { hasNextPage: true, endCursor: 'c1' } },
    ))
    const page = await listPRFilesPage('o/r', 7, { after: 'c0' })
    const args = runGh.mock.calls[0][0]
    expect(args).toContain('after=c0')
    expect(args).toContain('number=7')
    expect(args.find(a => a.startsWith('query='))).not.toMatch(/patch/)
    expect(args).toContain('limit=100')
    expect(page).toEqual({
      files: [
        { path: 'a.js', additions: 3, deletions: 1, changeType: 'MODIFIED' },
        { path: 'b.js', additions: 0, deletions: 9, changeType: 'DELETED' },
      ],
      hasNextPage: true, endCursor: 'c1', totalCount: 250,
    })
  })

  it('drops malformed nodes and reports a missing PR', async () => {
    runGh.mockResolvedValue(gqlPage([null, { path: '' }, { path: 'ok.js', additions: 1, deletions: 0, changeType: 'ADDED' }]))
    expect((await listPRFilesPage('o/r', 7)).files.map(f => f.path)).toEqual(['ok.js'])
    runGh.mockResolvedValue({ data: { repository: { pullRequest: null } } })
    await expect(listPRFilesPage('o/r', 7)).rejects.toThrow(/not found/)
  })
})

describe('getPRFilePatch (#509)', () => {
  const rest = (obj) => JSON.stringify(obj)

  it('reads one file patch from the hinted page, selecting it by path', async () => {
    runGh.mockResolvedValue(rest({ filename: 'src/a "x".js', status: 'modified', additions: 1, deletions: 1, patch: '@@ -1 +1 @@\n-a\n+b' }))
    const res = await getPRFilePatch('o/r', 7, 'src/a "x".js', { indexHint: 130 })
    const args = runGh.mock.calls[0][0]
    expect(args[0]).toBe('api')
    expect(args.join(' ')).toContain('pulls/7/files?per_page=100&page=2')
    expect(args.find(a => a.includes('select(.filename =='))).toContain(JSON.stringify('src/a "x".js'))
    expect(res).toMatchObject({ status: 'ok', patch: '@@ -1 +1 @@\n-a\n+b', oldPath: null })
  })

  it('falls back to scanning every page when the hint missed, and gives up cleanly', async () => {
    runGh.mockResolvedValueOnce('').mockResolvedValueOnce(rest({ filename: 'z.js', status: 'added', additions: 2, deletions: 0, patch: '@@ -0,0 +1,2 @@\n+a\n+b' }))
    expect((await getPRFilePatch('o/r', 7, 'z.js', { indexHint: 0 })).status).toBe('ok')
    expect(runGh.mock.calls[1][0]).toContain('--paginate')
    runGh.mockReset()
    runGh.mockResolvedValue('')
    expect(await getPRFilePatch('o/r', 7, 'gone.js', { indexHint: 0 })).toMatchObject({ status: 'missing', patch: null })
  })

  it('says when GitHub did not render the patch, and keeps the rename source', async () => {
    runGh.mockResolvedValue(rest({ filename: 'big.json', status: 'modified', additions: 40000, deletions: 3 }))
    expect(await getPRFilePatch('o/r', 7, 'big.json')).toMatchObject({ status: 'omitted', patch: null })
    runGh.mockResolvedValue(rest({ filename: 'img.png', status: 'added', additions: 0, deletions: 0 }))
    expect(await getPRFilePatch('o/r', 7, 'img.png')).toMatchObject({ status: 'empty', patch: null })
    runGh.mockResolvedValue(rest({ filename: 'n.js', previous_filename: 'o.js', status: 'renamed', additions: 1, deletions: 1, patch: '@@ -1 +1 @@\n-a\n+b' }))
    expect(await getPRFilePatch('o/r', 7, 'n.js')).toMatchObject({ status: 'ok', oldPath: 'o.js' })
  })
})

describe('per-file diff calls are allowlisted reads (#509)', () => {
  it('classifies every gh call the module makes as a read', async () => {
    runGh.mockResolvedValue('')
    await getPRFilePatch('o/r', 7, 'a.js', { indexHint: 3 })
    await listPRFilesPage('o/r', 7).catch(() => {})
    for (const [args] of runGh.mock.calls) expect(classifyGh(args), args.join(' ').slice(0, 80)).toBe('read')
  })
})
