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
 * Lazy updates (V1, #597): see docs/bugs/597-v1-query-semantics.md.
 *  - a refetch is merged into the cached value by stable id (`replaceEqualDeep`): unchanged rows
 *    keep their identity and an identical revalidate changes no state, so it draws no frame;
 *  - hook state is one object updated by one `setState` per event. Ink 4 renders through a
 *    legacy React root (no auto-batching outside event handlers), so separate setStates in an
 *    async callback would each commit and paint an intermediate frame;
 *  - cache notifications (data watchers, invalidation revalidations) are coalesced on a microtask;
 *  - a body mode is derived (`renderMode.js`): `loading` is kept for unmigrated views and means
 *    `isLoading` (no data yet and a request in flight); `isFetching` is any request in flight;
 *  - freshness classes (`freshness.js`) and a lazy, timer-free GC of entries nobody watches.
 *
 * Out of scope here (R4): prefetch.
 */

import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { onWrite } from './invalidation.js'
import { replaceEqualDeep } from './structuralShare.js'
import { deriveRenderMode, SKELETON_DELAY_MS } from './renderMode.js'
import { GC_MIN_UNUSED_MS } from './freshness.js'
import { createNotifier } from './notifier.js'
import { approxBytes, createLruCache, cacheIdentity, peekCache, readCacheAsync, writeCache } from '../cache.js'

export const QUERY_MAX_ENTRIES = 200
export const QUERY_MAX_BYTES = 64 * 1024 * 1024
export const DEFAULT_TTL = 30_000
export { FRESHNESS } from './freshness.js'
export { replaceEqualDeep }

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

/**
 * Create an isolated client (tests build their own; the app uses `queryClient`).
 * @param {{ maxEntries?: number, maxBytes?: number, gcMs?: number }} [options] `gcMs`: how long an entry
 *   nobody watches is kept before the lazy sweep may drop it (the LRU caps may evict earlier)
 */
export function createQueryClient({ maxEntries = QUERY_MAX_ENTRIES, maxBytes = QUERY_MAX_BYTES, gcMs = GC_MIN_UNUSED_MS } = {}) {
  const makeCache = () => createLruCache(maxEntries, { maxBytes, sizeOf: entry => approxBytes(entry.data) })
  let cache = makeCache()
  /** @type {Map<string, { controller: AbortController, refs: number, settled: boolean, promise: Promise<any> }>} */
  const inflight = new Map()
  /** @type {Set<{ keyStr: string, run: () => void }>} */
  const subscribers = new Set()
  /** @type {Map<string, Set<() => void>>} data watchers (mounted hooks) by key string */
  const watchers = new Map()
  /** @type {Map<string, number>} key string -> last time it was read, written or released by a watcher */
  const lastUsed = new Map()
  const notifier = createNotifier(watchers, subscribers)
  let lastSweep = Date.now()

  /** @param {string} keyStr */
  function notifyData(keyStr) {
    lastUsed.set(keyStr, Date.now())
    notifier.data(keyStr)
  }
  /**
   * Drop entries nobody watches that have been unused for `gcMs`. Run lazily from writes (no
   * timer, nothing keeps the process alive); the LRU caps bound memory in between.
   * @param {number} [now]
   */
  function sweep(now = Date.now()) {
    lastSweep = now
    let dropped = 0
    for (const keyStr of cache.keys()) {
      if (watchers.get(keyStr)?.size || inflight.has(keyStr)) continue
      if (now - (lastUsed.get(keyStr) ?? 0) < gcMs) continue
      cache.delete(keyStr)
      lastUsed.delete(keyStr)
      dropped++
    }
    for (const keyStr of lastUsed.keys()) if (!cache.has(keyStr)) lastUsed.delete(keyStr)
    return dropped
  }
  const maybeSweep = () => { if (Date.now() - lastSweep >= Math.min(gcMs, 60_000)) sweep() }

  const client = {
    /**
     * Cached `{ data, timestamp }` for a key string, or undefined.
     * @param {string} keyStr
     */
    get(keyStr) { const entry = cache.get(keyStr); if (entry) lastUsed.set(keyStr, Date.now()); return entry },
    /**
     * Store data for a key string (timestamp defaults to now) and tell its watchers (coalesced).
     * @param {string} keyStr
     * @param {any} data
     * @param {number} [timestamp]
     */
    set(keyStr, data, timestamp = Date.now()) {
      cache.set(keyStr, { data, timestamp })
      notifyData(keyStr)
      maybeSweep()
    },
    /** @param {string} keyStr */
    delete(keyStr) { lastUsed.delete(keyStr); return cache.delete(keyStr) },
    /** Drop every cached entry and forget every in-flight fetch (tests). */
    reset() {
      for (const e of inflight.values()) e.controller.abort()
      inflight.clear()
      notifier.clear()
      lastUsed.clear()
      cache = makeCache()
    },
    stats: () => ({ size: cache.size, bytes: cache.bytes, inflight: inflight.size }),
    /**
     * Run the unused-entry sweep now (tests); returns how many entries it dropped.
     * @param {number} [now]
     */
    gc: now => sweep(now),
    /**
     * Watch the data of a key: `fn` runs (once per microtask, however many writes) after the cache
     * entry changed. A watched entry is never swept. Returns the unwatch function.
     * @param {string} keyStr
     * @param {() => void} fn
     * @returns {() => void}
     */
    watch(keyStr, fn) {
      let set = watchers.get(keyStr)
      if (!set) watchers.set(keyStr, (set = new Set()))
      set.add(fn)
      return () => {
        const cur = watchers.get(keyStr)
        cur?.delete(fn)
        if (cur && cur.size === 0) watchers.delete(keyStr)
        lastUsed.set(keyStr, Date.now())
      }
    },
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
              // Merge into the cached value: unchanged rows keep their identity (V1, #597).
              const prev = store ? cache.get(keyStr) : undefined
              const shared = prev ? replaceEqualDeep(prev.data, result) : result
              if (store) { cache.set(keyStr, { data: shared, timestamp: Date.now() }); notifyData(keyStr); maybeSweep() }
              if (persist) writeCache(persist.key, shared, persist.meta || {})
              return shared
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
      const prev = cache.get(keyStr)
      cache.set(keyStr, { data: prev ? replaceEqualDeep(prev.data, data) : data, timestamp })
      notifyData(keyStr)
      maybeSweep()
      return true
    },

    /**
     * Patch cached data in place (an optimistic update): `updater(prev)` returns the new value,
     * merged by identity with the old one. The entry keeps its timestamp, mounted queries on the key
     * follow on the next microtask, and nothing is fetched. No-op (false) when nothing is cached.
     * @param {unknown[]} key
     * @param {(prev: any) => any} updater
     */
    updateQueryData(key, updater) {
      const keyStr = keyString(key)
      const prev = cache.get(keyStr)
      if (!prev) return false
      const next = replaceEqualDeep(prev.data, updater(prev.data))
      if (next === prev.data) return true
      cache.set(keyStr, { data: next, timestamp: prev.timestamp })
      notifyData(keyStr)
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
      // Revalidations are coalesced on a microtask: one run per mounted query however many
      // invalidations arrive in the same tick (V1, #597).
      for (const sub of subscribers) if (matches(sub.keyStr)) notifier.run(sub)
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
// A declared write (src/data/mutations) already patched and invalidated exactly what it touches.
onWrite(({ repo, declared }) => { if (!declared) queryClient.invalidateRepo(repo) })


/**
 * One state object, one `setState` per event. Ink 4 renders through a legacy React root, so
 * `setState` calls made from an async callback are not batched: separate setters for data,
 * loading, error and stale would commit (and paint) an intermediate frame each. `patch` merges
 * fields in a single update and returns the same state object when nothing changed, so an
 * identical result re-renders nothing.
 * @template {Record<string, any>} S
 * @param {() => S} init
 * @returns {[S, (p: Partial<S> | ((prev: S) => Partial<S>)) => void, (next: S) => void]}
 */
function useBag(init) {
  const [state, set] = useState(init)
  const patch = useCallback(p => set(prev => {
    const next = typeof p === 'function' ? p(prev) : p
    for (const k in next) if (!Object.is(prev[k], next[k])) return { ...prev, ...next }
    return prev
  }), [])
  return [state, patch, set]
}

/**
 * True once `pending` has held for SKELETON_DELAY_MS under this key. Under the delay a view keeps
 * its previous frame; the timer is cleared the moment the request settles.
 * @param {boolean} pending
 * @param {string} keyStr
 */
function useSkeletonDue(pending, keyStr) {
  const [dueKey, setDueKey] = useState(/** @type {string | null} */ (null))
  const dueRef = useRef(/** @type {string | null} */ (null)) // a setter call, even a no-op one, can cost a render
  useEffect(() => {
    if (!pending) {
      if (dueRef.current !== null) { dueRef.current = null; setDueKey(null) }
      return undefined
    }
    const timer = setTimeout(() => { dueRef.current = keyStr; setDueKey(keyStr) }, SKELETON_DELAY_MS)
    return () => clearTimeout(timer)
  }, [pending, keyStr])
  return pending && dueKey === keyStr
}

/**
 * What a query shows while it (re)fetches: cached data as stale; an invalidation
 * revalidating a view that already has data keeps it (stale); else nothing new.
 * @param {{ force: boolean, background: boolean, hasData: boolean, cached?: { data: any }, diskCached?: { payload: any } | null }} state
 * @returns {{ data?: any, stale: boolean }}
 */
function startView({ force, background, hasData, cached, diskCached }) {
  if (!force && (cached || diskCached)) return { data: cached ? cached.data : diskCached?.payload, stale: true }
  if (background && hasData) return { stale: true }
  return { stale: false }
}

/**
 * useQuery(key, fetcher, options)
 *
 * Returned fields:
 *  - `data`, `error`, `refetch`, `mutate`, `isStale` as before;
 *  - `isLoading`: no data yet and a request in flight. `loading` is the same value, kept for
 *    views that have not moved to `QueryBoundary` (it no longer goes true for a refetch of data
 *    already on screen, so a manual refresh or revalidate cannot blank a list);
 *  - `isFetching`: any request in flight, a background revalidate included (feed the header cell);
 *  - `mode`: the derived body mode (`skeleton | pending | data | empty | error`, see renderMode.js);
 *    `skeletonDue` is the 150 ms delay having elapsed, for `QueryBoundary`;
 *  - `isPlaceholderData`: the rows belong to the previous key (`keepPreviousData` only).
 *
 * @template T
 * @param {unknown[]} key structured key
 * @param {(ctx: { signal: AbortSignal }) => Promise<T>} fetcher
 * @param {object} [options]
 * @param {number}  [options.ttl=30000] ms a cached value counts as fresh (`staleTime` is an alias; Infinity: fresh while the key is unchanged)
 * @param {number}  [options.staleTime] alias of `ttl`
 * @param {boolean} [options.enabled=true] false defers the fetch until it flips true
 * @param {boolean} [options.keepPreviousData=false] on a key change with nothing cached, keep the previous key's rows
 *   (flagged `isPlaceholderData`) until the new data lands, instead of dropping to no data
 * @param {{ key: string, meta?: object }} [options.persist] disk-cache entry for this query
 * @param {(result: T) => void} [options.onSuccess] called when the current request succeeds
 * @param {(error: unknown) => void} [options.onError] called when the current request fails
 * @param {() => void} [options.onCleanup] called when the owner unmounts or its key changes
 * @param {ReturnType<typeof createQueryClient>} [options.client]
 */
export function useQuery(key, fetcher, options = {}) {
  const { persist = null, onSuccess, onError, onCleanup, enabled = true, keepPreviousData = false, client = queryClient } = options
  const ttl = options.staleTime ?? options.ttl ?? DEFAULT_TTL
  const keyStr = keyString(key)

  // Stale-while-revalidate (#454): seed from the memory cache, then the disk-cache mirror
  // loaded at startup, synchronously. Never a file read: that would stall input (#455).
  const readSeed = () => {
    const mem = client.get(keyStr)
    if (mem) return { data: mem.data, stale: Date.now() - mem.timestamp >= ttl }
    const disk = persist ? peekCache(persist.key) : null
    return disk ? { data: disk.payload, stale: true } : null
  }
  /** @param {any} prev */
  const build = prev => {
    const seed = readSeed()
    const keep = keepPreviousData && !seed && prev?.data != null
    return {
      keyStr,
      data: seed ? seed.data : keep ? prev.data : null,
      error: /** @type {any} */ (null),
      isStale: seed ? seed.stale : keep,
      fetching: Boolean(enabled) && (!seed || seed.stale),
      isPlaceholder: keep,
    }
  }
  const [state, patch, replace] = useBag(() => build(null))
  // Derived from the key during render (#548): React discards this pass and re-renders at
  // once, but the values returned below already belong to the new key, so no render ever
  // pairs the new key with the previous key's data.
  let cur = state
  if (state.keyStr !== keyStr) { cur = build(state); replace(cur) }
  const { data, error, isStale, fetching, isPlaceholder } = cur
  const isLoading = data == null && fetching
  const skeletonDue = useSkeletonDue(isLoading, keyStr)

  const mountedRef = useRef(true)
  const tokenRef = useRef(0) // request token: only the latest request may touch state (#434)
  const releaseRef = useRef(null)
  const ownFetchRef = useRef(false) // this hook's own fetch is applying the result: ignore watcher echoes
  const latest = useRef({})
  latest.current = { fetcher, persist, onSuccess, onError, onCleanup }

  const dataRef = useRef(data)
  dataRef.current = data
  const placeholderRef = useRef(isPlaceholder)
  placeholderRef.current = isPlaceholder
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
      ownFetchRef.current = false
      patch({ data: cached.data, error: null, isStale: false, fetching: false, isPlaceholder: false })
      return
    }
    const view = startView({ force, background, hasData: dataRef.current != null && !placeholderRef.current, cached, diskCached })
    patch({ ...(view.data !== undefined ? { data: view.data, isPlaceholder: false } : {}), isStale: view.stale, error: null, fetching: true })

    // Cold start (no memory/mirror hit): read the file asynchronously, concurrently with
    // the network call, and show it as stale data if it lands first.
    let settled = false
    if (!force && !cached && !diskCached && pDisk) {
      readCacheAsync(pDisk.key).then(disk => {
        if (!disk || settled || !isCurrent()) return
        patch({ data: disk.payload, isStale: true, isPlaceholder: false })
      })
    }

    const call = client.fetch(keyStr, ctx => latest.current.fetcher(ctx), { force, persist: pDisk })
    releaseRef.current = call.release
    ownFetchRef.current = true
    try {
      const result = await call.promise
      settled = true
      if (!isCurrent()) return
      ownFetchRef.current = false
      // Merge by identity: an identical result is the very same object, so nothing re-renders.
      const shared = placeholderRef.current ? result : replaceEqualDeep(dataRef.current, result)
      patch({ data: shared, error: null, isStale: false, fetching: false, isPlaceholder: false })
      latest.current.onSuccess?.(shared)
    } catch (err) {
      settled = true
      if (!isCurrent()) return
      ownFetchRef.current = false
      // Data already on screen stays under the failure (a placeholder belongs to another key: dropped).
      const keep = dataRef.current != null && !placeholderRef.current
      patch({ error: err, data: keep ? dataRef.current : null, isStale: keep, fetching: false, isPlaceholder: false })
      latest.current.onError?.(err)
    }
  }, [keyStr, ttl, client, patch])

  const refetch = useCallback(() => { fetchData(true) }, [fetchData])

  // A write invalidated this key: revalidate in the background (shares the one in-flight
  // fetch with any other view on the same key).
  useEffect(() => client.subscribe(keyStr, () => {
    if (mountedRef.current && enabledRef.current) fetchData(false, true)
  }), [client, keyStr, fetchData])

  // The cache entry changed under us (an optimistic patch, a seed, another view's fetch):
  // follow it, once per microtask however many writes there were.
  useEffect(() => client.watch(keyStr, () => {
    if (!mountedRef.current || ownFetchRef.current) return
    const entry = client.get(keyStr)
    if (!entry || (entry.data === dataRef.current && !placeholderRef.current)) return
    patch({ data: entry.data, isStale: Date.now() - entry.timestamp >= ttl, isPlaceholder: false })
  }), [client, keyStr, ttl, patch])

  /**
   * Optimistically update cached data without refetching. `updater` receives the current
   * data and returns the new data (merged by identity with it); `{ revalidate: true }`
   * refetches afterwards.
   */
  const mutate = useCallback((updater, opts = {}) => {
    const next = replaceEqualDeep(dataRef.current, updater(dataRef.current))
    dataRef.current = next
    patch({ data: next, isPlaceholder: false })
    const cached = client.get(keyStr)
    if (cached) client.set(keyStr, next, cached.timestamp) // keep cache in sync so refetch doesn't undo it
    const p = latest.current.persist
    if (p) writeCache(p.key, next, p.meta || {})
    if (opts.revalidate) setTimeout(() => fetchData(true), 0)
  }, [keyStr, client, fetchData, patch])

  useEffect(() => {
    mountedRef.current = true
    const cleanupFor = latest.current.onCleanup // the owner of THIS key, not of the next render's
    if (enabled) fetchData(false)
    else patch({ fetching: false }) // a disabled hook is not loading; also un-sticks a true->false flip
    return () => {
      tokenRef.current++ // eslint-disable-line react-hooks/exhaustive-deps
      mountedRef.current = false
      ownFetchRef.current = false // eslint-disable-line react-hooks/exhaustive-deps
      releaseRef.current?.()
      releaseRef.current = null
      cleanupFor?.()
    }
  }, [keyStr, enabled]) // eslint-disable-line react-hooks/exhaustive-deps

  const mode = deriveRenderMode({ data, error, isLoading, skeletonDue })
  return {
    data, loading: isLoading, isLoading, isFetching: fetching, error, refetch, mutate, isStale,
    mode, skeletonDue, isPlaceholderData: isPlaceholder,
  }
}

const defaultItems = page => (Array.isArray(page) ? page : Array.isArray(page?.items) ? page.items : [])

/**
 * useInfiniteQuery(key, fetchPage, options): cursor-paged lists.
 *
 * `fetchPage({ cursor, signal })` returns one page; `getNextCursor(page)` returns the
 * cursor for the page after it, or null/undefined at the end. Pages are kept by cursor:
 * `fetchNextPage()` appends the next page and never refetches an earlier one, and
 * `refetch()` (the `r` key) refreshes page 1 only, leaving the later pages in place.
 * A refreshed page 1 is merged into the old one by identity (an identical page changes
 * nothing). Also returns `isLoading`/`isFetching`/`mode`/`skeletonDue` as `useQuery` does;
 * `loading` is `isLoading`.
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
 * @param {number} [options.staleTime] alias of `ttl`
 * @param {boolean} [options.enabled]
 * @param {ReturnType<typeof createQueryClient>} [options.client]
 */
export function useInfiniteQuery(key, fetchPage, options) {
  const {
    getNextCursor, getItems = defaultItems, getTotal, getCapped, enabled = true, client = queryClient,
  } = options
  const ttl = options.staleTime ?? options.ttl ?? DEFAULT_TTL
  const keyStr = keyString(['infinite', ...key])

  // Cache entry: { pages: [{ cursor, data }] }. Each page is fetched under its own
  // in-flight key so concurrent identical page requests share one promise.
  const readSeed = () => {
    const mem = client.get(keyStr)
    return mem ? { pages: mem.data, stale: Date.now() - mem.timestamp >= ttl } : null
  }
  const build = () => {
    const seed = readSeed()
    return {
      keyStr,
      pages: /** @type {Array<{ cursor: any, data: any }>} */ (seed ? seed.pages : []),
      error: /** @type {any} */ (null),
      isStale: Boolean(seed?.stale),
      fetching: Boolean(enabled) && (!seed || seed.stale),
      loadingMore: false,
    }
  }
  const [state, patch, replace] = useBag(build)
  let cur = state
  if (state.keyStr !== keyStr) { cur = build(); replace(cur) }
  const { pages, error, isStale, fetching, loadingMore: more } = cur
  const isLoading = pages.length === 0 && fetching
  const skeletonDue = useSkeletonDue(isLoading, keyStr)

  const mountedRef = useRef(true)
  const tokenRef = useRef(0) // bumped on key change/unmount: drops every in-flight result of the old key
  const firstRef = useRef(0)  // request token for page 1 refreshes
  const moreRef = useRef(false)
  const pagesRef = useRef(pages)
  pagesRef.current = pages
  const releases = useRef(new Set())
  const latest = useRef({})
  latest.current = { fetchPage, getNextCursor }

  const commit = useCallback((next, extra = {}) => {
    pagesRef.current = next
    patch({ pages: next, ...extra })
    client.set(keyStr, next)
  }, [client, keyStr, patch])

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
      patch({ pages: cached.data, fetching: false, error: null, isStale: false })
      return
    }
    patch({ isStale: pagesRef.current.length > 0, fetching: true, error: null })
    const call = request(null, force)
    try {
      const data = await call.promise
      if (!isCurrent()) return
      const old = pagesRef.current[0]
      const shared = old ? replaceEqualDeep(old.data, data) : data
      if (old && shared === old.data) {
        // Nothing changed: keep the very same pages array (no re-render of the list), refresh the clock.
        client.set(keyStr, pagesRef.current)
        patch({ isStale: false, fetching: false })
      } else {
        commit([{ cursor: null, data: shared }, ...pagesRef.current.slice(1)], { isStale: false, fetching: false })
      }
    } catch (err) {
      if (!isCurrent()) return
      patch({ error: err, fetching: false })
    } finally {
      call.release()
      releases.current.delete(call.release)
    }
  }, [client, keyStr, ttl, request, commit, patch])

  const fetchNextPage = useCallback(async () => {
    const current = pagesRef.current
    if (!mountedRef.current || moreRef.current || current.length === 0) return
    const cursor = latest.current.getNextCursor(current[current.length - 1].data)
    if (cursor == null) return
    const epoch = tokenRef.current
    const count = current.length
    moreRef.current = true
    patch({ loadingMore: true, error: null })
    const call = request(cursor, false)
    try {
      const data = await call.promise
      // Drop if the key changed, or if the list was reshaped while this was in flight.
      if (!mountedRef.current || tokenRef.current !== epoch || pagesRef.current.length !== count) return
      commit([...pagesRef.current, { cursor, data }])
    } catch (err) {
      if (mountedRef.current && tokenRef.current === epoch) patch({ error: err })
    } finally {
      call.release()
      releases.current.delete(call.release)
      if (tokenRef.current === epoch) { moreRef.current = false; if (mountedRef.current) patch({ loadingMore: false }) }
    }
  }, [request, commit, patch])

  const refetch = useCallback(() => { loadFirst(true) }, [loadFirst])

  // A write invalidated this list: refresh page 1 in the background, keep later pages.
  const enabledRef = useRef(enabled)
  enabledRef.current = enabled
  useEffect(() => client.subscribe(keyStr, () => {
    if (mountedRef.current && enabledRef.current) loadFirst(false)
  }), [client, keyStr, loadFirst])
  // Mounted lists are watched, so the sweep never drops an entry that is on screen.
  useEffect(() => client.watch(keyStr, () => {}), [client, keyStr])

  useEffect(() => {
    mountedRef.current = true
    moreRef.current = false
    if (enabled) loadFirst(false)
    else patch({ fetching: false })
    return () => {
      tokenRef.current++ // eslint-disable-line react-hooks/exhaustive-deps
      mountedRef.current = false
      for (const r of releases.current) r() // eslint-disable-line react-hooks/exhaustive-deps
      releases.current.clear() // eslint-disable-line react-hooks/exhaustive-deps
    }
  }, [keyStr, enabled]) // eslint-disable-line react-hooks/exhaustive-deps

  // Memoised on the pages array so an unchanged list hands back the very same `items`.
  const items = useMemo(() => pages.flatMap(p => getItems(p.data)), [pages]) // eslint-disable-line react-hooks/exhaustive-deps
  const pageData = useMemo(() => pages.map(p => p.data), [pages])
  const lastPage = pages.length > 0 ? pages[pages.length - 1].data : null
  const total = lastPage && getTotal ? (getTotal(lastPage) ?? null) : null
  const hasMore = lastPage != null && getNextCursor(lastPage) != null
  const capped = Boolean(getCapped && pages.some(p => getCapped(p.data)))
  const mode = deriveRenderMode({ data: pages.length > 0 ? items : null, error, isLoading, skeletonDue })

  return {
    pages: pageData, items, loaded: items.length, total, hasMore, capped,
    loading: isLoading, isLoading, isFetching: fetching, loadingMore: more, error, isStale, mode, skeletonDue,
    fetchNextPage, refetch,
  }
}
