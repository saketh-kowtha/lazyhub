/**
 * useGh.js — React hook that wraps executor calls with loading/error/data state
 * and an in-memory TTL cache.
 */

import { useState, useEffect, useRef, useCallback } from 'react'
import { logger } from '../utils.js'

// In-memory cache: key → { data, timestamp }
const cache = new Map()

const DEFAULT_TTL = 30_000 // 30 seconds

/**
 * useGh(fetchFn, deps, options)
 *
 * @param {Function} fetchFn - async function that returns data
 * @param {Array}    deps    - dependency array, used as cache key
 * @param {Object}   options - { ttl: number (ms) }
 * @param options.ttl
 * @returns {{ data, loading, error, refetch }}
 */
export function useGh(fetchFn, deps = [], { ttl = DEFAULT_TTL } = {}) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const mountedRef = useRef(true)

  const cacheKey = JSON.stringify([fetchFn.name, ...deps])

  const fetchData = useCallback(async (bypassCache = false) => {
    if (!mountedRef.current) return

    const now = Date.now()
    const cached = cache.get(cacheKey)

    if (!bypassCache && cached && now - cached.timestamp < ttl) {
      setData(cached.data)
      setLoading(false)
      setError(null)
      return
    }

    setLoading(true)
    setError(null)

    try {
      const result = await fetchFn(...deps)
      if (!mountedRef.current) return
      cache.set(cacheKey, { data: result, timestamp: Date.now() })
      setData(result)
      setError(null)
      logger.info(`gh.${fetchFn.name || 'unnamed'} fetched data`, { cacheKey, component: 'useGh' })
    } catch (err) {
      if (!mountedRef.current) return
      setError(err)
      setData(null)
      logger.error(`useGh: ${fetchFn.name || 'unnamed'}(${cacheKey}) failed`, err)
    } finally {
      if (mountedRef.current) {
        setLoading(false)
      }
    }
  }, [cacheKey, fetchFn, ttl]) // eslint-disable-line react-hooks/exhaustive-deps

  const refetch = useCallback(() => {
    fetchData(true)
  }, [fetchData])

  useEffect(() => {
    mountedRef.current = true
    fetchData(false)
    return () => {
      mountedRef.current = false
    }
  }, [cacheKey]) // eslint-disable-line react-hooks/exhaustive-deps

  return { data, loading, error, refetch }
}
