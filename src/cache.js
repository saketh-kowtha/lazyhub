/**
 * cache.js — stale-while-revalidate disk cache for gh-backed panes.
 */

import { existsSync, readFileSync, readdirSync, rmSync, statSync } from 'fs'
import { createHash } from 'crypto'
import { homedir } from 'os'
import { join } from 'path'
import { ensurePrivateDir, writePrivateFile } from './secure-fs.js'

export const CACHE_DIR = process.env.LAZYHUB_CACHE_DIR || join(homedir(), '.cache', 'lazyhub', 'data')
const MAX_BYTES = 50 * 1024 * 1024
const MAX_ENTRIES = 500

/**
 * Bounded in-memory map with least-recently-used eviction. Drop-in for the
 * `get`/`set`/`delete`/`has`/`size` subset of Map that useGh needs.
 * @param {number} maxEntries
 */
export function createLruCache(maxEntries) {
  const map = new Map()
  return {
    get(key) {
      if (!map.has(key)) return undefined
      const value = map.get(key)
      map.delete(key)
      map.set(key, value) // re-insert: most recently used goes last
      return value
    },
    set(key, value) {
      map.delete(key)
      map.set(key, value)
      while (map.size > maxEntries) map.delete(map.keys().next().value)
      return this
    },
    has: key => map.has(key),
    delete: key => map.delete(key),
    get size() { return map.size },
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

/**
 * Read a cache entry, returning null on miss or corrupt JSON.
 * @param {string} key
 */
export function readCache(key) {
  try {
    const raw = readFileSync(pathFor(key), 'utf8')
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed.ts !== 'number' || !Object.prototype.hasOwnProperty.call(parsed, 'payload')) return null
    return parsed
  } catch {
    return null
  }
}

/**
 * Read every well-formed cache entry from disk.
 * Corrupt entries are ignored so lightweight CLI callers can stay best-effort.
 */
export function listCacheEntries() {
  if (!existsSync(CACHE_DIR)) return []
  const entries = []
  for (const file of readdirSync(CACHE_DIR)) {
    if (!file.endsWith('.json')) continue
    try {
      const raw = readFileSync(join(CACHE_DIR, file), 'utf8')
      const parsed = JSON.parse(raw)
      if (!parsed || typeof parsed.ts !== 'number' || !Object.prototype.hasOwnProperty.call(parsed, 'payload')) continue
      entries.push({ key: file.slice(0, -'.json'.length), ...parsed })
    } catch {
      // Ignore corrupt cache entries; the normal TUI refresh path will replace them.
    }
  }
  return entries
}

/**
 * Write a cache entry and enforce the size cap.
 * @param {string} key
 * @param {unknown} payload
 * @param {object} meta
 */
export function writeCache(key, payload, meta = {}) {
  ensurePrivateDir(CACHE_DIR)
  writePrivateFile(pathFor(key), JSON.stringify({ ts: Date.now(), payload, meta }))
  evictCache()
}

/**
 * Remove all cache entries associated with a repository.
 * @param {string} repo
 */
export function invalidateRepoCache(repo) {
  if (!repo || !existsSync(CACHE_DIR)) return
  for (const file of readdirSync(CACHE_DIR)) {
    if (!file.endsWith('.json')) continue
    const full = join(CACHE_DIR, file)
    try {
      const parsed = JSON.parse(readFileSync(full, 'utf8'))
      if (parsed?.meta?.repo === repo) rmSync(full, { force: true })
    } catch {
      rmSync(full, { force: true })
    }
  }
}

/**
 * Evict least-recently-modified entries until the cache is under maxBytes and
 * maxEntries.
 * @param {number} maxBytes
 * @param {number} maxEntries
 */
export function evictCache(maxBytes = MAX_BYTES, maxEntries = MAX_ENTRIES) {
  if (!existsSync(CACHE_DIR)) return
  const files = readdirSync(CACHE_DIR)
    .filter(file => file.endsWith('.json'))
    .map(file => {
      const full = join(CACHE_DIR, file)
      try {
        const stats = statSync(full)
        return { full, size: stats.size, mtime: stats.mtimeMs }
      } catch {
        return null
      }
    })
    .filter(Boolean)
  let total = files.reduce((sum, file) => sum + file.size, 0)
  let count = files.length
  for (const file of files.sort((a, b) => a.mtime - b.mtime)) {
    if (total <= maxBytes && count <= maxEntries) break
    rmSync(file.full, { force: true })
    total -= file.size
    count -= 1
  }
}
