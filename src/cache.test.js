import { existsSync, mkdtempSync, readdirSync, rmSync, utimesSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, expect, it, vi } from 'vitest'

async function withCacheDir(fn) {
  vi.resetModules()
  const dir = mkdtempSync(join(tmpdir(), 'lazyhub-cache-test-'))
  process.env.LAZYHUB_CACHE_DIR = dir
  try {
    const cache = await import('./cache.js')
    await fn(cache, dir)
  } finally {
    delete process.env.LAZYHUB_CACHE_DIR
    rmSync(dir, { recursive: true, force: true })
  }
}

describe('disk cache', () => {
  it('reads hits, treats corrupt files as misses, and evicts by mtime', () => withCacheDir(async (cache, dir) => {
    const key = cache.cacheKey(['repo', 'listPRs', []])
    cache.writeCache(key, [{ number: 1 }], { repo: 'owner/repo' })
    expect(cache.readCache(key)?.payload).toEqual([{ number: 1 }])
    await cache.flushCache()
    cache.resetCacheState() // force the disk path, not the memory mirror
    expect(cache.readCache(key)?.payload).toEqual([{ number: 1 }])

    writeFileSync(join(dir, 'bad.json'), '{nope')
    expect(cache.readCache('bad')).toBeNull()

    const oldKey = cache.cacheKey(['old'])
    const newKey = cache.cacheKey(['new'])
    cache.writeCache(oldKey, 'x'.repeat(20))
    await cache.flushCache()
    utimesSync(join(dir, `${oldKey}.json`), 1000, 1000)
    cache.writeCache(newKey, 'y'.repeat(20))
    await cache.flushCache()
    cache.resetCacheState()
    await cache.evictCache(80)
    expect(existsSync(join(dir, `${oldKey}.json`))).toBe(false)
    expect(existsSync(join(dir, `${newKey}.json`))).toBe(true)
  }))

  it('evicts the least recently used in-memory entry once over the cap', async () => {
    const { createLruCache } = await import('./cache.js')
    const lru = createLruCache(2)
    lru.set('a', 1)
    lru.set('b', 2)
    expect(lru.get('a')).toBe(1) // touch a, so b is now the oldest
    lru.set('c', 3)
    expect(lru.has('b')).toBe(false)
    expect(lru.get('a')).toBe(1)
    expect(lru.get('c')).toBe(3)
    lru.set('a', 9) // overwrite does not grow the cache
    expect(lru.size).toBe(2)
  })

  it('caps the number of on-disk entries, dropping the oldest first', () => withCacheDir(async (cache, dir) => {
    for (const name of ['a', 'b', 'c', 'd']) cache.writeCache(name, name)
    await cache.flushCache()
    // Distinct mtimes so "oldest" is deterministic on coarse filesystems.
    ;['a', 'b', 'c', 'd'].forEach((name, i) => utimesSync(join(dir, `${name}.json`), 1000 + i, 1000 + i))
    cache.resetCacheState()
    await cache.evictCache(Infinity, 2)
    expect(readdirSync(dir).sort()).toEqual(['c.json', 'd.json'])
  }))

  it('invalidates all entries for a mutated repository only', () => withCacheDir(async (cache, dir) => {
    const repoKey = cache.cacheKey(['owner/repo', 'listPRs', []])
    const otherKey = cache.cacheKey(['owner/other', 'listPRs', []])
    cache.writeCache(repoKey, [{ number: 1 }], { repo: 'owner/repo' })
    cache.writeCache(otherKey, [{ number: 2 }], { repo: 'owner/other' })
    await cache.flushCache()

    await cache.invalidateRepoCache('owner/repo')

    expect(cache.readCache(repoKey)).toBeNull()
    expect(cache.readCache(otherKey)?.payload).toEqual([{ number: 2 }])
    expect(readdirSync(dir).some(file => file.endsWith('.json'))).toBe(true)
  }))

  it('writeCache does no disk I/O on the caller turn; the file lands after an async flush (#455)', () => withCacheDir(async (cache, dir) => {
    cache.writeCache('k1', { a: 1 }, { repo: 'o/r' })
    expect(existsSync(dir) ? readdirSync(dir) : []).toEqual([])
    expect(cache.peekCache('k1')?.payload).toEqual({ a: 1 })
    await cache.flushCache()
    expect(readdirSync(dir)).toEqual(['k1.json'])
  }))

  it('warmCache loads the newest on-disk entries so peekCache serves them synchronously (#455)', () => withCacheDir(async (cache, dir) => {
    writeFileSync(join(dir, 'warm.json'), JSON.stringify({ meta: { repo: 'o/r' }, ts: 5, payload: 'WARM' }))
    writeFileSync(join(dir, 'bad.json'), '{nope')
    expect(cache.peekCache('warm')).toBeNull()
    await cache.warmCache()
    expect(cache.peekCache('warm')?.payload).toBe('WARM')
    expect(cache.peekCache('bad')).toBeNull()
    expect((await cache.readCacheAsync('warm'))?.payload).toBe('WARM')
    expect(await cache.readCacheAsync('missing')).toBeNull()
  }))

  it('invalidateRepoCache clears memory synchronously, finds files another process wrote, and drops legacy files (#455)', () => withCacheDir(async (cache, dir) => {
    cache.writeCache('mine', 1, { repo: 'o/r' })
    await cache.flushCache()
    // Written by "another process" after our index was built; meta-first and legacy layouts.
    writeFileSync(join(dir, 'theirs.json'), JSON.stringify({ meta: { repo: 'o/r' }, ts: 1, payload: 2 }))
    writeFileSync(join(dir, 'other.json'), JSON.stringify({ meta: { repo: 'o/other' }, ts: 1, payload: 3 }))
    writeFileSync(join(dir, 'legacy.json'), JSON.stringify({ ts: 1, payload: 4, meta: { repo: 'o/r' } }))
    const done = cache.invalidateRepoCache('o/r')
    expect(cache.peekCache('mine')).toBeNull() // synchronous
    await done
    expect(readdirSync(dir).sort()).toEqual(['other.json'])
  }))

  it('an oversized payload stays out of the disk cache and never evicts other entries (#455)', () => withCacheDir(async (cache, dir) => {
    cache.writeCache('small', 'ok', { repo: 'o/r' })
    await cache.flushCache()
    cache.writeCache('huge', 'z'.repeat(cache.MAX_ENTRY_BYTES + 1), { repo: 'o/r' })
    await cache.flushCache()
    expect(readdirSync(dir).sort()).toEqual(['small.json'])
    expect(cache.peekCache('huge')).not.toBeNull()
  }))

  it('bounds directory scans: files beyond MAX_SCAN are deleted, not read (#455)', () => withCacheDir(async (cache, dir) => {
    for (let i = 0; i < cache.MAX_SCAN + 50; i++) writeFileSync(join(dir, `f${i}.json`), '{}')
    await cache.evictCache(Infinity, Infinity)
    expect(readdirSync(dir).length).toBe(cache.MAX_SCAN)
  }))
})

describe('byte-bounded LRU (#457)', () => {
  it('evicts oldest entries when approximate bytes exceed the budget, keeping the newest', async () => {
    const { createLruCache, approxBytes } = await import('./cache.js')
    expect(approxBytes('x'.repeat(1000))).toBeGreaterThanOrEqual(1000)
    const lru = createLruCache(100, { maxBytes: 2500, sizeOf: v => v.length })
    lru.set('a', 'x'.repeat(1000))
    lru.set('b', 'x'.repeat(1000))
    lru.set('c', 'x'.repeat(1000))
    expect(lru.has('a')).toBe(false)
    expect(lru.has('b') && lru.has('c')).toBe(true)
    expect(lru.bytes).toBe(2000)
    lru.set('huge', 'x'.repeat(9000)) // over budget alone: kept as the only entry
    expect([lru.size, lru.has('huge')]).toEqual([1, true])
    lru.delete('huge')
    expect(lru.bytes).toBe(0)
  })

  it('approxBytes stays bounded on very large structures', async () => {
    const { approxBytes } = await import('./cache.js')
    const big = Array.from({ length: 300_000 }, (_, i) => ({ i }))
    expect(approxBytes(big)).toBeGreaterThan(300_000)
  })
})
