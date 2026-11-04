/**
 * cache.js — stale-while-revalidate disk cache for gh-backed panes.
 *
 * The TUI input thread never touches the disk cache synchronously (#455):
 *   - reads for the first frame come from `peekCache()`, a bounded in-memory
 *     mirror filled once at startup by `warmCache()` and kept current by writes;
 *   - `writeCache()` updates the mirror immediately and defers JSON.stringify and
 *     the file write to a debounced async flush;
 *   - eviction and repo invalidation work from an in-memory index (key -> size,
 *     mtime, repo) and bounded async directory scans, never a full read+parse of
 *     every file.
 * `readCache()` / `listCacheEntries()` stay synchronous for the one-shot CLI and
 * daemon callers that are not on a key-handling path.
 */

import { closeSync, existsSync, openSync, readFileSync, readSync, readdirSync, rmSync, statSync } from 'fs'
import { mkdir, open, readFile, readdir, rename, rm, stat, chmod } from 'fs/promises'
import { createHash, randomBytes } from 'crypto'
import { homedir } from 'os'
import { join } from 'path'
import { ensurePrivateDir, writePrivateFile } from './secure-fs.js'

export const CACHE_DIR = process.env.LAZYHUB_CACHE_DIR || join(homedir(), '.cache', 'lazyhub', 'data')
const MAX_BYTES = 50 * 1024 * 1024
const MAX_ENTRIES = 500
/** A single payload above this is kept in memory only; it never evicts the rest of the disk cache. */
export const MAX_ENTRY_BYTES = 8 * 1024 * 1024
/** Upper bound on directory entries any scan will look at; surplus files are deleted. */
export const MAX_SCAN = 2000
const MIRROR_MAX_ENTRIES = 300
const MIRROR_MAX_BYTES = 16 * 1024 * 1024
const WARM_MAX_FILES = 64
const FLUSH_DELAY_MS = 250
const SCAN_CONCURRENCY = 16
const HEAD_BYTES = 512

// ---------------------------------------------------------------------------
// Approximate sizing + byte-bounded LRU
// ---------------------------------------------------------------------------

const MAX_SIZE_NODES = 200_000

/**
 * Cheap approximation of the memory held by a JSON-like value, in bytes. Strings
 * count their length once (the big diff/log payloads are single strings), objects
 * add a small per-key overhead. Walking stops after MAX_SIZE_NODES nodes and
 * extrapolates, so sizing a huge list stays bounded.
 * @param {unknown} value
 */
export function approxBytes(value) {
  let total = 0
  let visited = 0
  const stack = [value]
  const seen = new Set()
  while (stack.length > 0) {
    if (visited >= MAX_SIZE_NODES) {
      return Math.ceil(total + stack.length * (total / Math.max(1, visited)))
    }
    const v = stack.pop()
    visited++
    if (typeof v === 'string') total += v.length
    else if (typeof v === 'number') total += 8
    else if (typeof v === 'boolean' || v == null) total += 4
    else if (typeof v === 'object') {
      if (seen.has(v)) continue
      seen.add(v)
      if (Array.isArray(v)) {
        total += 16 + v.length * 8
        for (const item of v) stack.push(item)
      } else {
        total += 16
        for (const k of Object.keys(v)) { total += k.length + 8; stack.push(v[k]) }
      }
    }
  }
  return total
}

/**
 * Bounded in-memory map with least-recently-used eviction. Drop-in for the
 * `get`/`set`/`delete`/`has`/`size` subset of Map that useGh needs. Optionally
 * bounded by approximate bytes as well as entry count; the newest entry is always
 * kept, so one oversized value never makes the cache unusable.
 * @param {number} maxEntries
 * @param {{ maxBytes?: number, sizeOf?: (value: any) => number }} [options]
 */
export function createLruCache(maxEntries, { maxBytes = Infinity, sizeOf = approxBytes } = {}) {
  const map = new Map()
  const sizes = new Map()
  let bytes = 0
  const bounded = Number.isFinite(maxBytes)
  const drop = key => {
    if (!map.delete(key)) return false
    bytes -= sizes.get(key) || 0
    sizes.delete(key)
    return true
  }
  return {
    get(key) {
      if (!map.has(key)) return undefined
      const value = map.get(key)
      map.delete(key)
      map.set(key, value) // re-insert: most recently used goes last
      return value
    },
    set(key, value) {
      drop(key)
      map.set(key, value)
      if (bounded) {
        const size = sizeOf(value)
        sizes.set(key, size)
        bytes += size
      }
      while (map.size > maxEntries || (bounded && bytes > maxBytes && map.size > 1)) {
        drop(map.keys().next().value)
      }
      return this
    },
    has: key => map.has(key),
    delete: key => drop(key),
    keys: () => [...map.keys()],
    get size() { return map.size },
    get bytes() { return bytes },
  }
}

/**
 * Build a stable cache key from serializable parts.
 * @param {unknown[]} parts
 */
export function cacheKey(parts) {
  return createHash('sha256').update(JSON.stringify(parts)).digest('hex')
}

// ---------------------------------------------------------------------------
// Identity scope (#520)
// ---------------------------------------------------------------------------

/** Opaque, non-reversible fingerprint of the authenticated account, set once by the auth preflight. */
let identityAccount = null

/**
 * Record which account this process is authenticated as. Pass an opaque string
 * (see accountFingerprint) or null. Called by the auth preflight, which has
 * already fetched the credential, so no extra lookup is needed per read.
 * @param {{account?: string|null}} identity
 */
export function setCacheIdentity({ account = null } = {}) {
  identityAccount = account || null
}

/**
 * Non-reversible fingerprint for an account credential. The raw value is never
 * stored, logged or written to the cache directory.
 * @param {string} secret
 */
export function accountFingerprint(secret) {
  if (!secret) return null
  return createHash('sha256').update(`lazyhub-cache-account:${secret}`).digest('hex').slice(0, 16)
}

/** The host and account every shared cache key is scoped to. Host is read live from GH_HOST. */
export function cacheIdentity() {
  return { host: (process.env.GH_HOST || 'github.com').toLowerCase(), account: identityAccount }
}

/**
 * Cache key scoped to the current host and account, so an entry written for one
 * identity can never be served to another (same owner/repo on github.com and a
 * GHES host, or after `gh auth switch`).
 * @param {unknown[]} parts
 */
export function scopedCacheKey(parts) {
  const { host, account } = cacheIdentity()
  return cacheKey(['scope', host, account, ...parts])
}

function pathFor(key) {
  return join(CACHE_DIR, `${key}.json`)
}

function wellFormed(parsed) {
  return parsed && typeof parsed.ts === 'number' && Object.prototype.hasOwnProperty.call(parsed, 'payload')
}

// ---------------------------------------------------------------------------
// In-memory mirror, write queue, index
// ---------------------------------------------------------------------------

let mirror = createLruCache(MIRROR_MAX_ENTRIES, { maxBytes: MIRROR_MAX_BYTES, sizeOf: e => approxBytes(e.payload) })
/** key -> { ts, payload, meta } waiting for the next async flush. */
const pending = new Map()
/** key -> { size, mtime, repo } for files known to be on disk. repo undefined = unknown (legacy). */
const index = new Map()
let flushTimer = null
/** Serializes every disk-mutating async operation so invalidate cannot race a flush. */
let chain = Promise.resolve()
let warmPromise = null
let dirReady = false

/**
 * Synchronous invalidation tombstones: repo -> ms. Set the instant invalidateRepoCache
 * is called, so no read path can serve a pre-write entry while the async file removal
 * is still queued. An entry is a miss when its repo is tombstoned and ts <= the stamp.
 */
const invalidatedAt = new Map()
/** repo -> count of invalidations whose file removal has not finished. */
const pendingInvalidations = new Map()
/** The batch currently being written (so the exit hook can still flush it). */
let inflight = new Map()
let maxScan = MAX_SCAN

/**
 * Stamp of the newest invalidation whose file removal is still pending (0 if none).
 * Entries with no repo cannot be attributed, so they are judged against this.
 */
function latestPendingStamp() {
  let latest = 0
  for (const repo of pendingInvalidations.keys()) latest = Math.max(latest, invalidatedAt.get(repo) ?? 0)
  return latest
}

/**
 * True when the entry predates an invalidation of its repo, or has no repo and
 * predates the newest still-pending invalidation (legacy entries cannot be
 * attributed; repo-less entries written afterwards are fine).
 * @param {{ts:number, meta?:{repo?:string}}} entry
 */
function isTombstoned(entry) {
  const repo = entry?.meta?.repo
  if (!repo) return entry.ts <= latestPendingStamp()
  const at = invalidatedAt.get(repo)
  return at !== undefined && entry.ts <= at
}

/**
 * Test hook: lower the scan bound.
 * @param {number} n
 */
export function setMaxScan(n) { maxScan = n }

function enqueue(task) {
  const run = chain.then(task, task)
  chain = run.catch(() => {})
  return run
}

/**
 * Synchronous, memory-only lookup. Never touches the disk.
 * @param key
 */
export function peekCache(key) {
  const hot = pending.get(key) || mirror.get(key) || null
  if (hot && isTombstoned(hot)) { mirror.delete(key); return null }
  return hot
}

function admit(key, entry) {
  if (isTombstoned(entry)) return
  mirror.set(key, entry)
}

async function ensureDir() {
  if (dirReady) return
  await mkdir(CACHE_DIR, { recursive: true, mode: 0o700 })
  try { await chmod(CACHE_DIR, 0o700) } catch { /* best effort, e.g. win32 */ }
  dirReady = true
}

async function atomicWrite(file, data) {
  const tmp = join(CACHE_DIR, `.${randomBytes(6).toString('hex')}.tmp`)
  const fh = await open(tmp, 'wx', 0o600)
  try {
    await fh.writeFile(data)
  } catch (err) {
    await fh.close().catch(() => {})
    await rm(tmp, { force: true })
    throw err
  }
  await fh.close()
  try {
    await rename(tmp, file)
  } catch (err) {
    await rm(tmp, { force: true })
    throw err
  }
}

const yieldTurn = () => new Promise(resolve => setImmediate(resolve))

async function mapLimit(items, limit, fn) {
  for (let i = 0; i < items.length; i += limit) {
    await Promise.all(items.slice(i, i + limit).map(fn))
  }
}

/**
 * Repo and ts recorded in a file's leading `{"meta":{...},"ts":N,...` header; repo is
 * undefined for legacy files.
 * @param {string} head
 */
function infoFromHead(head) {
  const m = /^\{"meta":(\{[^}]*\}),"ts":(\d+)/.exec(head)
  if (!m) return { repo: undefined, ts: undefined }
  try { return { repo: JSON.parse(m[1]).repo ?? null, ts: Number(m[2]) } } catch { return { repo: undefined, ts: undefined } }
}

async function indexFile(name, st) {
  const full = join(CACHE_DIR, name)
  try {
    let info
    const fh = await open(full, 'r')
    try {
      const buf = Buffer.alloc(HEAD_BYTES)
      const { bytesRead } = await fh.read(buf, 0, HEAD_BYTES, 0)
      info = infoFromHead(buf.toString('utf8', 0, bytesRead))
    } finally {
      await fh.close()
    }
    index.set(name.slice(0, -'.json'.length), { size: st.size, mtime: st.mtimeMs, ...info })
  } catch {
    // vanished or unreadable: not indexed
  }
}

/**
 * Bring the index in line with the directory using one bounded async readdir plus a
 * stat per file (so cross-process rewrites refresh mtime/size). Only files not yet
 * indexed are opened. Files beyond maxScan are deleted, oldest mtime first, and
 * orphaned `.tmp` files older than a minute are removed.
 */
async function refreshIndex() {
  let all
  try { all = await readdir(CACHE_DIR) } catch { all = [] }
  const now = Date.now()
  const tmps = all.filter(n => n.startsWith('.') && n.endsWith('.tmp'))
  await mapLimit(tmps, SCAN_CONCURRENCY, async n => {
    try {
      const st = await stat(join(CACHE_DIR, n))
      if (now - st.mtimeMs > 60_000) await rm(join(CACHE_DIR, n), { force: true })
    } catch { /* gone */ }
  })
  const names = all.filter(n => n.endsWith('.json'))
  const stats = new Map()
  await mapLimit(names, SCAN_CONCURRENCY, async n => {
    try { stats.set(n, await stat(join(CACHE_DIR, n))) } catch { /* vanished */ }
  })
  const live = [...stats.entries()].sort((a, b) => b[1].mtimeMs - a[1].mtimeMs)
  const keep = live.slice(0, maxScan)
  await mapLimit(live.slice(maxScan), SCAN_CONCURRENCY, ([n]) => rm(join(CACHE_DIR, n), { force: true }))
  const present = new Set(keep.map(([n]) => n.slice(0, -'.json'.length)))
  for (const key of [...index.keys()]) if (!present.has(key)) index.delete(key)
  const fresh = []
  for (const [n, st] of keep) {
    const known = index.get(n.slice(0, -'.json'.length))
    // A changed mtime means another process rewrote the file: re-read its header so
    // repo and ts are current too (the invalidate task compares ts).
    if (known && known.mtime === st.mtimeMs) known.size = st.size
    else fresh.push([n, st])
  }
  await mapLimit(fresh, SCAN_CONCURRENCY, ([n, st]) => indexFile(n, st))
}

async function evictFromIndex(maxBytes, maxEntries, protect = new Set()) {
  let total = 0
  for (const e of index.values()) total += e.size
  const order = [...index.entries()].sort((a, b) => a[1].mtime - b[1].mtime)
  let count = order.length
  for (const [key, e] of order) {
    if (total <= maxBytes && count <= maxEntries) break
    if (protect.has(key)) continue
    await rm(pathFor(key), { force: true })
    index.delete(key)
    mirror.delete(key)
    total -= e.size
    count -= 1
  }
}

async function flushNow() {
  if (pending.size === 0) return
  inflight = new Map(pending)
  pending.clear()
  await ensureDir()
  const written = new Set()
  for (const [key, entry] of [...inflight]) {
    try {
      if (!isTombstoned(entry) && approxBytes(entry.payload) <= MAX_ENTRY_BYTES) {
        const data = JSON.stringify({ meta: entry.meta, ts: entry.ts, payload: entry.payload })
        if (data.length <= MAX_ENTRY_BYTES) {
          await atomicWrite(pathFor(key), data)
          index.set(key, { size: data.length, mtime: Date.now(), repo: entry.meta?.repo ?? null, ts: entry.ts })
          written.add(key)
        }
      }
    } catch {
      // best-effort cache
    }
    inflight.delete(key)
    await yieldTurn() // let the input thread run between big stringify calls
  }
  if (written.size > 0) {
    await refreshIndex()
    await evictFromIndex(MAX_BYTES, MAX_ENTRIES, written)
  }
}

function scheduleFlush() {
  if (flushTimer) return
  flushTimer = setTimeout(() => {
    flushTimer = null
    enqueue(flushNow).catch(() => {})
  }, FLUSH_DELAY_MS)
  flushTimer.unref?.()
}

/** Resolve once every queued write, eviction and invalidation has hit the disk. */
export async function flushCache() {
  if (flushTimer) { clearTimeout(flushTimer); flushTimer = null }
  await enqueue(flushNow)
}

let exitHooked = false
function hookExit() {
  if (exitHooked) return
  exitHooked = true
  // Last-chance sync flush so a quit right after a fetch does not lose the entry, and
  // queued removals survive the quit.
  process.on('exit', flushCacheOnExit)
}

/**
 * Synchronously persist unflushed writes (including the in-flight batch) and apply
 * queued invalidations. Registered for process exit; exported so tests can call it
 * directly. Only each file's first HEAD_BYTES are read to attribute it.
 */
export function flushCacheOnExit() {
  for (const [key, entry] of [...inflight, ...pending]) {
    try {
      if (isTombstoned(entry) || approxBytes(entry.payload) > MAX_ENTRY_BYTES) continue
      ensurePrivateDir(CACHE_DIR)
      writePrivateFile(pathFor(key), JSON.stringify({ meta: entry.meta, ts: entry.ts, payload: entry.payload }))
    } catch { /* best effort */ }
  }
  for (const repo of pendingInvalidations.keys()) {
    try {
      const at = invalidatedAt.get(repo) ?? 0
      for (const name of readdirSync(CACHE_DIR)) {
        if (!name.endsWith('.json')) continue
        const full = join(CACHE_DIR, name)
        try {
          const fd = openSync(full, 'r')
          let head
          try {
            const buf = Buffer.alloc(HEAD_BYTES)
            head = buf.toString('utf8', 0, readSync(fd, buf, 0, HEAD_BYTES, 0))
          } finally {
            closeSync(fd)
          }
          const info = infoFromHead(head)
          if (info.repo === undefined || (info.repo === repo && (info.ts ?? 0) <= at)) rmSync(full, { force: true })
        } catch { /* best effort */ }
      }
    } catch { /* best effort */ }
  }
}

/**
 * Load the newest on-disk entries into the in-memory mirror, once, in the
 * background. Cheap enough to call at startup: one bounded readdir, stat per file,
 * then at most WARM_MAX_FILES reads, yielding between files.
 */
export function warmCache() {
  if (warmPromise) return warmPromise
  warmPromise = enqueue(async () => {
    await refreshIndex()
    const newest = [...index.entries()].sort((a, b) => b[1].mtime - a[1].mtime).slice(0, WARM_MAX_FILES)
    let budget = MIRROR_MAX_BYTES
    for (const [key, info] of newest) {
      if (info.size > budget) continue
      if (mirror.has(key) || pending.has(key)) continue
      try {
        const parsed = JSON.parse(await readFile(pathFor(key), 'utf8'))
        if (wellFormed(parsed) && !isTombstoned(parsed)) { admit(key, parsed); budget -= info.size }
      } catch { /* corrupt entries are misses */ }
      await yieldTurn()
    }
  }).catch(() => {})
  return warmPromise
}

/** Drop in-memory state (tests). */
export function resetCacheState() {
  mirror = createLruCache(MIRROR_MAX_ENTRIES, { maxBytes: MIRROR_MAX_BYTES, sizeOf: e => approxBytes(e.payload) })
  pending.clear()
  index.clear()
  warmPromise = null
  dirReady = false
  invalidatedAt.clear()
  pendingInvalidations.clear()
  inflight = new Map()
  maxScan = MAX_SCAN
}

// ---------------------------------------------------------------------------
// Public read/write API
// ---------------------------------------------------------------------------

/**
 * Asynchronously read a cache entry (memory mirror first, then the file).
 * Resolves null on miss or corrupt JSON. Never blocks the event loop on the disk.
 * @param {string} key
 */
export async function readCacheAsync(key) {
  const hot = peekCache(key)
  if (hot) return hot
  try {
    const parsed = JSON.parse(await readFile(pathFor(key), 'utf8'))
    if (!wellFormed(parsed)) return null
    const again = peekCache(key) // a newer write may have landed while reading
    if (again) return again
    // An invalidation that landed while the read was in flight makes this a miss.
    if (isTombstoned(parsed)) return null
    admit(key, parsed)
    return parsed
  } catch {
    return null
  }
}

/**
 * Synchronous read for one-shot CLI/daemon callers (not for the TUI input path:
 * use peekCache/readCacheAsync). Memory first, then the file.
 * @param {string} key
 * @param {{ bypassMirror?: boolean }} [opts] bypassMirror: validate against the file
 *   (still honoring this process's own unflushed writes) instead of trusting a
 *   mirror copy that another process may have superseded (the daemon uses this).
 */
export function readCache(key, { bypassMirror = false } = {}) {
  const own = pending.get(key) || inflight.get(key)
  const hot = bypassMirror ? (own && !isTombstoned(own) ? own : null) : peekCache(key)
  if (hot) return hot
  try {
    const parsed = JSON.parse(readFileSync(pathFor(key), 'utf8'))
    return wellFormed(parsed) && !isTombstoned(parsed) ? parsed : null
  } catch {
    return null
  }
}

/**
 * Read well-formed cache entries from disk (at most MAX_SCAN files).
 * Corrupt entries are ignored so lightweight CLI callers can stay best-effort.
 */
export function listCacheEntries() {
  if (!existsSync(CACHE_DIR)) return []
  const entries = []
  // Newest maxScan files, not the first ones readdir happens to return.
  const files = readdirSync(CACHE_DIR)
    .filter(file => file.endsWith('.json'))
    .map(file => {
      try { return { file, mtime: statSync(join(CACHE_DIR, file)).mtimeMs } } catch { return null }
    })
    .filter(Boolean)
    .sort((a, b) => b.mtime - a.mtime)
    .slice(0, maxScan)
  for (const { file } of files) {
    try {
      const parsed = JSON.parse(readFileSync(join(CACHE_DIR, file), 'utf8'))
      if (!wellFormed(parsed) || isTombstoned(parsed)) continue
      entries.push({ key: file.slice(0, -'.json'.length), ...parsed })
    } catch {
      // Ignore corrupt cache entries; the normal TUI refresh path will replace them.
    }
  }
  return entries
}

/**
 * Record a cache entry. Memory is updated synchronously; serialization, the file
 * write and the size cap run later, off the caller's turn.
 * @param {string} key
 * @param {unknown} payload
 * @param {object} meta
 */
export function writeCache(key, payload, meta = {}) {
  let ts = Date.now()
  const at = meta?.repo ? invalidatedAt.get(meta.repo) : latestPendingStamp() || undefined
  if (at !== undefined && ts <= at) ts = at + 1 // written after the invalidation, even within the same ms
  const entry = { ts, payload, meta }
  pending.set(key, entry)
  admit(key, entry)
  hookExit()
  scheduleFlush()
}

/**
 * Remove all cache entries associated with a repository. Memory is cleared
 * synchronously; the returned promise settles once the files are gone. Legacy
 * files with no recorded repo are removed too (a cache miss is always safe).
 * @param {string} repo
 * @returns {Promise<void>}
 */
export function invalidateRepoCache(repo) {
  if (!repo) return Promise.resolve()
  // Tombstone first, synchronously: reads treat anything written before now as a miss
  // until (and after) the queued file removal runs.
  const at = Date.now()
  invalidatedAt.set(repo, Math.max(at, invalidatedAt.get(repo) ?? 0))
  pendingInvalidations.set(repo, (pendingInvalidations.get(repo) ?? 0) + 1)
  hookExit()
  for (const key of mirror.keys()) {
    if (mirror.get(key)?.meta?.repo === repo) mirror.delete(key)
  }
  for (const [key, entry] of pending) if (entry.meta?.repo === repo) pending.delete(key)
  return enqueue(async () => {
    await flushNow() // flush other repos' pending writes first so the index is complete
    await refreshIndex()
    // Never remove an entry written after this invalidation (ts > at).
    const doomed = [...index.entries()].filter(([, e]) => e.repo === undefined || (e.repo === repo && (e.ts ?? 0) <= at))
    await mapLimit(doomed, SCAN_CONCURRENCY, async ([key]) => {
      await rm(pathFor(key), { force: true })
      index.delete(key)
      mirror.delete(key)
    })
  }).catch(() => {}).finally(() => {
    const left = (pendingInvalidations.get(repo) ?? 1) - 1
    if (left > 0) pendingInvalidations.set(repo, left)
    else pendingInvalidations.delete(repo)
  })
}

/**
 * Evict least-recently-modified entries until the cache is under maxBytes and
 * maxEntries. Works from the index plus one bounded readdir.
 * @param {number} maxBytes
 * @param {number} maxEntries
 * @returns {Promise<void>}
 */
export function evictCache(maxBytes = MAX_BYTES, maxEntries = MAX_ENTRIES) {
  return enqueue(async () => {
    await flushNow()
    await refreshIndex()
    await evictFromIndex(maxBytes, maxEntries)
  }).catch(() => {})
}
