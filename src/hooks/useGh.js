/**
 * useGh.js — the read hook for gh-backed data: loading/error/data state, an in-memory
 * TTL cache and the disk cache. A thin shim over `useQuery` (R2, #480): keys, in-flight
 * dedupe, stale-result dropping and the synchronous seed live in `src/data/queryClient.js`;
 * this file adds the gh specifics (the disk-cache key, health reporting, logging).
 */

import { logger } from '../utils.js'
import { scopedCacheKey as makeDiskCacheKey, cacheIdentity, warmCache } from '../cache.js'
import { recordGhFailure, recordGhSuccess, clearGhFailure } from './useGhHealth.js'
import { useQuery, queryClient, QUERY_MAX_BYTES } from '../data/queryClient.js'
import { repoOf, ghQueryKey, seedGh } from '../data/ghKeys.js'
import { FRESHNESS, freshnessForOp } from '../data/freshness.js'

export { ghQueryKey, seedGh }

export const GH_MEMORY_MAX_BYTES = QUERY_MAX_BYTES

// Fill the disk-cache mirror once, in the background, so first-frame seeding never
// reads a file on the render path (#455).
warmCache()

/** Drop the in-memory cache (tests). */
export function resetGhMemoryCache() { queryClient.reset() }

/** Entry count and approximate bytes held by the in-memory gh cache (tests, debug). */
export function ghMemoryCacheStats() {
  const { size, bytes } = queryClient.stats()
  return { size, bytes }
}

/**
 * useGh(fetchFn, deps, options)
 *
 * @param {Function} fetchFn - async function that returns data
 * @param {Array}    deps    - dependency array, used as cache key
 * @param {Object}   [options] - { ttl: number (ms), freshness: class name, enabled, keepPreviousData }
 * @param {number}   [options.ttl] - freshness window in ms; wins over `freshness`
 * @param {'list'|'detail'|'conversation'|'notifications'|'immutable'} [options.freshness]
 *   - freshness class (src/data/freshness.js); default by fetch function name, else 30 s
 * @param {boolean}  [options.enabled=true] - false defers the fetch until it flips true
 * @param {boolean}  [options.keepPreviousData=false] - keep the last key's rows while a new key loads
 * @returns {{ data, loading, isLoading, isFetching, mode, skeletonDue, error, refetch, mutate, isStale, isPlaceholderData }}
 *   `loading` === `isLoading` (no data yet and a request in flight); it is not true while data
 *   already on screen revalidates. Migrated views branch on `mode` via <QueryBoundary>, not on `loading`.
 */
export function useGh(fetchFn, deps = [], { ttl, freshness, enabled = true, keepPreviousData = false } = {}) {
  const { host } = cacheIdentity()
  const op = fetchFn.name || 'unnamed'
  const repo = repoOf(deps)
  const diskCacheKey = makeDiskCacheKey([repo, fetchFn.name, deps])
  const callSite = `${op}:${diskCacheKey}`
  return useQuery(ghQueryKey(fetchFn, deps), () => fetchFn(...deps), {
    ttl: ttl ?? (freshness ? FRESHNESS[freshness] : freshnessForOp(op)),
    enabled,
    keepPreviousData,
    persist: { key: diskCacheKey, meta: { repo, host, op } },
    onSuccess: () => {
      recordGhSuccess(callSite)
      logger.info(`gh.${op} fetched data`, { cacheKey: diskCacheKey, component: 'useGh' })
    },
    onError: err => {
      recordGhFailure(callSite, err)
      logger.error(`useGh: ${op}(${diskCacheKey}) failed`, err)
    },
    // The owner left or its key changed: its failure is no longer current (#564).
    onCleanup: () => clearGhFailure(callSite),
  })
}
