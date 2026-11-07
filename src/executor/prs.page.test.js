import { describe, expect, it, vi, beforeEach } from 'vitest'
import { runGh } from './core.js'
import { listPRsPage, getPRRow, getPRPreview, searchOwnsState, validatePRSearch } from './prs.js'

vi.mock('./core.js', () => ({ getRepo: (r) => r, runGh: vi.fn() }))

const q = () => runGh.mock.calls[0][0].find(a => a.startsWith('searchQuery='))
const node = (over = {}) => ({
  __typename: 'PullRequest', number: 4, title: 't', state: 'OPEN', author: { login: 'a' },
  labels: { nodes: [{ name: 'bug' }] }, reviewRequests: { nodes: [] }, assignees: { nodes: [] },
  statusCheckRollup: { state: 'FAILURE', contexts: {
    checkRunCountsByState: [{ state: 'SUCCESS', count: 3 }, { state: 'FAILURE', count: 2 }, { state: 'IN_PROGRESS', count: 1 }],
    statusContextCountsByState: [{ state: 'PENDING', count: 1 }],
  } },
  ...over,
})

describe('listPRsPage (#508)', () => {
  beforeEach(() => vi.clearAllMocks())

  it('fetches one cursor page, passes the cursor, and reports the total', async () => {
    runGh.mockResolvedValue({ data: { search: { issueCount: 4321, pageInfo: { hasNextPage: true, endCursor: 'c2' }, nodes: [node()] } } })
    const page = await listPRsPage('o/r', { states: ['open'], limit: 100, after: 'c1' })
    expect(runGh).toHaveBeenCalledTimes(1)
    const args = runGh.mock.calls[0][0]
    expect(args).toContain('after=c1')
    expect(args).toContain('limit=100')
    expect(page).toMatchObject({ hasNextPage: true, endCursor: 'c2', totalCount: 4321 })
  })

  it('keeps rows slim: no check contexts, no body, CI as counters', async () => {
    runGh.mockResolvedValue({ data: { search: { issueCount: 1, pageInfo: {}, nodes: [node()] } } })
    const page = await listPRsPage('o/r')
    const query = runGh.mock.calls[0][0].find(a => a.startsWith('query='))
    expect(query).not.toMatch(/contexts\(first: 50\)/)
    expect(query).not.toMatch(/\bbody\b/)
    expect(page.items[0]).not.toHaveProperty('body')
    expect(page.items[0]).not.toHaveProperty('statusCheckRollup')
    expect(page.items[0].checkSummary).toEqual({ total: 7, failing: 2, pending: 2 })
  })

  it('asks the server for exactly the states shown, so the total is real', async () => {
    runGh.mockResolvedValue({ data: { search: { issueCount: 0, pageInfo: {}, nodes: [] } } })
    await listPRsPage('o/r', { states: ['closed'] })
    expect(q()).toContain('is:closed -is:merged')
    runGh.mockClear()
    await listPRsPage('o/r', { states: ['merged'] })
    expect(q()).toContain('is:merged')
    runGh.mockClear()
    await listPRsPage('o/r', { states: ['open', 'closed'], sort: 'oldest' })
    expect(q()).toContain('sort:updated-asc')
    expect(q()).toContain('-is:merged')
    expect((await listPRsPage('o/r', { states: ['open', 'closed'] })).exactTotal).toBe(true)
    // Open+merged cannot be one search, so the list must not claim a total for it.
    expect((await listPRsPage('o/r', { states: ['open', 'merged'] })).exactTotal).toBe(false)
  })

  it('rejects an author that would add search qualifiers', async () => {
    await expect(listPRsPage('o/r', { author: 'x is:closed' })).rejects.toThrow(/Invalid login/)
    expect(runGh).not.toHaveBeenCalled()
  })
})

describe('getPRRow / getPRPreview (#508)', () => {
  beforeEach(() => vi.clearAllMocks())

  it('reads one row in the list shape', async () => {
    runGh.mockResolvedValue({ data: { repository: { pullRequest: node({ reviewDecision: 'APPROVED' }) } } })
    const row = await getPRRow('o/r', 4)
    expect(runGh.mock.calls[0][0]).toContain('number=4')
    expect(row).toMatchObject({ number: 4, reviewDecision: 'APPROVED', labels: [{ name: 'bug' }] })
  })

  it('loads body and checks on demand', async () => {
    runGh.mockResolvedValue({ body: 'hello', statusCheckRollup: [{ name: 'ci' }] })
    expect(await getPRPreview('o/r', 4)).toEqual({ body: 'hello', statusCheckRollup: [{ name: 'ci' }] })
    expect(runGh.mock.calls[0][0]).toEqual(expect.arrayContaining(['pr', 'view', '4']))
  })
})

describe('listPRsPage server-side search (#508)', () => {
  beforeEach(() => vi.clearAllMocks())
  const empty = () => runGh.mockResolvedValue({ data: { search: { issueCount: 0, pageInfo: {}, nodes: [] } } })

  it('sends the typed query to GitHub search after the repo, kind and state qualifiers', async () => {
    empty()
    await listPRsPage('o/r', { states: ['open'], search: 'author:alice flaky test' })
    const query = q()
    expect(query).toContain('repo:o/r is:pr')
    expect(query).toContain('state:open')
    expect(query.endsWith('author:alice flaky test')).toBe(true)
  })

  it('lets a query that names its own state replace the filter state', async () => {
    empty()
    await listPRsPage('o/r', { states: ['open'], search: 'is:closed author:x foo' })
    expect(q()).not.toContain('state:open')
    expect(q()).toContain('is:closed author:x foo')
    expect(searchOwnsState('is:closed author:x foo')).toBe(true)
    expect(searchOwnsState('-is:merged foo')).toBe(true)
    expect(searchOwnsState('state:open')).toBe(true)
    expect(searchOwnsState('author:x foo')).toBe(false)
  })

  it('keeps the cursor and the total for a search page', async () => {
    runGh.mockResolvedValue({ data: { search: { issueCount: 80000, pageInfo: { hasNextPage: true, endCursor: 'z' }, nodes: [node()] } } })
    const page = await listPRsPage('o/r', { search: 'foo', after: 'y' })
    expect(runGh.mock.calls[0][0]).toContain('after=y')
    expect(page).toMatchObject({ hasNextPage: true, endCursor: 'z', totalCount: 80000 })
  })

  it.each([
    'repo:other/x foo', 'org:acme foo', 'user:bob foo', 'owner:bob foo', 'is:issue foo', 'type:issue foo',
    'sort:created-asc foo', '-repo:o/r foo', 'foo\nrepo:other/x', 'x'.repeat(300),
  ])('refuses a query that could leave this repository or break the list: %j', async (search) => {
    expect(() => validatePRSearch(search)).toThrow()
    await expect(listPRsPage('o/r', { search })).rejects.toThrow()
    expect(runGh).not.toHaveBeenCalled()
  })

  it('treats an empty or blank query as no search', async () => {
    empty()
    await listPRsPage('o/r', { search: '   ' })
    expect(q()).not.toMatch(/\s$/)
    expect(validatePRSearch('  foo  ')).toBe('foo')
  })
})
