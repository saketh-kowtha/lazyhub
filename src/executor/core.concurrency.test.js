import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('execa', () => ({ execa: vi.fn() }))
vi.mock('../daemon/lifecycle.js', () => ({ requestDaemon: vi.fn() }))
vi.mock('../daemon/audit.js', () => ({ writeAuditEntry: vi.fn(), hashArgs: vi.fn(() => 'h') }))
vi.mock('../cache.js', () => ({ invalidateRepoCache: vi.fn() }))
vi.mock('os', async importOriginal => ({ ...(await importOriginal()), availableParallelism: vi.fn(() => 4) }))

import { execa } from 'execa'
import { availableParallelism } from 'os'
import { runGh, GhError, defaultGhConcurrency, sharedReadCount, GH_CONCURRENCY_MIN, GH_CONCURRENCY_MAX } from './core.js'

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
  availableParallelism.mockReturnValue(4)
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
  it('serves low-priority reads after normal ones and keeps one slot free for the user', async () => {
    process.env.LAZYHUB_GH_CONCURRENCY = '2'
    const calls = deferredExeca()
    const low1 = runGh(READ(1), { skipDaemon: true, priority: 'low' })
    const low2 = runGh(READ(2), { skipDaemon: true, priority: 'low' })
    await tick()
    // The cap is 2: a speculative read may use only one slot.
    expect(calls.map(c => c.args[2])).toEqual(['1'])
    // A user read starts at once in the free slot, ahead of the waiting low read.
    const user = runGh(READ(3), { skipDaemon: true })
    await tick()
    expect(calls.map(c => c.args[2])).toEqual(['1', '3'])
    // A queued normal read is served before the queued low one when a slot frees.
    const user2 = runGh(READ(4), { skipDaemon: true })
    await tick()
    calls[1].finish()
    await tick()
    expect(calls.map(c => c.args[2])).toEqual(['1', '3', '4'])
    calls[0].finish()
    calls[2].finish()
    await tick()
    expect(calls.map(c => c.args[2])).toEqual(['1', '3', '4', '2'])
    calls[3].finish()
    await Promise.all([low1, low2, user, user2])
  })
})

describe('default gh concurrency follows the CPU count (#622)', () => {
  it('clamps the CPU count to 2..8', () => {
    expect([GH_CONCURRENCY_MIN, GH_CONCURRENCY_MAX]).toEqual([2, 8])
    expect(defaultGhConcurrency(1)).toBe(2)
    expect(defaultGhConcurrency(2)).toBe(2)
    expect(defaultGhConcurrency(6)).toBe(6)
    expect(defaultGhConcurrency(64)).toBe(8)
    expect(defaultGhConcurrency(NaN)).toBe(2)
  })

  it.each([[1, 2], [3, 3], [32, 8]])('a %i-CPU machine runs %i gh at once', async (cpus, cap) => {
    availableParallelism.mockReturnValue(cpus)
    const calls = deferredExeca()
    const done = Array.from({ length: 10 }, (_, i) => runGh(READ(i + 1), { skipDaemon: true }))
    await tick()
    expect(calls).toHaveLength(cap)
    for (let i = 0; i < 10; i++) { calls[i]?.finish(); await tick() }
    await Promise.all(done)
  })

  it('LAZYHUB_GH_CONCURRENCY still wins over the CPU count', async () => {
    availableParallelism.mockReturnValue(32)
    process.env.LAZYHUB_GH_CONCURRENCY = '3'
    const calls = deferredExeca()
    const done = Array.from({ length: 5 }, (_, i) => runGh(READ(i + 1), { skipDaemon: true }))
    await tick()
    expect(calls).toHaveLength(3)
    for (let i = 0; i < 5; i++) { calls[i]?.finish(); await tick() }
    await Promise.all(done)
  })
})

describe('identical reads in flight share one gh (#622)', () => {
  it('spawns once and hands every caller its own copy', async () => {
    const calls = deferredExeca()
    const a = runGh(READ(7), { skipDaemon: true })
    const b = runGh(READ(7), { skipDaemon: true })
    await tick()
    expect(calls).toHaveLength(1)
    calls[0].finish(ok('{"n":7,"rows":[1]}'))
    const [ra, rb] = await Promise.all([a, b])
    expect(ra).toEqual({ n: 7, rows: [1] })
    expect(rb).toEqual(ra)
    expect(rb).not.toBe(ra)
    expect(sharedReadCount()).toBe(0)
    // Once settled, the same read spawns again.
    const c = runGh(READ(7), { skipDaemon: true })
    await tick()
    expect(calls).toHaveLength(2)
    calls[1].finish()
    await c
  })

  it('a change the first caller makes to its result never reaches the others', async () => {
    const calls = deferredExeca()
    const first = runGh(READ(1), { skipDaemon: true }).then(r => { r.rows.push('mutated'); return r })
    const second = runGh(READ(1), { skipDaemon: true })
    await tick()
    calls[0].finish(ok('{"rows":[]}'))
    expect((await first).rows).toEqual(['mutated'])
    expect((await second).rows).toEqual([])
  })

  it('shares a failure with every caller', async () => {
    const calls = deferredExeca()
    const a = runGh(READ(2), { skipDaemon: true })
    const b = runGh(READ(2), { skipDaemon: true })
    await tick()
    calls[0].finish({ exitCode: 1, stdout: '', stderr: 'boom' })
    await expect(a).rejects.toBeInstanceOf(GhError)
    await expect(b).rejects.toBeInstanceOf(GhError)
    expect(calls).toHaveLength(1)
  })

  it('does not share reads whose argv or output mode differ', async () => {
    const calls = deferredExeca()
    const done = [
      runGh(READ(3), { skipDaemon: true }),
      runGh(READ(4), { skipDaemon: true }),
      runGh(READ(3), { skipDaemon: true, json: false }),
    ]
    await tick()
    expect(calls).toHaveLength(3)
    calls.forEach(c => c.finish())
    await Promise.all(done)
  })

  it('never shares a read with stdin, and never shares writes', async () => {
    const calls = deferredExeca()
    const gql = ['api', 'graphql', '--input', '-']
    const reads = [runGh(gql, { skipDaemon: true, stdin: '{}' }), runGh(gql, { skipDaemon: true, stdin: '{}' })]
    const write = ['pr', 'comment', '5', '--repo', 'o/r', '--body', 'x']
    const writes = [runGh(write), runGh(write)]
    await tick()
    expect(calls).toHaveLength(4)
    calls.forEach(c => c.finish())
    await Promise.all([...reads, ...writes])
  })

  it('a user read does not wait behind a queued speculative one; a speculative read joins a user read', async () => {
    process.env.LAZYHUB_GH_CONCURRENCY = '2'
    const calls = deferredExeca()
    const busy = runGh(READ(9), { skipDaemon: true })
    const low = runGh(READ(5), { skipDaemon: true, priority: 'low' }) // queued: one slot is kept free
    await tick()
    const user = runGh(READ(5), { skipDaemon: true })
    await tick()
    expect(calls.map(c => c.args[2])).toEqual(['9', '5'])
    const lowJoin = runGh(READ(5), { skipDaemon: true, priority: 'low' })
    calls[1].finish(ok('{"n":5}'))
    await expect(user).resolves.toEqual({ n: 5 })
    await expect(lowJoin).resolves.toEqual({ n: 5 })
    calls[0].finish()
    await tick()
    calls[2]?.finish(ok('{"n":5}'))
    await Promise.all([busy, low])
    expect(calls).toHaveLength(3)
  })

  it('a write drops in-flight reads, so the read after it spawns fresh', async () => {
    const calls = deferredExeca()
    const before = runGh(READ(6), { skipDaemon: true })
    await tick()
    const write = runGh(['pr', 'comment', '6', '--repo', 'o/r', '--body', 'x'])
    await tick()
    calls[1].finish()
    await write
    const after = runGh(READ(6), { skipDaemon: true })
    await tick()
    expect(calls.map(c => c.args.slice(0, 2).join(' '))).toEqual(['pr view', 'pr comment', 'pr view'])
    calls[0].finish()
    calls[2].finish()
    await Promise.all([before, after])
  })
})
