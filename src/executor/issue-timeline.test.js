import { describe, expect, it, vi, beforeEach } from 'vitest'
import { runGh } from './core.js'
import { classifyGh } from '../daemon/protocol.js'
import { listIssueTimelinePage, mapIssueTimelineNode, editIssueComment, deleteIssueComment, getIssueHeader } from './issue-timeline.js'

vi.mock('./core.js', () => ({ getRepo: (r) => r, runGh: vi.fn() }))

const comment = (over = {}) => ({
  __typename: 'IssueComment', id: 'IC_1', databaseId: 101, body: 'hello', url: 'https://x/c/101',
  createdAt: '2026-06-01T00:00:00Z', lastEditedAt: null, authorAssociation: 'MEMBER',
  isMinimized: false, minimizedReason: null, viewerCanUpdate: true, viewerCanDelete: false,
  author: { login: 'alice' },
  reactionGroups: [{ content: 'THUMBS_UP', reactors: { totalCount: 2 } }, { content: 'HEART', reactors: { totalCount: 0 } }],
  ...over,
})

describe('listIssueTimelinePage (#565)', () => {
  beforeEach(() => vi.clearAllMocks())

  it('sends the cursor and sizes with the right flags, and maps comments and events in order', async () => {
    runGh.mockResolvedValue({ data: { viewer: { login: 'me' }, repository: { issue: { timelineItems: {
      totalCount: 120,
      pageInfo: { hasNextPage: true, endCursor: 'c2' },
      nodes: [
        comment(),
        { __typename: 'LabeledEvent', id: 'L1', createdAt: 't', actor: { login: 'bob' }, label: { name: 'bug', color: 'f00' } },
        { __typename: 'ClosedEvent', id: 'X1', createdAt: 't', actor: { login: 'bob' }, stateReason: 'COMPLETED', closer: { __typename: 'PullRequest', number: 9, title: 'Fix', url: 'u' } },
        { __typename: 'SomethingNew', id: 'Z' },
      ],
    } } } } })
    const res = await listIssueTimelinePage('o/r', 7, { after: 'c1', pageSize: 50 })
    const args = runGh.mock.calls[0][0]
    expect(args).toContain('after=c1')
    expect(args[args.indexOf('number=7') - 1]).toBe('-F')
    expect(args[args.indexOf('size=50') - 1]).toBe('-F')
    expect(args[args.indexOf('owner=o') - 1]).toBe('-f')
    const query = args.find(a => a.startsWith('query='))
    expect(query).toContain('timelineItems(first: $size, after: $after')
    for (const field of ['reactionGroups', 'authorAssociation', 'isMinimized', 'minimizedReason', 'lastEditedAt', 'viewerCanUpdate', 'viewerCanDelete', 'CrossReferencedEvent', 'ConnectedEvent', 'RenamedTitleEvent']) {
      expect(query).toContain(field)
    }
    expect(res.page).toEqual({ total: 120, hasNextPage: true, endCursor: 'c2', stalled: false })
    expect(res.viewer).toBe('me')
    expect(res.items.map(i => i.kind)).toEqual(['comment', 'event', 'event'])
    expect(res.items[0]).toMatchObject({
      id: 101, author: 'alice', authorAssociation: 'MEMBER', viewerCanUpdate: true, viewerCanDelete: false,
      reactions: [{ content: 'THUMBS_UP', label: '+1', count: 2 }],
    })
    expect(res.items[2]).toMatchObject({ type: 'closed', stateReason: 'COMPLETED', closer: { type: 'pr', number: 9 } })
  })

  it('omits after on the first page and is a read for the classifier', async () => {
    runGh.mockResolvedValue({ data: { repository: { issue: { timelineItems: { totalCount: 0, pageInfo: { hasNextPage: false, endCursor: null }, nodes: [] } } } } })
    const res = await listIssueTimelinePage('o/r', 1)
    const args = runGh.mock.calls[0][0]
    expect(args.some(a => String(a).startsWith('after='))).toBe(false)
    expect(classifyGh(args)).toBe('read')
    expect(res).toEqual({ items: [], page: { total: 0, hasNextPage: false, endCursor: null, stalled: false }, viewer: '' })
  })

  it('reports a repeated cursor as stalled instead of looping', async () => {
    runGh.mockResolvedValue({ data: { repository: { issue: { timelineItems: { totalCount: 9, pageInfo: { hasNextPage: true, endCursor: 'same' }, nodes: [] } } } } })
    const res = await listIssueTimelinePage('o/r', 1, { after: 'same' })
    expect(res.page).toMatchObject({ hasNextPage: false, stalled: true })
  })

  it('rejects a malformed repository before calling gh', async () => {
    await expect(listIssueTimelinePage('o/r;x', 1)).rejects.toThrow(/Invalid repository/)
    expect(runGh).not.toHaveBeenCalled()
  })
})

describe('mapIssueTimelineNode (#565)', () => {
  it('names the other end of a cross reference and of a connected PR', () => {
    const pr = { __typename: 'PullRequest', number: 40, title: 'Fix it', url: 'u', repository: { nameWithOwner: 'o/r' } }
    const self = { __typename: 'Issue', number: 7, title: 'me', url: 'v', repository: { nameWithOwner: 'o/r' } }
    expect(mapIssueTimelineNode({ __typename: 'CrossReferencedEvent', id: 'a', source: pr, willCloseTarget: true }, 7))
      .toMatchObject({ type: 'cross-referenced', willClose: true, source: { type: 'pr', number: 40 } })
    expect(mapIssueTimelineNode({ __typename: 'ConnectedEvent', id: 'b', source: self, subject: pr }, 7))
      .toMatchObject({ type: 'connected', source: { type: 'pr', number: 40 } })
  })

  it('maps rename, assign, reopen and minimized comments', () => {
    expect(mapIssueTimelineNode({ __typename: 'RenamedTitleEvent', id: 'r', previousTitle: 'a', currentTitle: 'b' }, 1)).toMatchObject({ type: 'renamed', from: 'a', to: 'b' })
    expect(mapIssueTimelineNode({ __typename: 'AssignedEvent', id: 's', assignee: { login: 'carol' } }, 1)).toMatchObject({ type: 'assigned', assignee: 'carol' })
    expect(mapIssueTimelineNode({ __typename: 'ReopenedEvent', id: 'o' }, 1)).toMatchObject({ type: 'reopened' })
    expect(mapIssueTimelineNode(comment({ isMinimized: true, minimizedReason: 'SPAM', lastEditedAt: 'e' }), 1))
      .toMatchObject({ isMinimized: true, minimizedReason: 'SPAM', lastEditedAt: 'e' })
  })
})

describe('issue comment writes and header (#565)', () => {
  beforeEach(() => vi.clearAllMocks())

  it('edits and deletes through REST calls the write classifier recognises', async () => {
    runGh.mockResolvedValue({})
    await editIssueComment('o/r', 101, 'new text')
    await deleteIssueComment('o/r', 101)
    const [edit, del] = runGh.mock.calls.map(c => c[0])
    expect(edit).toEqual(['api', 'repos/o/r/issues/comments/101', '--method', 'PATCH', '--raw-field', 'body=new text'])
    expect(del).toEqual(['api', 'repos/o/r/issues/comments/101', '--method', 'DELETE'])
    expect(classifyGh(edit)).toBe('write')
    expect(classifyGh(del)).toBe('write')
  })

  it('refuses a non-numeric comment id', async () => {
    await expect(editIssueComment('o/r', '1;rm', 'x')).rejects.toThrow(/Invalid comment ID/)
    await expect(deleteIssueComment('o/r', 0)).rejects.toThrow(/Invalid comment ID/)
    expect(runGh).not.toHaveBeenCalled()
  })

  it('reads the header without the comments array', async () => {
    runGh.mockResolvedValue({})
    await getIssueHeader('o/r', 3)
    const args = runGh.mock.calls[0][0]
    expect(args[args.indexOf('--json') + 1]).not.toContain('comments')
    expect(classifyGh(args)).toBe('read')
  })
})
