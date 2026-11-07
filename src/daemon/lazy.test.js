import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clearDaemonFallback, getDaemonFallback, noteDaemonFallback, onDaemonFallback } from './fallback.js'
import { daemonSkipReason, scheduleDaemon } from './lifecycle.js'

const saved = { NO: process.env.LAZYHUB_NO_DAEMON, CHILD: process.env.LAZYHUB_DAEMON_CHILD }

beforeEach(() => {
  vi.useFakeTimers()
  delete process.env.LAZYHUB_NO_DAEMON
  delete process.env.LAZYHUB_DAEMON_CHILD
  clearDaemonFallback()
})
afterEach(() => {
  vi.useRealTimers()
  for (const [k, key] of [['NO', 'LAZYHUB_NO_DAEMON'], ['CHILD', 'LAZYHUB_DAEMON_CHILD']]) {
    if (saved[k] === undefined) delete process.env[key]
    else process.env[key] = saved[k]
  }
})

describe('lazy daemon start (#491)', () => {
  it('the launcher does not wait on the daemon before rendering', () => {
    const src = readFileSync(new URL('../../bin/lazyhub.js', import.meta.url), 'utf8')
    expect(src).not.toMatch(/await\s+ensureDaemon/)
    expect(src).toMatch(/scheduleDaemon/)
  })

  it('does not probe or spawn until after the delay', async () => {
    const ensure = vi.fn().mockResolvedValue('/run/daemon.sock')
    scheduleDaemon({}, '/bin/lazyhub.js', { delayMs: 200, ensure, trusted: true })
    expect(ensure).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(199)
    expect(ensure).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(2)
    expect(ensure).toHaveBeenCalledTimes(1)
    expect(getDaemonFallback()).toBeNull()
  })

  it('shows a notice when a wanted daemon never comes up, and clears it when it does', async () => {
    const seen = []
    const off = onDaemonFallback(v => seen.push(v))
    scheduleDaemon({}, 'x', { delayMs: 0, ensure: vi.fn().mockResolvedValue(null), trusted: true })
    await vi.advanceTimersByTimeAsync(1)
    expect(getDaemonFallback()).toMatch(/without the background helper/)
    scheduleDaemon({}, 'x', { delayMs: 0, ensure: vi.fn().mockResolvedValue('/s'), trusted: true })
    await vi.advanceTimersByTimeAsync(1)
    expect(getDaemonFallback()).toBeNull()
    expect(seen.length).toBe(2)
    off()
  })

  it('a thrown startup error also becomes the notice, never an unhandled rejection', async () => {
    scheduleDaemon({}, 'x', { delayMs: 0, ensure: vi.fn().mockRejectedValue(new Error('boom')), trusted: true })
    await vi.advanceTimersByTimeAsync(1)
    expect(getDaemonFallback()).toMatch(/without the background helper/)
  })

  it('stays silent when the user turned the helper off or this is the helper itself', async () => {
    const ensure = vi.fn().mockResolvedValue(null)
    expect(daemonSkipReason({ agent: { auto_spawn_daemon: false } })).toBe('disabled')
    process.env.LAZYHUB_NO_DAEMON = '1'
    expect(daemonSkipReason({})).toBe('disabled')
    scheduleDaemon({}, 'x', { delayMs: 0, ensure, trusted: true })
    await vi.advanceTimersByTimeAsync(1)
    expect(ensure).not.toHaveBeenCalled()
    expect(getDaemonFallback()).toBeNull()
  })

  it('noteDaemonFallback is idempotent and notifies once per change', () => {
    const seen = []
    const off = onDaemonFallback(v => seen.push(v))
    noteDaemonFallback('read-failed')
    noteDaemonFallback('read-failed')
    expect(seen).toHaveLength(1)
    clearDaemonFallback()
    expect(seen).toHaveLength(2)
    off()
  })
})
