import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../config.js', () => ({ loadConfig: () => ({}) }))
vi.mock('../daemon/server.js', () => ({ startDaemon: vi.fn() }))
vi.mock('../daemon/lifecycle.js', () => ({
  daemonSocketPath: () => '/tmp/lh-test.sock',
  daemonTokenPath: () => '/tmp/lh-test.token',
  requestDaemon: vi.fn(),
}))

const { runServe } = await import('./serve.js')
const { requestDaemon } = await import('../daemon/lifecycle.js')

describe('lazyhub serve CLI', () => {
  let out
  let err
  let prevChild
  beforeEach(() => {
    out = []
    err = []
    prevChild = process.env.LAZYHUB_DAEMON_CHILD
    vi.spyOn(process.stdout, 'write').mockImplementation(s => { out.push(String(s)); return true })
    vi.spyOn(process.stderr, 'write').mockImplementation(s => { err.push(String(s)); return true })
    requestDaemon.mockReset()
  })
  afterEach(() => {
    vi.restoreAllMocks()
    if (prevChild === undefined) delete process.env.LAZYHUB_DAEMON_CHILD
    else process.env.LAZYHUB_DAEMON_CHILD = prevChild
  })

  it('--status reports a running daemon', async () => {
    requestDaemon.mockResolvedValue({ status: { pid: 42, clients: 1, socketPath: '/s' } })
    expect(await runServe(['--status'])).toBe(0)
    expect(out.join('')).toContain('pid=42 clients=1')
  })

  it('--status exits 1 with machine-readable JSON when the daemon is unavailable', async () => {
    requestDaemon.mockRejectedValue(new Error('ECONNREFUSED'))
    expect(await runServe(['--status', '--json'])).toBe(1)
    expect(JSON.parse(out.join(''))).toEqual({ running: false, socketPath: '/tmp/lh-test.sock', error: 'ECONNREFUSED' })
  })

  it('--status without JSON prints a human not-running line', async () => {
    requestDaemon.mockRejectedValue(new Error('nope'))
    expect(await runServe(['--status'])).toBe(1)
    expect(out.join('')).toContain('not running (nope)')
  })

  it('--stop sends the token path so a denied stop is surfaced as exit 1', async () => {
    requestDaemon.mockRejectedValue(new Error('unauthorized'))
    expect(await runServe(['--stop'])).toBe(1)
    expect(requestDaemon).toHaveBeenCalledWith('/tmp/lh-test.sock', { type: 'stop' }, 1000, { tokenPath: '/tmp/lh-test.token' })
    expect(err.join('')).toContain('stop failed: unauthorized')
  })

  it('--stop succeeds in both output modes', async () => {
    requestDaemon.mockResolvedValue({})
    expect(await runServe(['--stop'])).toBe(0)
    expect(await runServe(['--stop', '--json'])).toBe(0)
    expect(out.join('')).toContain('daemon stopped')
    expect(out.join('')).toContain('{"ok":true}')
  })
})
