/**
 * useGh.js — the read hook for gh-backed data: loading/error/data state, an in-memory
 * TTL cache and the disk cache. A thin shim over `useQuery` (R2, #480): keys, in-flight
 * dedupe, stale-result dropping and the synchronous seed live in `src/data/queryClient.js`;
 * this file adds the gh specifics (the disk-cache key, health reporting, logging).
 */

import { logger } from '../utils.js'
import { scopedCacheKey as makeDiskCacheKey, cacheIdentity, warmCache } from '../cache.js'
import { recordGhFailure, recordGhSuccess, clearGhFailure } from './useGhHealth.js'
import { useQuery, queryClient, DEFAULT_TTL, QUERY_MAX_BYTES } from '../data/queryClient.js'
import { repoOf, ghQueryKey, seedGh } from '../data/ghKeys.js'

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
 * @param {Object}   [options] - { ttl: number (ms) }
 * @param {number}   [options.ttl]
 * @param {boolean}  [options.enabled=true] - false defers the fetch until it flips true
 * @returns {{ data, loading, error, refetch, mutate, isStale }}
 */
export function useGh(fetchFn, deps = [], { ttl = DEFAULT_TTL, enabled = true } = {}) {
  const { host } = cacheIdentity()
  const op = fetchFn.name || 'unnamed'
  const repo = repoOf(deps)
  const diskCacheKey = makeDiskCacheKey([repo, fetchFn.name, deps])
  const callSite = `${op}:${diskCacheKey}`
  return useQuery(ghQueryKey(fetchFn, deps), () => fetchFn(...deps), {
    ttl,
    enabled,
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
