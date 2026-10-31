/**
 * useGh.js — React hook that wraps executor calls with loading/error/data state
 * and an in-memory TTL cache.
 */

import { useState, useEffect, useRef, useCallback } from 'react'
import { logger } from '../utils.js'
import { cacheKey as makeDiskCacheKey, createLruCache, readCache, writeCache } from '../cache.js'
import { recordGhFailure, recordGhSuccess } from './useGhHealth.js'

// In-memory cache: key → { data, timestamp }, LRU-capped so a long session
// (many repos/pages) cannot grow without bound.
let cache = createLruCache(200)

/** Drop the in-memory cache (tests). */
export function resetGhMemoryCache() { cache = createLruCache(200) }

const DEFAULT_TTL = 30_000 // 30 seconds

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
  const cacheKey = JSON.stringify([fetchFn.name, ...deps])
  const repo = typeof deps[0] === 'string' ? deps[0] : process.env.GHUI_REPO
  const diskCacheKey = makeDiskCacheKey([repo, fetchFn.name, deps])
  // Stale-while-revalidate (#454): seed from the memory/disk cache synchronously so a
  // revisit renders cached data on the first frame instead of a loading frame.
  const [seed] = useState(() => {
    const mem = cache.get(cacheKey)
    if (mem) return { data: mem.data, stale: Date.now() - mem.timestamp >= ttl }
    const disk = readCache(diskCacheKey)
    return disk ? { data: disk.payload, stale: true } : null
  })
  const [data, setData] = useState(seed ? seed.data : null)
  const [loading, setLoading] = useState(!seed)
  const [error, setError] = useState(null)
  const [isStale, setIsStale] = useState(Boolean(seed?.stale))
  const mountedRef = useRef(true)
  // Request generation: only the latest request may touch state (#434).
  const reqRef = useRef(0)
  const callSite = `${fetchFn.name || 'unnamed'}:${diskCacheKey}`

  const fetchData = useCallback(async (bypassCache = false) => {
    if (!mountedRef.current) return
    const reqId = ++reqRef.current
    const isCurrent = () => mountedRef.current && reqRef.current === reqId

    const now = Date.now()
    const cached = cache.get(cacheKey)
    const diskCached = readCache(diskCacheKey)

    if (!bypassCache && cached && now - cached.timestamp < ttl) {
      setData(cached.data)
      setLoading(false)
      setError(null)
      setIsStale(false)
      return
    }

    if (!bypassCache && (cached || diskCached)) {
      setData(cached ? cached.data : diskCached.payload)
      setLoading(false)
      setIsStale(true)
    } else {
      setLoading(true)
      setIsStale(false)
    }
    setError(null)

    try {
      const result = await fetchFn(...deps)
      if (!isCurrent()) return
      cache.set(cacheKey, { data: result, timestamp: Date.now() })
      writeCache(diskCacheKey, result, { repo, op: fetchFn.name || 'unnamed' })
      setData(result)
      setError(null)
      setIsStale(false)
      recordGhSuccess(callSite)
      logger.info(`gh.${fetchFn.name || 'unnamed'} fetched data`, { cacheKey, component: 'useGh' })
    } catch (err) {
      if (!isCurrent()) return
      setError(err)
      if (!diskCached && !cached) setData(null)
      setIsStale(Boolean(diskCached || cached))
      recordGhFailure(callSite, err)
      logger.error(`useGh: ${fetchFn.name || 'unnamed'}(${cacheKey}) failed`, err)
    } finally {
      if (isCurrent()) {
        setLoading(false)
      }
    }
  }, [cacheKey, diskCacheKey, fetchFn, repo, ttl]) // eslint-disable-line react-hooks/exhaustive-deps

  const refetch = useCallback(() => {
    fetchData(true)
  }, [fetchData])

  /**
   * Optimistically update cached data without refetching.
   * updater receives the current data and returns the new data.
   * Pass { revalidate: true } to trigger a background refetch after update.
   */
  const mutate = useCallback((updater, opts = {}) => {
    setData(prev => {
      const next = updater(prev)
      // Keep cache in sync so refetch doesn't overwrite our optimistic state
      const cached = cache.get(cacheKey)
      if (cached) cache.set(cacheKey, { data: next, timestamp: cached.timestamp })
      writeCache(diskCacheKey, next, { repo, op: fetchFn.name || 'unnamed' })
      return next
    })
    if (opts.revalidate) {
      setTimeout(() => fetchData(true), 0)
    }
  }, [cacheKey, diskCacheKey, fetchData, fetchFn, repo])

  useEffect(() => {
    mountedRef.current = true
    if (enabled) fetchData(false)
    else setLoading(false) // a disabled hook is not loading; also un-sticks a true->false flip
    return () => {
      reqRef.current++ // eslint-disable-line react-hooks/exhaustive-deps
      mountedRef.current = false
    }
  }, [cacheKey, enabled]) // eslint-disable-line react-hooks/exhaustive-deps

  return { data, loading, error, refetch, mutate, isStale }
}
