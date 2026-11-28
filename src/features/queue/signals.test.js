import { describe, expect, it, vi } from 'vitest'
import { cachedCollisions } from './signals.js'
import { createQueryClient } from '../../data/queryClient.js'
import { ghQueryKey } from '../../data/ghKeys.js'
import { getCollisionScan } from '../prs/collisions/scan.js'
import { evidence } from './queue.fixtures.js'

const pr = (number, files, extra = {}) => ({ number, state: 'OPEN', baseRefName: 'main', files, ...extra })
const added = path => ({ path, changeType: 'ADDED' })
const item = evidence({ number: 7, repository: { nameWithOwner: 'acme/web' } })

function clientWith(scan) {
  const client = createQueryClient()
  if (scan) client.setQueryData(ghQueryKey(getCollisionScan, ['acme/web', 7]), scan)
  return client
}

describe('collision badge source: the radar\'s cached scan, never a fetch', () => {
  it('is null when the radar has not run for the PR', () => {
    expect(cachedCollisions(item, clientWith(null))).toBeNull()
  })

  it('names the PRs the radar finds likely to collide, and ignores mere shared files', () => {
    const scan = { number: 7, prs: [pr(7, [added('src/new.js'), { path: 'README.md', changeType: 'MODIFIED' }]), pr(9, [added('src/new.js')]), pr(11, [{ path: 'README.md', changeType: 'MODIFIED' }])] }
    expect(cachedCollisions(item, clientWith(scan))).toEqual([9])
  })

  it('compares open PRs only, like the radar, and is null for a PR that is no longer open', () => {
    const closedOther = { number: 7, prs: [pr(7, [added('a.js')]), pr(9, [added('a.js')], { state: 'MERGED' })] }
    expect(cachedCollisions(item, clientWith(closedOther))).toEqual([])
    const closedSelf = { number: 7, prs: [pr(7, [added('a.js')], { state: 'CLOSED' }), pr(9, [added('a.js')])] }
    expect(cachedCollisions(item, clientWith(closedSelf))).toBeNull()
  })

  it('reads without starting any request', () => {
    const client = { getQueryData: vi.fn(() => undefined) }
    expect(cachedCollisions(item, client)).toBeNull()
    expect(client.getQueryData).toHaveBeenCalledTimes(1)
  })
})
