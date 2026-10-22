import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, expect, it, vi } from 'vitest'

describe('disk cache', () => {
  it('reads hits, treats corrupt files as misses, and evicts by mtime', async () => {
    vi.resetModules()
    const dir = mkdtempSync(join(tmpdir(), 'lazyhub-cache-test-'))
    process.env.LAZYHUB_CACHE_DIR = dir
    try {
      const cache = await import('./cache.js')
      const key = cache.cacheKey(['repo', 'listPRs', []])
      cache.writeCache(key, [{ number: 1 }], { repo: 'owner/repo' })
      expect(cache.readCache(key)?.payload).toEqual([{ number: 1 }])

      writeFileSync(join(dir, 'bad.json'), '{nope')
      expect(cache.readCache('bad')).toBeNull()

      const oldKey = cache.cacheKey(['old'])
      const newKey = cache.cacheKey(['new'])
      cache.writeCache(oldKey, 'x'.repeat(20))
      cache.writeCache(newKey, 'y'.repeat(20))
      cache.evictCache(10)
      expect(cache.readCache(oldKey)).toBeNull()
    } finally {
      delete process.env.LAZYHUB_CACHE_DIR
      rmSync(dir, { recursive: true, force: true })
    }
  })

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

  it('caps the number of on-disk entries, dropping the oldest first', async () => {
    vi.resetModules()
    const dir = mkdtempSync(join(tmpdir(), 'lazyhub-cache-test-'))
    process.env.LAZYHUB_CACHE_DIR = dir
    try {
      const cache = await import('./cache.js')
      for (const name of ['a', 'b', 'c', 'd']) cache.writeCache(name, name)
      const { utimesSync } = await import('fs')
      // Distinct mtimes so "oldest" is deterministic on coarse filesystems.
      ;['a', 'b', 'c', 'd'].forEach((name, i) => utimesSync(join(dir, `${name}.json`), 1000 + i, 1000 + i))
      cache.evictCache(Infinity, 2)
      expect(readdirSync(dir).sort()).toEqual(['c.json', 'd.json'])
    } finally {
      delete process.env.LAZYHUB_CACHE_DIR
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('invalidates all entries for a mutated repository only', async () => {
    vi.resetModules()
    const dir = mkdtempSync(join(tmpdir(), 'lazyhub-cache-test-'))
    process.env.LAZYHUB_CACHE_DIR = dir
    try {
      const cache = await import('./cache.js')
      const repoKey = cache.cacheKey(['owner/repo', 'listPRs', []])
      const otherKey = cache.cacheKey(['owner/other', 'listPRs', []])
      cache.writeCache(repoKey, [{ number: 1 }], { repo: 'owner/repo' })
      cache.writeCache(otherKey, [{ number: 2 }], { repo: 'owner/other' })

      cache.invalidateRepoCache('owner/repo')

      expect(cache.readCache(repoKey)).toBeNull()
      expect(cache.readCache(otherKey)?.payload).toEqual([{ number: 2 }])
      expect(readdirSync(dir).some(file => file.endsWith('.json'))).toBe(true)
    } finally {
      delete process.env.LAZYHUB_CACHE_DIR
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
