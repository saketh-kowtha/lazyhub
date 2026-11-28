// Fewer gh spawns per journey (#622): the PR list's first page carries the repository info the
// list asks for beside it, and the detail's check runs reuse the head commit of the getPR() read in
// flight. Each falls back to its own gh call exactly as before when there is nothing to reuse.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GhError } from './gh-error.js'

const runGh = vi.fn()
vi.mock('./core.js', () => ({ getRepo: r => r, repoPath: r => r, runGh: (...a) => runGh(...a) }))

const { listPRsPage, getRepoInfo, getPR } = await import('./prs.js')
const { getPRChecks } = await import('./actions.js')
const { resetSchemaCompat } = await import('./schema-compat.js')

const argOf = (args, name) => args.find(a => String(a).startsWith(`${name}=`))?.slice(name.length + 1)
const kinds = () => runGh.mock.calls.map(([args]) => args.slice(0, 2).join(' '))
const repoNode = {
  name: 'r', owner: { id: 'O_1', login: 'o' }, defaultBranchRef: { name: 'main' }, squashMergeAllowed: true,
  mergeCommitAllowed: false, rebaseMergeAllowed: true, deleteBranchOnMerge: true, viewerPermission: 'ADMIN',
}
const page = (repository) => ({ data: { search: { issueCount: 0, pageInfo: {}, nodes: [] }, ...(repository !== undefined ? { repository } : {}) } })
const repoView = { name: 'r', owner: { id: 'O_1', login: 'o' }, defaultBranchRef: { name: 'main' }, squashMergeAllowed: false, mergeCommitAllowed: true, rebaseMergeAllowed: true, deleteBranchOnMerge: false, viewerPermission: 'WRITE' }

/**
 * gh answering the list page with `pageAnswer` and everything else from `other`.
 * @param {any} pageAnswer
 * @param {Function} [other]
 */
function fakeGh(pageAnswer, other = () => null) {
  runGh.mockImplementation(async args => {
    if (args[0] === 'api' && args[1] === 'graphql') return typeof pageAnswer === 'function' ? pageAnswer(args) : pageAnswer
    if (args[0] === 'repo' && args[1] === 'view') return repoView
    return other(args)
  })
}

beforeEach(() => { runGh.mockReset(); resetSchemaCompat() })
afterEach(() => { delete process.env.GH_HOST })

describe('repository info rides on the first PR list page', () => {
  it('selects the repo view fields on the first page only, with owner and name as strings', async () => {
    fakeGh(page(repoNode))
    await listPRsPage('o/r')
    const first = runGh.mock.calls[0][0]
    expect(argOf(first, 'query')).toMatch(/repository\(owner: \$owner, name: \$name\) \{ name owner \{ id login \} defaultBranchRef \{ name \} squashMergeAllowed mergeCommitAllowed rebaseMergeAllowed deleteBranchOnMerge viewerPermission \}/)
    expect(first).toEqual(expect.arrayContaining(['-f', 'owner=o', '-f', 'name=r']))
    runGh.mockClear()
    await listPRsPage('o/r', { after: 'c1' })
    const next = runGh.mock.calls[0][0]
    expect(argOf(next, 'query')).not.toMatch(/repository\(/)
    expect(next.some(a => String(a).startsWith('owner='))).toBe(false)
  })

  it('answers getRepoInfo() started beside it without a gh call, in the gh repo view shape', async () => {
    fakeGh(page(repoNode))
    const [, info] = await Promise.all([listPRsPage('o/r'), getRepoInfo('o/r')])
    expect(kinds()).toEqual(['api graphql'])
    expect(info).toEqual(repoNode)
  })

  it('maps a null default branch and permission the way gh does', async () => {
    fakeGh(page({ ...repoNode, defaultBranchRef: null, viewerPermission: null }))
    const [, info] = await Promise.all([listPRsPage('o/r'), getRepoInfo('o/r')])
    expect(info).toMatchObject({ defaultBranchRef: { name: '' }, viewerPermission: '' })
  })

  it('runs gh repo view as before when nothing is in flight, the page carries no repository, or the page fails', async () => {
    fakeGh(page(repoNode))
    expect(await getRepoInfo('o/r')).toEqual(repoView)
    expect(kinds()).toEqual(['repo view'])

    runGh.mockReset()
    fakeGh(page({ id: 'R_1' }))
    const [, partial] = await Promise.all([listPRsPage('o/r'), getRepoInfo('o/r')])
    expect(partial).toEqual(repoView)
    expect(kinds()).toEqual(['api graphql', 'repo view'])

    runGh.mockReset()
    fakeGh(() => { throw new GhError({ message: 'boom', stderr: 'boom', exitCode: 1, args: [] }) })
    const [list, info] = await Promise.allSettled([listPRsPage('o/r'), getRepoInfo('o/r')])
    expect(list.status).toBe('rejected')
    expect(info).toEqual({ status: 'fulfilled', value: repoView })
  })

  it('does not join a page of another repository', async () => {
    fakeGh(page(repoNode))
    await Promise.all([listPRsPage('o/r'), getRepoInfo('o/other')])
    expect(kinds()).toEqual(['api graphql', 'repo view'])
  })

  it('drops the block on a GHES host whose schema lacks a field, and getRepoInfo falls back', async () => {
    process.env.GH_HOST = 'ghe.corp.example'
    fakeGh(args => {
      if (/viewerPermission/.test(argOf(args, 'query'))) {
        throw new GhError({ message: "gh: Field 'viewerPermission' doesn't exist on type 'Repository'", stderr: "gh: Field 'viewerPermission' doesn't exist on type 'Repository'", exitCode: 1, args })
      }
      return page()
    })
    const [result, info] = await Promise.all([listPRsPage('o/r'), getRepoInfo('o/r')])
    expect(result.items).toEqual([])
    expect(info).toEqual(repoView)
    expect(kinds()).toEqual(['api graphql', 'api graphql', 'repo view'])
    const retry = runGh.mock.calls[1][0]
    expect(argOf(retry, 'query')).not.toMatch(/repository\(/)
    expect(retry.some(a => String(a).startsWith('owner='))).toBe(false)
  })
})

describe('check runs reuse the head of the getPR() read in flight', () => {
  const HEAD = 'a'.repeat(40)
  const gh = (pr) => runGh.mockImplementation(async args => {
    if (args[0] === 'pr' && args[1] === 'view') {
      if (args.at(-1) === 'headRefOid') return { headRefOid: 'b'.repeat(40) }
      if (pr instanceof Error) throw pr
      return pr
    }
    if (args[0] === 'api' && /check-runs/.test(args[1])) return [{ id: 1, name: 'ci', status: 'completed', conclusion: 'success' }]
    return null
  })

  it('makes no second pr view when the detail read is in flight', async () => {
    gh({ number: 5, headRefOid: HEAD })
    const [, checks] = await Promise.all([getPR('o/r', 5), getPRChecks('o/r', 5)])
    expect(kinds()).toEqual(['pr view', `api repos/o/r/commits/${HEAD}/check-runs?per_page=100&page=1`])
    expect(checks.map(c => c.name)).toEqual(['ci'])
  })

  it('asks for the head itself when no detail read is in flight, or it is for another PR', async () => {
    gh({ number: 5, headRefOid: HEAD })
    await getPRChecks('o/r', 5)
    expect(runGh.mock.calls[0][0]).toEqual(['pr', 'view', '5', '--repo', 'o/r', '--json', 'headRefOid'])
    runGh.mockClear()
    await Promise.all([getPR('o/r', 6), getPRChecks('o/r', 5)])
    expect(runGh.mock.calls.filter(([a]) => a.at(-1) === 'headRefOid')).toHaveLength(1)
  })

  it('falls back to its own head read when the detail read fails or has no head', async () => {
    gh(new GhError({ message: 'boom', stderr: '', exitCode: 1, args: [] }))
    const [detail, checks] = await Promise.allSettled([getPR('o/r', 5), getPRChecks('o/r', 5)])
    expect(detail.status).toBe('rejected')
    expect(checks.status).toBe('fulfilled')
    expect(runGh.mock.calls.filter(([a]) => a.at(-1) === 'headRefOid')).toHaveLength(1)
    expect(runGh.mock.calls.at(-1)[0][1]).toBe(`repos/o/r/commits/${'b'.repeat(40)}/check-runs?per_page=100&page=1`)
  })
})
