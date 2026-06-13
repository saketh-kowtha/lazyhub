import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it, vi } from 'vitest'

const dirs = []

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
  delete process.env.LAZYHUB_CACHE_DIR
})

describe('daemon cache', () => {
  it('serves memory hits and invalidates by repo', async () => {
    vi.resetModules()
    const dir = mkdtempSync(join(tmpdir(), 'lazyhub-daemon-cache-test-'))
    dirs.push(dir)
    process.env.LAZYHUB_CACHE_DIR = dir
    const { DaemonCache } = await import('./cache.js')
    const cache = new DaemonCache()
    const key = cache.key(['gh', ['pr', 'list']])
    cache.set(key, [{ number: 1 }], { repo: 'owner/repo' })
    expect(cache.get(key)?.payload).toEqual([{ number: 1 }])
    cache.invalidate('owner/repo')
    expect(cache.get(key)).toBeNull()
  })
})
