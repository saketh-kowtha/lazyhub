// @ts-nocheck
/**
 * src/features/prs/diff/prefetch.js — warm the diff's first request (#482).
 *
 * `d` needs one round trip: the changed-file list. When the cursor rests on a PR row, or its
 * detail opens, that page is fetched ahead of time into the same query entry `useGh` reads,
 * at low priority so it never delays a call the user asked for. A fresh entry or an
 * in-flight request is left alone; a failure is logged and the real open path fetches for itself.
 */

import { useEffect } from 'react'
import { queryClient, keyString, DEFAULT_TTL } from '../../../data/queryClient.js'
import { ghQueryKey } from '../../../data/ghKeys.js'
import { scopedCacheKey, cacheIdentity } from '../../../cache.js'
import { listPRFilesPage } from '../../../executor.js'
import { logSwallowed } from '../../../contain.js'

/** How long the cursor must rest on a PR row before its diff is prefetched. */
export const PREFETCH_REST_MS = 400

/**
 * Prefetch page 1 of a PR's changed files. Returns true when a request was started.
 * @param {string} repo
 * @param {number} number
 * @returns {boolean}
 */
export function prefetchPRDiff(repo, number) {
  if (!repo || number == null) return false
  const keyStr = keyString(ghQueryKey(listPRFilesPage, [repo, number]))
  const cached = queryClient.get(keyStr)
  if (cached && Date.now() - cached.timestamp < DEFAULT_TTL) return false
  if (queryClient.isInflight(keyStr)) return false
  const { host } = cacheIdentity()
  const { promise, release } = queryClient.fetch(
    keyStr,
    () => listPRFilesPage(repo, number, { priority: 'low' }),
    { persist: { key: scopedCacheKey([repo, listPRFilesPage.name, [repo, number]]), meta: { repo, host, op: listPRFilesPage.name } } },
  )
  promise.then(release, err => { release(); logSwallowed('prs.diff.prefetch', err) })
  return true
}

/**
 * Prefetch the diff of PR `number` once it has been the focus for `delayMs` (0: at once).
 * @param {string} repo
 * @param {number|null|undefined} number
 * @param {number} [delayMs]
 */
export function usePrefetchPRDiff(repo, number, delayMs = PREFETCH_REST_MS) {
  useEffect(() => {
    if (number == null) return undefined
    const timer = setTimeout(() => prefetchPRDiff(repo, number), delayMs)
    return () => clearTimeout(timer)
  }, [repo, number, delayMs])
}
