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
  // The disk read is remembered so fetchData does not read the same file again.
  const diskMemoRef = useRef(null)
  const readSeed = () => {
    const mem = cache.get(cacheKey)
    if (mem) return { data: mem.data, stale: Date.now() - mem.timestamp >= ttl }
    const disk = readCache(diskCacheKey)
    diskMemoRef.current = { key: diskCacheKey, value: disk }
    return disk ? { data: disk.payload, stale: true } : null
  }
  const [seed] = useState(readSeed)
  const [dataState, setData] = useState(seed ? seed.data : null)
  const [loadingState, setLoading] = useState(!seed)
  const [errorState, setError] = useState(null)
  const [isStaleState, setIsStale] = useState(Boolean(seed?.stale))
  // Re-seed when the key changes so a reused component never shows the previous key's data.
  const [seededKey, setSeededKey] = useState(cacheKey)
  // The seed is derived from cacheKey during render (#548): React discards this pass and
  // re-renders at once, but the values returned below already belong to the new key, so
  // no render, committed or not, ever pairs the new key with the previous key's data.
  let data = dataState, loading = loadingState, error = errorState, isStale = isStaleState
  if (seededKey !== cacheKey) {
    const next = readSeed()
    setSeededKey(cacheKey)
    setData(next ? next.data : null)
    setLoading(!next)
    setIsStale(Boolean(next?.stale))
    setError(null)
    data = next ? next.data : null
    loading = !next
    isStale = Boolean(next?.stale)
    error = null
  }
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
    const fresh = !bypassCache && cached && now - cached.timestamp < ttl
    let diskCached = null
    if (!fresh) {
      const memo = diskMemoRef.current
      diskMemoRef.current = null
      diskCached = memo && memo.key === diskCacheKey ? memo.value : readCache(diskCacheKey)
    }

    if (fresh) {
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
