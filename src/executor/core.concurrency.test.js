import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('execa', () => ({ execa: vi.fn() }))
vi.mock('../daemon/lifecycle.js', () => ({ requestDaemon: vi.fn() }))
vi.mock('../daemon/audit.js', () => ({ writeAuditEntry: vi.fn(), hashArgs: vi.fn(() => 'h') }))
vi.mock('../cache.js', () => ({ invalidateRepoCache: vi.fn() }))

import { execa } from 'execa'
import { runGh, GhError } from './core.js'

const ok = (stdout = '[]') => ({ exitCode: 0, stdout, stderr: '' })
const READ = n => ['pr', 'view', String(n), '--repo', 'o/r']
const tick = () => new Promise(resolve => setImmediate(resolve))

/** execa mock whose calls stay pending until finished by the test. */
function deferredExeca() {
  const calls = []
  execa.mockImplementation((_bin, args) => new Promise(resolve => {
    calls.push({ args, finish: result => resolve(result ?? ok()) })
  }))
  return calls
}

beforeEach(() => {
  vi.resetAllMocks()
})

afterEach(() => {
  delete process.env.LAZYHUB_GH_CONCURRENCY
})

describe('runGh bounded concurrency', () => {
  it('never runs more than the cap in flight and starts waiters in FIFO order', async () => {
    process.env.LAZYHUB_GH_CONCURRENCY = '2'
    const calls = deferredExeca()
    const done = [1, 2, 3, 4].map(n => runGh(READ(n), { skipDaemon: true }))
    await tick()
    expect(calls.map(c => c.args[2])).toEqual(['1', '2'])
    calls[0].finish()
    await tick()
    expect(calls.map(c => c.args[2])).toEqual(['1', '2', '3'])
    calls[1].finish()
    await tick()
    expect(calls.map(c => c.args[2])).toEqual(['1', '2', '3', '4'])
    calls[2].finish()
    calls[3].finish()
    await Promise.all(done)
  })

  it('releases the slot when a call fails', async () => {
    process.env.LAZYHUB_GH_CONCURRENCY = '1'
    const calls = deferredExeca()
    const first = runGh(READ(1), { skipDaemon: true })
    const second = runGh(READ(2), { skipDaemon: true })
    await tick()
    expect(calls).toHaveLength(1)
    calls[0].finish({ exitCode: 1, stdout: '', stderr: 'boom' })
    await expect(first).rejects.toBeInstanceOf(GhError)
    await tick()
    expect(calls).toHaveLength(2)
    calls[1].finish()
    await expect(second).resolves.toEqual([])
  })

  it('lets interactive auth login bypass a saturated queue', async () => {
    process.env.LAZYHUB_GH_CONCURRENCY = '1'
    const calls = deferredExeca()
    const busy = runGh(READ(1), { skipDaemon: true })
    await tick()
    const login = runGh(['auth', 'login'], { interactive: true, timeout: 0 })
    await tick()
    expect(calls.map(c => c.args[0])).toEqual(['pr', 'auth'])
    calls[0].finish()
    calls[1].finish()
    await Promise.all([busy, login])
  })

  it.each(['0', '-3', 'abc', '2x', '1e3', ''])('falls back to the default cap for %j', async value => {
    process.env.LAZYHUB_GH_CONCURRENCY = value
    const calls = deferredExeca()
    const done = [1, 2, 3, 4, 5, 6].map(n => runGh(READ(n), { skipDaemon: true }))
    await tick()
    expect(calls).toHaveLength(4)
    for (let i = 0; i < 6; i++) { await tick(); calls[i]?.finish() }
    await tick()
    calls.slice(4).forEach(c => c.finish())
    await Promise.all(done)
  })
})
