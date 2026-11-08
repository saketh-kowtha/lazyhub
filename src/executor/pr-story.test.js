import { beforeEach, describe, expect, it, vi } from 'vitest'
import { runGh } from './core.js'
import { getReviewDelta } from './pr-story.js'

vi.mock('./core.js', () => ({ getRepo: (r) => r, runGh: vi.fn() }))

beforeEach(() => vi.clearAllMocks())

const A = 'a'.repeat(40)
const B = 'b'.repeat(40)
const gql = (review, head = B) => ({ data: { repository: { pullRequest: { headRefOid: head, viewerLatestReview: review } } } })
const review = (oid, state = 'APPROVED') => ({ state, submittedAt: '2026-11-01T00:00:00Z', commit: { oid } })

describe('getReviewDelta (#362)', () => {
  it('says none when the viewer has not reviewed (or only has a pending review)', async () => {
    runGh.mockResolvedValueOnce(gql(null))
    expect((await getReviewDelta('o/r', 1)).status).toBe('none')
    runGh.mockResolvedValueOnce(gql(review(A, 'PENDING')))
    expect((await getReviewDelta('o/r', 1)).status).toBe('none')
  })

  it('says unknown when the review has no recorded commit', async () => {
    runGh.mockResolvedValueOnce(gql({ state: 'COMMENTED', submittedAt: null, commit: null }))
    const d = await getReviewDelta('o/r', 1)
    expect(d.status).toBe('unknown')
    expect(runGh).toHaveBeenCalledTimes(1)
  })

  it('says same without a compare call when the head is the reviewed commit', async () => {
    runGh.mockResolvedValueOnce(gql(review(B)))
    expect((await getReviewDelta('o/r', 1)).status).toBe('same')
    expect(runGh).toHaveBeenCalledTimes(1)
  })

  it('lists files changed since the review, including renamed-from paths', async () => {
    runGh.mockResolvedValueOnce(gql(review(A)))
    runGh.mockResolvedValueOnce({ status: 'ahead', files: [{ filename: 'a.js' }, { filename: 'new.js', previous_filename: 'old.js' }] })
    const d = await getReviewDelta('o/r', 1)
    expect(runGh.mock.calls[1][0][1]).toBe(`repos/o/r/compare/${A}...${B}?per_page=1`)
    expect(d).toMatchObject({ status: 'files', paths: ['a.js', 'new.js', 'old.js'], capped: false, approximate: false })
  })

  it('marks a diverged comparison approximate and a full file list as capped', async () => {
    runGh.mockResolvedValueOnce(gql(review(A)))
    runGh.mockResolvedValueOnce({ status: 'diverged', files: Array.from({ length: 300 }, (_, i) => ({ filename: `f${i}` })) })
    const d = await getReviewDelta('o/r', 1)
    expect(d).toMatchObject({ status: 'files', approximate: true, capped: true })
    expect(d.paths).toHaveLength(300)
  })

  it('says unknown, with the reason, when the reviewed commit is gone (force-push)', async () => {
    runGh.mockResolvedValueOnce(gql(review(A)))
    runGh.mockRejectedValueOnce(new Error('HTTP 404'))
    const d = await getReviewDelta('o/r', 1)
    expect(d.status).toBe('unknown')
    expect(d.reason).toMatch(/force-push/)
  })
})
