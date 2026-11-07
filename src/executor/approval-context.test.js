import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { runGh } from './core.js'
import { readApprovalContext } from './approval-context.js'
import { classifyGh } from '../daemon/protocol.js'

vi.mock('./core.js', () => ({ runGh: vi.fn() }))

const NOW = new Date('2026-11-07T12:00:00.000Z')

function response(over = {}) {
  const pr = {
    id: 'PR_kwDOExample0001',
    number: 42,
    state: 'OPEN',
    isDraft: false,
    isCrossRepository: false,
    baseRefName: 'main',
    baseRefOid: '1'.repeat(40),
    headRefName: 'feature/x',
    headRefOid: '2'.repeat(40),
    headRepository: { id: 'R_kgDOExample01' },
    autoMergeRequest: null,
    ...over.pr,
  }
  const data = {
    repository: { id: 'R_kgDOExample01', nameWithOwner: 'octo-org/sandbox', pullRequest: pr, ...over.repository },
    viewer: { login: 'octocat', id: 'U_kgDOExample', ...over.viewer },
  }
  if (over.dropRepository) delete data.repository
  if (over.dropViewer) delete data.viewer
  return { data }
}

const invalid = expect.objectContaining({ code: 'ERR_APPROVAL_INVALID_INPUT' })
let savedHost

beforeEach(() => {
  vi.clearAllMocks()
  savedHost = process.env.GH_HOST
  delete process.env.GH_HOST
})
afterEach(() => {
  if (savedHost === undefined) delete process.env.GH_HOST
  else process.env.GH_HOST = savedHost
})

describe('readApprovalContext (#235)', () => {
  it('runs one read-only GraphQL query with -f strings and a -F integer, bypassing the daemon cache', async () => {
    runGh.mockResolvedValue(response())
    await readApprovalContext({ repo: 'octo-org/sandbox', number: 42, now: () => NOW })
    expect(runGh).toHaveBeenCalledTimes(1)
    const [args, opts] = runGh.mock.calls[0]
    expect(args.slice(0, 2)).toEqual(['api', 'graphql'])
    const query = args.find(a => a.startsWith('query='))
    for (const field of ['viewer', 'login', 'id', 'nameWithOwner', 'baseRefOid', 'headRefOid', 'headRefName', 'baseRefName', 'isCrossRepository', 'isDraft', 'autoMergeRequest', 'headRepository']) {
      expect(query).toContain(field)
    }
    expect(query).not.toMatch(/mutation/i)
    expect(query).not.toMatch(/\bbody\b|\bpatch\b|\bdiff\b/)
    const pairs = []
    for (let i = 2; i < args.length; i += 2) pairs.push([args[i], args[i + 1]])
    expect(pairs.filter(([flag]) => flag === '-F')).toEqual([['-F', 'number=42']])
    expect(pairs.filter(([flag]) => flag === '-f').map(([, v]) => v.split('=')[0]).sort()).toEqual(['name', 'owner', 'query'])
    expect(args).toContain('owner=octo-org')
    expect(args).toContain('name=sandbox')
    expect(opts).toMatchObject({ skipDaemon: true })
    expect(classifyGh(args)).toBe('read')
  })

  it('maps every field', async () => {
    runGh.mockResolvedValue(response())
    await expect(readApprovalContext({ repo: 'octo-org/sandbox', number: 42, now: () => NOW })).resolves.toEqual({
      host: 'github.com',
      repo_node_id: 'R_kgDOExample01',
      name_with_owner: 'octo-org/sandbox',
      pr_node_id: 'PR_kwDOExample0001',
      number: 42,
      state: 'OPEN',
      is_draft: false,
      is_cross_repository: false,
      base_ref: 'main',
      base_sha: '1'.repeat(40),
      head_ref: 'feature/x',
      head_sha: '2'.repeat(40),
      head_repo_node_id: 'R_kgDOExample01',
      auto_merge_enabled: false,
      approver: { host: 'github.com', login: 'octocat', node_id: 'U_kgDOExample' },
      fetched_at: '2026-11-07T12:00:00.000Z',
    })
  })

  it('reports auto-merge and fork facts as read, and lowercases GH_HOST', async () => {
    process.env.GH_HOST = 'GHE.Example.COM'
    runGh.mockResolvedValue(response({ pr: { autoMergeRequest: { enabledAt: '2026-11-07T11:00:00Z' }, isCrossRepository: true, headRepository: { id: 'R_kgDOFork0002' } } }))
    const ctx = await readApprovalContext({ repo: 'octo-org/sandbox', number: 42, now: () => NOW })
    expect(ctx).toMatchObject({ host: 'ghe.example.com', auto_merge_enabled: true, is_cross_repository: true, head_repo_node_id: 'R_kgDOFork0002' })
    expect(ctx.approver.host).toBe('ghe.example.com')
  })

  it.each([
    ['repository', { dropRepository: true }, 'repository'],
    ['viewer', { dropViewer: true }, 'viewer'],
    ['repository id', { repository: { id: undefined } }, 'repo_node_id'],
    ['nameWithOwner', { repository: { nameWithOwner: undefined } }, 'name_with_owner'],
    ['pull request', { repository: { pullRequest: null } }, 'pr'],
    ['pr id', { pr: { id: undefined } }, 'pr_node_id'],
    ['pr number', { pr: { number: undefined } }, 'number'],
    ['state', { pr: { state: undefined } }, 'state'],
    ['isDraft', { pr: { isDraft: undefined } }, 'is_draft'],
    ['isCrossRepository', { pr: { isCrossRepository: undefined } }, 'is_cross_repository'],
    ['baseRefName', { pr: { baseRefName: undefined } }, 'base_ref'],
    ['baseRefOid', { pr: { baseRefOid: undefined } }, 'base_sha'],
    ['headRefName', { pr: { headRefName: undefined } }, 'head_ref'],
    ['headRefOid', { pr: { headRefOid: undefined } }, 'head_sha'],
    ['headRepository', { pr: { headRepository: null } }, 'head_repo_node_id'],
    ['autoMergeRequest', { pr: { autoMergeRequest: undefined } }, 'auto_merge_enabled'],
    ['viewer login', { viewer: { login: undefined } }, 'approver.login'],
    ['viewer id', { viewer: { id: '' } }, 'approver.node_id'],
  ])('throws ERR_APPROVAL_INVALID_INPUT naming the missing %s', async (_name, over, field) => {
    runGh.mockResolvedValue(response(over))
    let caught
    try { await readApprovalContext({ repo: 'octo-org/sandbox', number: 42, now: () => NOW }) } catch (err) { caught = err }
    expect(caught).toEqual(invalid)
    expect(caught.changed).toEqual([field])
  })

  it('rejects an empty or non-object response and bad arguments without calling gh', async () => {
    runGh.mockResolvedValue(null)
    await expect(readApprovalContext({ repo: 'octo-org/sandbox', number: 42 })).rejects.toEqual(invalid)
    runGh.mockClear()
    for (const bad of [{ repo: 'nope', number: 1 }, { repo: 'a/b', number: 0 }, { repo: 'a/b', number: 1.5 }, { repo: 'a/b;rm', number: 1 }, { repo: undefined, number: 1 }]) {
      await expect(readApprovalContext(bad)).rejects.toEqual(invalid)
    }
    process.env.GH_HOST = 'bad host!'
    await expect(readApprovalContext({ repo: 'a/b', number: 1 })).rejects.toEqual(invalid)
    expect(runGh).not.toHaveBeenCalled()
  })

  it('lets a gh failure propagate rather than inventing a context', async () => {
    runGh.mockRejectedValue(new Error('offline'))
    await expect(readApprovalContext({ repo: 'a/b', number: 1 })).rejects.toThrow('offline')
  })
})
