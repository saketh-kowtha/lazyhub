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

import { existsSync, readFileSync, readdirSync } from 'fs'
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
  return pending.get(key) || mirror.get(key) || null
}

function admit(key, entry) {
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
 * Repo recorded in a file's leading `{"meta":{...},"ts":...` header; undefined for legacy files.
 * @param head
 */
function repoFromHead(head) {
  const m = /^\{"meta":(\{[^}]*\}),"ts":\d/.exec(head)
  if (!m) return undefined
  try { return JSON.parse(m[1]).repo ?? null } catch { return undefined }
}

async function indexFile(name) {
  const full = join(CACHE_DIR, name)
  try {
    const st = await stat(full)
    let repo
    const fh = await open(full, 'r')
    try {
      const buf = Buffer.alloc(HEAD_BYTES)
      const { bytesRead } = await fh.read(buf, 0, HEAD_BYTES, 0)
      repo = repoFromHead(buf.toString('utf8', 0, bytesRead))
    } finally {
      await fh.close()
    }
    index.set(name.slice(0, -'.json'.length), { size: st.size, mtime: st.mtimeMs, repo })
  } catch {
    // vanished or unreadable: not indexed
  }
}

/**
 * Bring the index in line with the directory using one bounded async readdir. Only
 * files not already indexed are opened. Files beyond MAX_SCAN are deleted.
 */
async function refreshIndex() {
  let names
  try { names = (await readdir(CACHE_DIR)).filter(n => n.endsWith('.json')) } catch { names = [] }
  const present = new Set(names.map(n => n.slice(0, -'.json'.length)))
  for (const key of [...index.keys()]) if (!present.has(key)) index.delete(key)
  if (names.length > MAX_SCAN) {
    const surplus = names.slice(MAX_SCAN)
    names = names.slice(0, MAX_SCAN)
    await mapLimit(surplus, SCAN_CONCURRENCY, n => rm(join(CACHE_DIR, n), { force: true }))
  }
  await mapLimit(names.filter(n => !index.has(n.slice(0, -'.json'.length))), SCAN_CONCURRENCY, indexFile)
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
  const batch = [...pending.entries()]
  pending.clear()
  await ensureDir()
  const written = new Set()
  for (const [key, entry] of batch) {
    try {
      if (approxBytes(entry.payload) > MAX_ENTRY_BYTES) continue
      const data = JSON.stringify({ meta: entry.meta, ts: entry.ts, payload: entry.payload })
      if (data.length > MAX_ENTRY_BYTES) continue
      await atomicWrite(pathFor(key), data)
      index.set(key, { size: data.length, mtime: Date.now(), repo: entry.meta?.repo ?? null })
      written.add(key)
    } catch {
      // best-effort cache
    }
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
  // Last-chance sync flush so a quit right after a fetch does not lose the entry.
  process.on('exit', () => {
    for (const [key, entry] of pending) {
      try {
        if (approxBytes(entry.payload) > MAX_ENTRY_BYTES) continue
        ensurePrivateDir(CACHE_DIR)
        writePrivateFile(pathFor(key), JSON.stringify({ meta: entry.meta, ts: entry.ts, payload: entry.payload }))
      } catch { /* best effort */ }
    }
  })
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
        if (wellFormed(parsed)) { admit(key, parsed); budget -= info.size }
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
 */
export function readCache(key) {
  const hot = peekCache(key)
  if (hot) return hot
  try {
    const parsed = JSON.parse(readFileSync(pathFor(key), 'utf8'))
    return wellFormed(parsed) ? parsed : null
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
  for (const file of readdirSync(CACHE_DIR).slice(0, MAX_SCAN)) {
    if (!file.endsWith('.json')) continue
    try {
      const parsed = JSON.parse(readFileSync(join(CACHE_DIR, file), 'utf8'))
      if (!wellFormed(parsed)) continue
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
  const entry = { ts: Date.now(), payload, meta }
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
  for (const key of mirror.keys()) {
    if (mirror.get(key)?.meta?.repo === repo) mirror.delete(key)
  }
  for (const [key, entry] of pending) if (entry.meta?.repo === repo) pending.delete(key)
  return enqueue(async () => {
    await flushNow() // flush other repos' pending writes first so the index is complete
    await refreshIndex()
    const doomed = [...index.entries()].filter(([, e]) => e.repo === undefined || e.repo === repo)
    await mapLimit(doomed, SCAN_CONCURRENCY, async ([key]) => {
      await rm(pathFor(key), { force: true })
      index.delete(key)
      mirror.delete(key)
    })
  }).catch(() => {})
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
