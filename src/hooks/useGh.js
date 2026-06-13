/**
 * useGh.js — React hook that wraps executor calls with loading/error/data state
 * and an in-memory TTL cache.
 */

import { useState, useEffect, useRef, useCallback } from 'react'
import { logger } from '../utils.js'
import { cacheKey as makeDiskCacheKey, readCache, writeCache } from '../cache.js'
import { recordGhFailure, recordGhSuccess } from './useGhHealth.js'

// In-memory cache: key → { data, timestamp }
const cache = new Map()

const DEFAULT_TTL = 30_000 // 30 seconds

/**
 * useGh(fetchFn, deps, options)
 *
 * @param {Function} fetchFn - async function that returns data
 * @param {Array}    deps    - dependency array, used as cache key
 * @param {Object}   [options] - { ttl: number (ms) }
 * @param {number}   [options.ttl]
 * @returns {{ data, loading, error, refetch, mutate, isStale }}
 */
export function useGh(fetchFn, deps = [], { ttl = DEFAULT_TTL } = {}) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [isStale, setIsStale] = useState(false)
  const mountedRef = useRef(true)

  const cacheKey = JSON.stringify([fetchFn.name, ...deps])
  const repo = typeof deps[0] === 'string' ? deps[0] : process.env.GHUI_REPO
  const diskCacheKey = makeDiskCacheKey([repo, fetchFn.name, deps])
  const callSite = `${fetchFn.name || 'unnamed'}:${diskCacheKey}`

  const fetchData = useCallback(async (bypassCache = false) => {
    if (!mountedRef.current) return

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

    if (!bypassCache && diskCached) {
      setData(diskCached.payload)
      setLoading(false)
      setIsStale(true)
    } else {
      setLoading(true)
      setIsStale(false)
    }
    setError(null)

    try {
      const result = await fetchFn(...deps)
      if (!mountedRef.current) return
      cache.set(cacheKey, { data: result, timestamp: Date.now() })
      writeCache(diskCacheKey, result, { repo, op: fetchFn.name || 'unnamed' })
      setData(result)
      setError(null)
      setIsStale(false)
      recordGhSuccess(callSite)
      logger.info(`gh.${fetchFn.name || 'unnamed'} fetched data`, { cacheKey, component: 'useGh' })
    } catch (err) {
      if (!mountedRef.current) return
      setError(err)
      if (!diskCached && !cached) setData(null)
      setIsStale(Boolean(diskCached || cached))
      recordGhFailure(callSite, err)
      logger.error(`useGh: ${fetchFn.name || 'unnamed'}(${cacheKey}) failed`, err)
    } finally {
      if (mountedRef.current) {
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
    fetchData(false)
    return () => {
      mountedRef.current = false
    }
  }, [cacheKey]) // eslint-disable-line react-hooks/exhaustive-deps

  return { data, loading, error, refetch, mutate, isStale }
}
