/**
 * features/queue/signals.js - results other features already computed, read for the queue's
 * signal badges (#177 phase 2). Read-only and fetch-free: it looks in the in-memory query cache
 * and never starts a request, so a badge appears only for a PR whose feature view has run in
 * this session, and is hidden otherwise (never guessed).
 *
 * Collision radar (#360): the scan the radar stores under `useGh(getCollisionScan, [repo, number])`.
 */

import { queryClient } from '../../data/queryClient.js'
import { ghQueryKey } from '../../data/ghKeys.js'
import { generatedPatterns, getCollisionScan } from '../prs/collisions/scan.js'
import { collisionsFor, findCollisions } from '../prs/collisions/engine.js'
import { logSwallowed } from '../../contain.js'

/** Pairs per cached scan object, so a re-render does not recompute them. */
const pairsByScan = new WeakMap()

/**
 * The open PRs the collision radar found likely to collide with this one, or null when the radar
 * has not run for it (the badge is then hidden).
 * @param {{identity: {repo: string, number: number}}} item evidence record
 * @param {{getQueryData: (key: any) => any}} [client] replaced in tests
 * @returns {number[]|null}
 */
export function cachedCollisions(item, client = queryClient) {
  try {
    const { repo, number } = item.identity
    const scan = client.getQueryData(ghQueryKey(getCollisionScan, [repo, number]))
    if (!scan || !Array.isArray(scan.prs)) return null
    const current = scan.prs.find((/** @type {any} */ p) => p.number === number)
    if (!current || (current.state !== undefined && current.state !== 'OPEN')) return null
    let pairs = pairsByScan.get(scan)
    if (!pairs) {
      // The same comparison the radar draws (collisions/lines.js): open PRs, configured generated files.
      const open = scan.prs.filter((/** @type {any} */ p) => p.state === undefined || p.state === 'OPEN')
      pairs = findCollisions(open, { generated: generatedPatterns() }).pairs
      pairsByScan.set(scan, pairs)
    }
    return collisionsFor(number, pairs).filter(p => p.likely && !p.generatedOnly).map(p => p.other)
  } catch (error) {
    logSwallowed('queue.signals', error)
    return null
  }
}
