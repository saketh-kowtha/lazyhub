import { mkdtempSync, rmSync, writeFileSync } from 'fs'
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
})
