import { describe, expect, it, vi, beforeEach } from 'vitest'
import { runGh } from './core.js'
import { listIssuesPage, listIssues } from './issues.js'

vi.mock('./core.js', () => ({ getRepo: (r) => r, runGh: vi.fn() }))

describe('listIssuesPage (#506)', () => {
  beforeEach(() => vi.clearAllMocks())

  it('passes the cursor and filters, and returns items with paging info', async () => {
    runGh.mockResolvedValue({ data: { search: {
      issueCount: 7,
      pageInfo: { hasNextPage: true, endCursor: 'c2' },
      nodes: [{ __typename: 'Issue', number: 3, title: 't', state: 'OPEN', labels: { nodes: [{ name: 'bug' }] }, assignees: { nodes: [] }, comments: { totalCount: 4 } }],
    } } })
    const page = await listIssuesPage('o/r', { state: 'closed', label: 'bug', limit: 50, after: 'c1' })
    const args = runGh.mock.calls[0][0]
    expect(args).toContain('after=c1')
    expect(args.find(a => a.startsWith('searchQuery='))).toBe('searchQuery=repo:o/r is:issue sort:created-desc state:closed label:"bug"')
    expect(args).toContain('limit=50')
    expect(page).toMatchObject({ hasNextPage: true, endCursor: 'c2', totalCount: 7 })
    expect(page.items[0]).toMatchObject({ number: 3, labels: [{ name: 'bug' }], commentCount: 4 })
  })

  it('sorts oldest first on the server when asked', async () => {
    runGh.mockResolvedValue({ data: { search: { issueCount: 0, pageInfo: {}, nodes: [] } } })
    await listIssuesPage('o/r', { sort: 'oldest' })
    expect(runGh.mock.calls[0][0].find(a => a.startsWith('searchQuery='))).toContain('sort:created-asc')
  })

  it('rejects author/assignee values that would add search qualifiers', async () => {
    runGh.mockResolvedValue({ data: { search: { issueCount: 0, pageInfo: {}, nodes: [] } } })
    await expect(listIssuesPage('o/r', { author: 'x state:closed' })).rejects.toThrow(/Invalid login/)
    await expect(listIssuesPage('o/r', { assignee: 'a"b' })).rejects.toThrow(/Invalid login/)
    expect(runGh).not.toHaveBeenCalled()
    await listIssuesPage('o/r', { author: '@me', assignee: 'dependabot[bot]' })
    expect(runGh.mock.calls[0][0].find(a => a.startsWith('searchQuery='))).toContain('author:@me assignee:dependabot[bot]')
  })

  it('omits after on the first page and reports the end', async () => {
    runGh.mockResolvedValue({ data: { search: { issueCount: 0, pageInfo: { hasNextPage: false, endCursor: null }, nodes: [] } } })
    const page = await listIssuesPage('o/r')
    expect(runGh.mock.calls[0][0].some(a => String(a).startsWith('after='))).toBe(false)
    expect(page).toEqual({ items: [], hasNextPage: false, endCursor: null, totalCount: 0 })
  })
})

describe('listIssues (#506)', () => {
  it('no longer requests the full comments array', async () => {
    runGh.mockResolvedValue([])
    await listIssues('o/r')
    const args = runGh.mock.calls.at(-1)[0]
    expect(args[args.indexOf('--json') + 1]).not.toContain('comments')
  })
})
