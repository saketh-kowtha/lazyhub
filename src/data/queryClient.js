/**
 * queryClient.js — the one data path for reads (R2, #480).
 *
 * A small query layer under `useGh`:
 *  - structured keys (`['pr', repo, n]`), serialised once into a cache key;
 *  - one in-flight promise per key: identical keys share a fetch;
 *  - a request token per hook fetch, so a result for a key that is no longer current is
 *    dropped and can never overwrite newer data or clear a newer loading flag (#434);
 *  - a synchronous seed from a byte-budgeted LRU (and, when asked, the disk-cache
 *    mirror), so a revisit renders cached data on the first frame (#454, #457);
 *  - stale-while-revalidate with `isStale`;
 *  - infinite queries that keep pages by cursor, append the next page, never refetch an
 *    earlier page, refresh only page 1, and report `{loaded, total, hasMore, capped}`
 *    so a footer can say "N of M" (D16: never silently truncate).
 *
 * Writes (R3, #481): `runGh()` announces each finished write through `invalidation.js`; the
 * client marks every cached read for that repository stale (data kept for stale-while-
 * revalidate) and mounted queries revalidate in the background, so no pane needs a
 * "remember to refetch" call. `setQueryData` seeds an entry (a list row seeding its detail).
 *
 * Out of scope here (R4): prefetch.
 */

import { useState, useEffect, useRef, useCallback } from 'react'
import { onWrite } from './invalidation.js'
import { approxBytes, createLruCache, cacheIdentity, peekCache, readCacheAsync, writeCache } from '../cache.js'

export const QUERY_MAX_ENTRIES = 200
export const QUERY_MAX_BYTES = 64 * 1024 * 1024
export const DEFAULT_TTL = 30_000

/**
 * Serialise a structured key. Arrays and plain values only; the same parts always give
 * the same string.
 * @param {unknown} key
 */
export function keyString(key) {
  return JSON.stringify(Array.isArray(key) ? key : [key])
}

/**
 * Prefix a key with the current host and account so a cached entry is never served
 * across hosts or accounts (#520).
 * @param {...unknown} parts
 */
export function identityKey(...parts) {
  const { host, account } = cacheIdentity()
  return [host, account, ...parts]
}

/**
 * Create an isolated client (tests build their own; the app uses `queryClient`).
 * @param {{ maxEntries?: number, maxBytes?: number }} [options]
 */
export function createQueryClient({ maxEntries = QUERY_MAX_ENTRIES, maxBytes = QUERY_MAX_BYTES } = {}) {
  const makeCache = () => createLruCache(maxEntries, { maxBytes, sizeOf: entry => approxBytes(entry.data) })
  let cache = makeCache()
  /** @type {Map<string, { controller: AbortController, refs: number, settled: boolean, promise: Promise<any> }>} */
  const inflight = new Map()
  /** @type {Set<{ keyStr: string, run: () => void }>} */
  const subscribers = new Set()

  /**
   * The structured parts of a key string (always `keyString` output), without the
   * infinite-query marker.
   * @param {string} keyStr
   */
  function partsOf(keyStr) {
    const parts = JSON.parse(keyStr)
    return parts[0] === 'infinite' ? parts.slice(1) : parts
  }
  const sameValue = (/** @type {any} */ a, /** @type {any} */ b) =>
    typeof a === 'string' && typeof b === 'string' ? a.toLowerCase() === b.toLowerCase() : JSON.stringify(a) === JSON.stringify(b)

  const client = {
    /**
     * Cached `{ data, timestamp }` for a key string, or undefined.
     * @param {string} keyStr
     */
    get(keyStr) { return cache.get(keyStr) },
    /**
     * Store data for a key string (timestamp defaults to now).
     * @param {string} keyStr
     * @param {any} data
     * @param {number} [timestamp]
     */
    set(keyStr, data, timestamp = Date.now()) { cache.set(keyStr, { data, timestamp }) },
    /** @param {string} keyStr */
    delete(keyStr) { return cache.delete(keyStr) },
    /** Drop every cached entry and forget every in-flight fetch (tests). */
    reset() {
      for (const e of inflight.values()) e.controller.abort()
      inflight.clear()
      cache = makeCache()
    },
    stats: () => ({ size: cache.size, bytes: cache.bytes, inflight: inflight.size }),
    /** @param {string} keyStr */
    isInflight(keyStr) { return inflight.has(keyStr) },

    /**
     * Start (or join) the fetch for a key. Identical keys share one promise; `force`
     * starts a new fetch even when one is in flight (a manual refresh must not be
     * answered by a request that predates it), and the older one's result no longer
     * reaches the cache. `release()` says this caller no longer wants the result; when
     * every caller has released, the fetch is aborted through its `signal`.
     * @template T
     * @param {string} keyStr
     * @param {(ctx: { signal: AbortSignal }) => Promise<T>} fetcher
     * @param {{ force?: boolean, store?: boolean, persist?: { key: string, meta?: object } | null }} [options]
     * @returns {{ promise: Promise<T>, release: () => void, shared: boolean }}
     */
    fetch(keyStr, fetcher, { force = false, store = true, persist = null } = {}) {
      let entry = inflight.get(keyStr)
      const shared = Boolean(entry) && !force
      if (!entry || force) {
        const controller = new AbortController()
        const e = { controller, refs: 0, settled: false, promise: /** @type {Promise<any>} */ (Promise.resolve()) }
        e.promise = (async () => {
          try {
            const result = await fetcher({ signal: controller.signal })
            if (inflight.get(keyStr) === e && !controller.signal.aborted) {
              if (store) cache.set(keyStr, { data: result, timestamp: Date.now() })
              if (persist) writeCache(persist.key, result, persist.meta || {})
            }
            return result
          } finally {
            e.settled = true
            if (inflight.get(keyStr) === e) inflight.delete(keyStr)
          }
        })()
        inflight.set(keyStr, e)
        entry = e
      }
      const joined = entry
      joined.refs++
      let released = false
      return {
        promise: joined.promise,
        shared,
        release() {
          if (released) return
          released = true
          if (--joined.refs <= 0 && !joined.settled) {
            joined.controller.abort()
            if (inflight.get(keyStr) === joined) inflight.delete(keyStr)
          }
        },
      }
    },

    /**
     * Subscribe a mounted query to invalidation of its key. `run` should revalidate.
     * @param {string} keyStr
     * @param {() => void} run
     * @returns {() => void}
     */
    subscribe(keyStr, run) {
      const sub = { keyStr, run }
      subscribers.add(sub)
      return () => { subscribers.delete(sub) }
    },

    /**
     * Seed or replace the data for a structured key without fetching. `timestamp: 0`
     * seeds an entry that renders at once but counts as stale, so the owning view
     * revalidates it. `ifAbsent` never overwrites an existing entry (a fuller one wins).
     * @param {unknown[]} key
     * @param {any} data
     * @param {{ timestamp?: number, ifAbsent?: boolean }} [options]
     */
    setQueryData(key, data, { timestamp = Date.now(), ifAbsent = false } = {}) {
      const keyStr = keyString(key)
      if (ifAbsent && cache.get(keyStr)) return false
      cache.set(keyStr, { data, timestamp })
      return true
    },

    /** @param {unknown[]} key */
    getQueryData(key) { return cache.get(keyString(key))?.data },

    /**
     * Public write-invalidation API (`useMutation({ invalidates })` calls it with a structured
     * key array). Mark every entry whose key starts with `prefix` stale (the data stays, so a view
     * keeps showing it while it revalidates), forget fetches that started before this
     * call so their pre-write result cannot be stored, and tell mounted queries to
     * revalidate. String parts compare case-insensitively (GitHub names do).
     * @param {unknown[]} [prefix] default: everything
     * @returns {number} how many cached entries were marked stale
     */
    invalidate(prefix = []) {
      const matches = (/** @type {string} */ keyStr) => {
        const parts = partsOf(keyStr)
        return prefix.every((p, i) => sameValue(parts[i], p))
      }
      let marked = 0
      for (const keyStr of cache.keys()) {
        if (!matches(keyStr)) continue
        const entry = cache.get(keyStr)
        if (entry) { cache.set(keyStr, { data: entry.data, timestamp: 0 }); marked++ }
      }
      for (const [keyStr, e] of [...inflight]) {
        if (!matches(keyStr)) continue
        e.controller.abort()
        inflight.delete(keyStr)
      }
      for (const sub of [...subscribers]) if (matches(sub.keyStr)) sub.run()
      return marked
    },

    /**
     * Invalidate every read for a repository under the current host and account. A null
     * repository (a write that cannot be attributed) invalidates the whole identity.
     * Keys built by `identityKey(repo, ...)` are `[host, account, repo, ...]`.
     * @param {string | null} repo
     */
    invalidateRepo(repo) {
      const { host, account } = cacheIdentity()
      return client.invalidate(repo ? [host, account, repo] : [host, account])
    },
  }
  return client
}

/** The app-wide client. */
export const queryClient = createQueryClient()

// Every finished write marks its repository's cached reads stale and revalidates what is mounted.
onWrite(({ repo }) => { queryClient.invalidateRepo(repo) })

/**
 * What a query shows while it (re)fetches: cached data as stale; an invalidation
 * revalidating a view that already has data keeps it (stale, no loading frame); else loading.
 * @param {{ force: boolean, background: boolean, hasData: boolean, cached?: { data: any }, diskCached?: { payload: any } | null }} state
 * @returns {{ data?: any, loading?: boolean, stale: boolean }}
 */
function startView({ force, background, hasData, cached, diskCached }) {
  if (!force && (cached || diskCached)) return { data: cached ? cached.data : diskCached?.payload, loading: false, stale: true }
  if (background && hasData) return { stale: true }
  return { loading: true, stale: false }
}

/**
 * useQuery(key, fetcher, options)
 *
 * @template T
 * @param {unknown[]} key structured key
 * @param {(ctx: { signal: AbortSignal }) => Promise<T>} fetcher
 * @param {object} [options]
 * @param {number}  [options.ttl=30000] ms a cached value counts as fresh
 * @param {boolean} [options.enabled=true] false defers the fetch until it flips true
 * @param {{ key: string, meta?: object }} [options.persist] disk-cache entry for this query
 * @param {(result: T) => void} [options.onSuccess] called when the current request succeeds
 * @param {(error: unknown) => void} [options.onError] called when the current request fails
 * @param {() => void} [options.onCleanup] called when the owner unmounts or its key changes
 * @param {ReturnType<typeof createQueryClient>} [options.client]
 * @returns {{ data: T | null, loading: boolean, error: any, refetch: () => void,
 *   mutate: (updater: (prev: T | null) => T, opts?: { revalidate?: boolean }) => void, isStale: boolean }}
 */
export function useQuery(key, fetcher, options = {}) {
  const { ttl = DEFAULT_TTL, enabled = true, persist = null, onSuccess, onError, onCleanup, client = queryClient } = options
  const keyStr = keyString(key)

  // Stale-while-revalidate (#454): seed from the memory cache, then the disk-cache mirror
  // loaded at startup, synchronously. Never a file read: that would stall input (#455).
  const readSeed = () => {
    const mem = client.get(keyStr)
    if (mem) return { data: mem.data, stale: Date.now() - mem.timestamp >= ttl }
    const disk = persist ? peekCache(persist.key) : null
    return disk ? { data: disk.payload, stale: true } : null
  }
  const [seed] = useState(readSeed)
  const [dataState, setData] = useState(seed ? seed.data : null)
  const [loadingState, setLoading] = useState(!seed)
  const [errorState, setError] = useState(null)
  const [isStaleState, setIsStale] = useState(Boolean(seed?.stale))
  const [seededKey, setSeededKey] = useState(keyStr)
  // Derived from the key during render (#548): React discards this pass and re-renders at
  // once, but the values returned below already belong to the new key, so no render ever
  // pairs the new key with the previous key's data.
  let data = dataState, loading = loadingState, error = errorState, isStale = isStaleState
  if (seededKey !== keyStr) {
    const next = readSeed()
    setSeededKey(keyStr)
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
  const tokenRef = useRef(0) // request token: only the latest request may touch state (#434)
  const releaseRef = useRef(null)
  const latest = useRef({})
  latest.current = { fetcher, persist, onSuccess, onError, onCleanup }

  const hasDataRef = useRef(false)
  hasDataRef.current = data != null
  const enabledRef = useRef(enabled)
  enabledRef.current = enabled

  // `background`: an invalidation revalidates what is on screen, so a view that already
  // has data keeps it (marked stale) instead of dropping back to a loading frame.
  const fetchData = useCallback(async (force = false, background = false) => {
    if (!mountedRef.current) return
    const token = ++tokenRef.current
    const isCurrent = () => mountedRef.current && tokenRef.current === token
    releaseRef.current?.()
    releaseRef.current = null

    const cached = client.get(keyStr)
    const fresh = !force && cached && Date.now() - cached.timestamp < ttl
    const pDisk = latest.current.persist
    const diskCached = fresh || !pDisk ? null : peekCache(pDisk.key)

    if (fresh) {
      setData(cached.data)
      setLoading(false)
      setError(null)
      setIsStale(false)
      return
    }
    const view = startView({ force, background, hasData: hasDataRef.current, cached, diskCached })
    if (view.data !== undefined) setData(view.data)
    if (view.loading !== undefined) setLoading(view.loading)
    setIsStale(view.stale)
    setError(null)

    // Cold start (no memory/mirror hit): read the file asynchronously, concurrently with
    // the network call, and show it as stale data if it lands first.
    let settled = false
    let lateDisk = false
    if (!force && !cached && !diskCached && pDisk) {
      readCacheAsync(pDisk.key).then(disk => {
        if (!disk || settled || !isCurrent()) return
        lateDisk = true
        setData(disk.payload)
        setLoading(false)
        setIsStale(true)
      })
    }

    const call = client.fetch(keyStr, ctx => latest.current.fetcher(ctx), { force, persist: pDisk })
    releaseRef.current = call.release
    try {
      const result = await call.promise
      settled = true
      if (!isCurrent()) return
      setData(result)
      setError(null)
      setIsStale(false)
      latest.current.onSuccess?.(result)
    } catch (err) {
      settled = true
      if (!isCurrent()) return
      setError(err)
      const keep = Boolean(diskCached || cached || lateDisk) || (background && hasDataRef.current)
      if (!keep) setData(null)
      setIsStale(keep)
      latest.current.onError?.(err)
    } finally {
      if (isCurrent()) setLoading(false)
    }
  }, [keyStr, ttl, client])

  const refetch = useCallback(() => { fetchData(true) }, [fetchData])

  // A write invalidated this key: revalidate in the background (shares the one in-flight
  // fetch with any other view on the same key).
  useEffect(() => client.subscribe(keyStr, () => {
    if (mountedRef.current && enabledRef.current) fetchData(false, true)
  }), [client, keyStr, fetchData])

  /**
   * Optimistically update cached data without refetching. `updater` receives the current
   * data and returns the new data; `{ revalidate: true }` refetches afterwards.
   */
  const mutate = useCallback((updater, opts = {}) => {
    setData(prev => {
      const next = updater(prev)
      const cached = client.get(keyStr)
      if (cached) client.set(keyStr, next, cached.timestamp) // keep cache in sync so refetch doesn't undo it
      const p = latest.current.persist
      if (p) writeCache(p.key, next, p.meta || {})
      return next
    })
    if (opts.revalidate) setTimeout(() => fetchData(true), 0)
  }, [keyStr, client, fetchData])

  useEffect(() => {
    mountedRef.current = true
    const cleanupFor = latest.current.onCleanup // the owner of THIS key, not of the next render's
    if (enabled) fetchData(false)
    else setLoading(false) // a disabled hook is not loading; also un-sticks a true->false flip
    return () => {
      tokenRef.current++ // eslint-disable-line react-hooks/exhaustive-deps
      mountedRef.current = false
      releaseRef.current?.()
      releaseRef.current = null
      cleanupFor?.()
    }
  }, [keyStr, enabled]) // eslint-disable-line react-hooks/exhaustive-deps

  return { data, loading, error, refetch, mutate, isStale }
}

const defaultItems = page => (Array.isArray(page) ? page : Array.isArray(page?.items) ? page.items : [])

/**
 * useInfiniteQuery(key, fetchPage, options): cursor-paged lists.
 *
 * `fetchPage({ cursor, signal })` returns one page; `getNextCursor(page)` returns the
 * cursor for the page after it, or null/undefined at the end. Pages are kept by cursor:
 * `fetchNextPage()` appends the next page and never refetches an earlier one, and
 * `refetch()` (the `r` key) refreshes page 1 only, leaving the later pages in place.
 *
 * @template P
 * @param {unknown[]} key
 * @param {(ctx: { cursor: any, signal: AbortSignal }) => Promise<P>} fetchPage
 * @param {object} options
 * @param {(page: P) => any} options.getNextCursor
 * @param {(page: P) => unknown[]} [options.getItems] default: the page itself, or `page.items`
 * @param {(page: P) => number | null | undefined} [options.getTotal] total across all pages, when known
 * @param {(page: P) => boolean} [options.getCapped] true when the source stopped at a cap
 * @param {number} [options.ttl]
 * @param {boolean} [options.enabled]
 * @param {ReturnType<typeof createQueryClient>} [options.client]
 * @returns {{ pages: P[], items: unknown[], loaded: number, total: number | null, hasMore: boolean,
 *   capped: boolean, loading: boolean, loadingMore: boolean, error: any, isStale: boolean,
 *   fetchNextPage: () => void, refetch: () => void }}
 */
export function useInfiniteQuery(key, fetchPage, options) {
  const {
    getNextCursor, getItems = defaultItems, getTotal, getCapped,
    ttl = DEFAULT_TTL, enabled = true, client = queryClient,
  } = options
  const keyStr = keyString(['infinite', ...key])

  // Cache entry: { pages: [{ cursor, data }] }. Each page is fetched under its own
  // in-flight key so concurrent identical page requests share one promise.
  const readSeed = () => {
    const mem = client.get(keyStr)
    return mem ? { pages: mem.data, stale: Date.now() - mem.timestamp >= ttl } : null
  }
  const [seed] = useState(readSeed)
  const [pagesState, setPages] = useState(seed ? seed.pages : [])
  const [loadingState, setLoading] = useState(!seed)
  const [loadingMore, setLoadingMore] = useState(false)
  const [errorState, setError] = useState(null)
  const [staleState, setStale] = useState(Boolean(seed?.stale))
  const [seededKey, setSeededKey] = useState(keyStr)
  let pages = pagesState, loading = loadingState, error = errorState, isStale = staleState, more = loadingMore
  if (seededKey !== keyStr) {
    const next = readSeed()
    setSeededKey(keyStr)
    setPages(next ? next.pages : [])
    setLoading(!next)
    setLoadingMore(false)
    setStale(Boolean(next?.stale))
    setError(null)
    pages = next ? next.pages : []
    loading = !next
    more = false
    isStale = Boolean(next?.stale)
    error = null
  }

  const mountedRef = useRef(true)
  const tokenRef = useRef(0) // bumped on key change/unmount: drops every in-flight result of the old key
  const firstRef = useRef(0)  // request token for page 1 refreshes
  const moreRef = useRef(false)
  const pagesRef = useRef(pages)
  pagesRef.current = pages
  const releases = useRef(new Set())
  const latest = useRef({})
  latest.current = { fetchPage, getNextCursor }

  const commit = useCallback(next => {
    pagesRef.current = next
    setPages(next)
    client.set(keyStr, next)
  }, [client, keyStr])

  const request = useCallback((cursor, force) => {
    const call = client.fetch(keyString([...JSON.parse(keyStr), { cursor: cursor ?? null }]),
      ctx => latest.current.fetchPage({ cursor, signal: ctx.signal }), { force, store: false })
    releases.current.add(call.release)
    return call
  }, [client, keyStr])

  // Page 1 only: first load, a stale revisit, or `r`. Later pages stay as they are.
  const loadFirst = useCallback(async (force) => {
    if (!mountedRef.current) return
    const epoch = tokenRef.current
    const token = ++firstRef.current
    const isCurrent = () => mountedRef.current && tokenRef.current === epoch && firstRef.current === token
    const cached = client.get(keyStr)
    if (!force && cached && Date.now() - cached.timestamp < ttl) {
      setPages(cached.data); setLoading(false); setError(null); setStale(false)
      return
    }
    if (pagesRef.current.length > 0) setStale(true)
    else setLoading(true)
    setError(null)
    const call = request(null, force)
    try {
      const data = await call.promise
      if (!isCurrent()) return
      const rest = pagesRef.current.slice(1)
      commit([{ cursor: null, data }, ...rest])
      setStale(false)
    } catch (err) {
      if (!isCurrent()) return
      setError(err)
    } finally {
      call.release()
      releases.current.delete(call.release)
      if (isCurrent()) setLoading(false)
    }
  }, [client, keyStr, ttl, request, commit])

  const fetchNextPage = useCallback(async () => {
    const current = pagesRef.current
    if (!mountedRef.current || moreRef.current || current.length === 0) return
    const cursor = latest.current.getNextCursor(current[current.length - 1].data)
    if (cursor == null) return
    const epoch = tokenRef.current
    const count = current.length
    moreRef.current = true
    setLoadingMore(true)
    setError(null)
    const call = request(cursor, false)
    try {
      const data = await call.promise
      // Drop if the key changed, or if the list was reshaped while this was in flight.
      if (!mountedRef.current || tokenRef.current !== epoch || pagesRef.current.length !== count) return
      commit([...pagesRef.current, { cursor, data }])
    } catch (err) {
      if (mountedRef.current && tokenRef.current === epoch) setError(err)
    } finally {
      call.release()
      releases.current.delete(call.release)
      if (tokenRef.current === epoch) { moreRef.current = false; if (mountedRef.current) setLoadingMore(false) }
    }
  }, [request, commit])

  const refetch = useCallback(() => { loadFirst(true) }, [loadFirst])

  // A write invalidated this list: refresh page 1 in the background, keep later pages.
  const enabledRef = useRef(enabled)
  enabledRef.current = enabled
  useEffect(() => client.subscribe(keyStr, () => {
    if (mountedRef.current && enabledRef.current) loadFirst(false)
  }), [client, keyStr, loadFirst])

  useEffect(() => {
    mountedRef.current = true
    moreRef.current = false
    if (enabled) loadFirst(false)
    else setLoading(false)
    return () => {
      tokenRef.current++ // eslint-disable-line react-hooks/exhaustive-deps
      mountedRef.current = false
      for (const r of releases.current) r() // eslint-disable-line react-hooks/exhaustive-deps
      releases.current.clear() // eslint-disable-line react-hooks/exhaustive-deps
    }
  }, [keyStr, enabled]) // eslint-disable-line react-hooks/exhaustive-deps

  const lastPage = pages.length > 0 ? pages[pages.length - 1].data : null
  const items = pages.flatMap(p => getItems(p.data))
  const total = lastPage && getTotal ? (getTotal(lastPage) ?? null) : null
  const hasMore = lastPage != null && getNextCursor(lastPage) != null
  const capped = Boolean(getCapped && pages.some(p => getCapped(p.data)))

  return {
    pages: pages.map(p => p.data), items, loaded: items.length, total, hasMore, capped,
    loading, loadingMore: more, error, isStale, fetchNextPage, refetch,
  }
}
