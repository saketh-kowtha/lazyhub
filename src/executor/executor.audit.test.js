import { beforeEach, describe, expect, it, vi } from 'vitest'

// Field sets captured from `gh pr list --json zzz` / `gh release list --json zzz` on gh 2.89.0.
const GH_PR_LIST_FIELDS = new Set(['additions', 'assignees', 'author', 'autoMergeRequest', 'baseRefName', 'baseRefOid', 'body', 'changedFiles', 'closed', 'closedAt', 'closingIssuesReferences', 'comments', 'commits', 'createdAt', 'deletions', 'files', 'fullDatabaseId', 'headRefName', 'headRefOid', 'headRepository', 'headRepositoryOwner', 'id', 'isCrossRepository', 'isDraft', 'labels', 'latestReviews', 'maintainerCanModify', 'mergeCommit', 'mergeStateStatus', 'mergeable', 'mergedAt', 'mergedBy', 'milestone', 'number', 'potentialMergeCommit', 'projectCards', 'projectItems', 'reactionGroups', 'reviewDecision', 'reviewRequests', 'reviews', 'state', 'statusCheckRollup', 'title', 'updatedAt', 'url'])
const GH_RELEASE_LIST_FIELDS = new Set(['createdAt', 'isDraft', 'isImmutable', 'isLatest', 'isPrerelease', 'name', 'publishedAt', 'tagName'])

const runGh = vi.fn()
vi.mock('./core.js', () => ({
  runGh: (...a) => runGh(...a),
  getRepo: r => r || process.env.GHUI_REPO,
}))

const { getPRStateForBranch } = await import('./branches.js')
const { listReleases, getPRChecks, getBranchProtection } = await import('./actions.js')
const { listGists } = await import('./misc.js')
const { listNotifications } = await import('./notifications.js')

const jsonFields = args => (args[args.indexOf('--json') + 1] || '').split(',').filter(Boolean)

beforeEach(() => { runGh.mockReset() })

describe('gh argv validity (audit)', () => {
  it('getPRStateForBranch only requests fields `gh pr list --json` accepts', async () => {
    runGh.mockResolvedValue([])
    await getPRStateForBranch('feat/x', 'a/b')
    const bad = jsonFields(runGh.mock.calls[0][0]).filter(f => !GH_PR_LIST_FIELDS.has(f))
    expect(bad).toEqual([]) // reviewThreads is rejected by gh: "Unknown JSON field"
  })

  it('listReleases only requests fields `gh release list --json` accepts', async () => {
    runGh.mockResolvedValue([])
    await listReleases('a/b')
    const bad = jsonFields(runGh.mock.calls[0][0]).filter(f => !GH_RELEASE_LIST_FIELDS.has(f))
    expect(bad).toEqual([]) // url is rejected by gh
  })

  it('listGists does not pass --json (gh gist list has no such flag)', async () => {
    runGh.mockResolvedValue([])
    await listGists()
    expect(runGh.mock.calls[0][0]).not.toContain('--json')
  })
})

describe('swallowed rejections (audit)', () => {
  it('getBranchProtection resolves null when gh fails (its catch is meant to do that)', async () => {
    runGh.mockRejectedValue(new Error('Branch not protected'))
    await expect(getBranchProtection('a/b', 'main')).resolves.toBeNull()
  })

  it('getPRChecks resolves [] when the check-runs call fails (its catch is meant to do that)', async () => {
    runGh.mockResolvedValueOnce({ headRefOid: 'abc123' }).mockRejectedValueOnce(new Error('HTTP 502'))
    await expect(getPRChecks('a/b', 1)).resolves.toEqual([])
  })
})

describe('silent truncation (audit)', () => {
  it('getPRChecks follows pagination (check-runs defaults to 30 per page)', async () => {
    runGh.mockResolvedValueOnce({ headRefOid: 'abc123' }).mockResolvedValueOnce([])
    await getPRChecks('a/b', 1)
    const args = runGh.mock.calls[1][0]
    expect(args.includes('--paginate') || /per_page=/.test(args[1])).toBe(true)
  })

  it('listNotifications follows pagination (notifications defaults to 50 per page)', async () => {
    runGh.mockResolvedValue([])
    await listNotifications()
    const args = runGh.mock.calls[0][0]
    expect(args.includes('--paginate') || args.some(a => /per_page/.test(a))).toBe(true)
  })
})
