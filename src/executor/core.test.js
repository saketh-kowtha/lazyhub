import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('execa', () => ({ execa: vi.fn() }))
vi.mock('../daemon/lifecycle.js', () => ({ requestDaemon: vi.fn() }))
vi.mock('../daemon/audit.js', () => ({ writeAuditEntry: vi.fn(), hashArgs: vi.fn(() => 'h') }))
vi.mock('../cache.js', () => ({ invalidateRepoCache: vi.fn() }))

import { execa } from 'execa'
import { requestDaemon } from '../daemon/lifecycle.js'
import { writeAuditEntry } from '../daemon/audit.js'
import { invalidateRepoCache } from '../cache.js'
import { runGh, GhError, getGhCallHistory } from './core.js'
import { classifyGhFailure } from './classify.js'
import { onWrite } from '../data/invalidation.js'
import { clearDaemonFallback, getDaemonFallback } from '../daemon/fallback.js'

const ok = (stdout = '[]') => ({ exitCode: 0, stdout, stderr: '' })
const WRITE = ['pr', 'merge', '7', '--repo', 'o/r']
const TYPED_READ = ['pr', 'diff', '7', '--repo', 'o/r']

beforeEach(() => {
  vi.resetAllMocks()
  clearDaemonFallback()
  delete process.env.GH_HOST
  process.env.LAZYHUB_DAEMON_SOCKET = '/nonexistent/daemon.sock'
  execa.mockResolvedValue(ok())
  requestDaemon.mockRejectedValue(new Error('daemon gone'))
})

describe('runGh fail-closed write handling', () => {
  it('refuses unknown operations without spawning gh', async () => {
    await expect(runGh(['repo', 'delete', 'o/r'])).rejects.toBeInstanceOf(GhError)
    expect(execa).not.toHaveBeenCalled()
    expect(writeAuditEntry).not.toHaveBeenCalled()
  })

  it('blocks a write when the audit intent cannot be recorded', async () => {
    writeAuditEntry.mockImplementationOnce(() => { throw new Error('disk full') })
    await expect(runGh(WRITE)).rejects.toThrow(/audit log unavailable/)
    expect(execa).not.toHaveBeenCalled()
  })

  it('audits intent before and result after a write, then drops cached reads', async () => {
    await runGh(WRITE)
    expect(writeAuditEntry.mock.calls.map(c => c[0].phase)).toEqual(['intent', 'result'])
    expect(writeAuditEntry.mock.calls[1][0].outcome).toBe('ok')
    expect(invalidateRepoCache).toHaveBeenCalledWith('o/r')
  })

  it('announces a finished write after the daemon cache is dropped, so revalidation reads fresh data (#481)', async () => {
    const order = []
    requestDaemon.mockImplementation(async (_socket, msg) => { order.push(`daemon:${msg.type}`); return {} })
    const off = onWrite(({ repo }) => order.push(`notify:${repo}`))
    try {
      await runGh(WRITE)
    } finally { off() }
    expect(order).toEqual(['daemon:invalidate', 'notify:o/r'])
  })

  it('announces a failed write too (the remote outcome is ambiguous) and never a read (#481)', async () => {
    const seen = []
    const off = onWrite(({ repo }) => seen.push(repo))
    try {
      execa.mockRejectedValueOnce(Object.assign(new Error('boom'), { exitCode: 1, stderr: 'boom' }))
      await expect(runGh(WRITE)).rejects.toBeInstanceOf(GhError)
      expect(seen).toEqual(['o/r'])
      execa.mockResolvedValue(ok())
      await runGh(TYPED_READ, { skipDaemon: true })
      expect(seen).toEqual(['o/r'])
    } finally { off() }
  })

  it('tells the daemon to drop its cache after a write, authenticated; a failure is logged, not thrown', async () => {
    process.env.LAZYHUB_DAEMON_TOKEN_FILE = '/nonexistent/daemon.token'
    requestDaemon.mockResolvedValueOnce({ ok: true })
    await runGh(WRITE)
    expect(requestDaemon).toHaveBeenCalledWith(
      '/nonexistent/daemon.sock', { type: 'invalidate', repo: 'o/r' }, 2000, { tokenPath: '/nonexistent/daemon.token' },
    )
    requestDaemon.mockRejectedValueOnce(new Error('denied'))
    await expect(runGh(WRITE)).resolves.toEqual([])
    expect(getGhCallHistory().at(-1).error).toMatch(/invalidate failed: denied/)
    delete process.env.LAZYHUB_DAEMON_TOKEN_FILE
  })

  it('does not audit reads, so an unavailable audit log never blocks them', async () => {
    writeAuditEntry.mockImplementation(() => { throw new Error('disk full') })
    await expect(runGh(['pr', 'list', '--repo', 'o/r'])).resolves.toEqual([])
    expect(writeAuditEntry).not.toHaveBeenCalled()
  })

  it('never sends a write to the daemon as a read or retries it after daemon loss or failure', async () => {
    execa.mockResolvedValue({ exitCode: 1, stdout: '', stderr: 'boom' })
    await expect(runGh(WRITE)).rejects.toBeInstanceOf(GhError)
    expect(requestDaemon.mock.calls.filter(c => c[1].type === 'read')).toEqual([])
    expect(execa).toHaveBeenCalledTimes(1)
    expect(writeAuditEntry.mock.calls[1][0].outcome).toBe('error')
  })

  it('falls back to direct gh only for allowlisted reads when the daemon is gone', async () => {
    await expect(runGh(TYPED_READ)).resolves.toEqual([])
    expect(requestDaemon).toHaveBeenCalledTimes(1)
    expect(execa).toHaveBeenCalledTimes(1)
  })
})

describe('runGh spawn failure', () => {
  const savedPath = process.env.PATH
  afterEach(() => { process.env.PATH = savedPath })

  // execa is mocked for this file; restore the real spawner so ENOENT is real.
  const useRealExeca = async () => {
    const actual = await vi.importActual('execa')
    execa.mockImplementation(actual.execa)
  }

  it('a missing gh binary is classified as gh_missing, not unknown', async () => {
    await useRealExeca()
    process.env.PATH = '/nonexistent-dir-for-audit'
    let err
    try { await runGh(['pr', 'list', '--repo', 'a/b']) } catch (e) { err = e }
    expect(err).toBeDefined()
    expect(classifyGhFailure(err).kind).toBe('gh_missing')
  })

  it('a missing gh binary keeps the spawn error text and a numeric exit code', async () => {
    await useRealExeca()
    process.env.PATH = '/nonexistent-dir-for-audit'
    let err
    try { await runGh(['pr', 'list', '--repo', 'a/b']) } catch (e) { err = e }
    expect(`${err.message} ${err.stderr}`).toMatch(/ENOENT/)
    expect(Number.isInteger(err.exitCode)).toBe(true)
  })
})

describe('daemon read fallback is visible (#491)', () => {
  it('a failed daemon read falls back to gh, records the notice, and skips the daemon for a while', async () => {
    execa.mockResolvedValue(ok('{"n":1}'))
    expect(getDaemonFallback()).toBeNull()
    expect(await runGh(TYPED_READ)).toBeDefined()
    expect(requestDaemon).toHaveBeenCalledTimes(1)
    expect(execa).toHaveBeenCalledTimes(1)
    expect(getDaemonFallback()).toMatch(/without the background helper/)

    // Within the retry window the daemon is not asked again (a hung helper must not add its timeout to every read).
    await runGh(TYPED_READ)
    expect(requestDaemon).toHaveBeenCalledTimes(1)
    expect(execa).toHaveBeenCalledTimes(2)
  })

  it('a successful daemon read clears the notice', async () => {
    requestDaemon.mockRejectedValueOnce(new Error('gone'))
    await runGh(TYPED_READ)
    expect(getDaemonFallback()).not.toBeNull()
    clearDaemonFallback() // the retry window ends (or a lazy start finds the helper)
    requestDaemon.mockResolvedValueOnce({ ok: true, payload: 'from-daemon' })
    expect(await runGh(TYPED_READ)).toBe('from-daemon')
    expect(getDaemonFallback()).toBeNull()
  })

  it('does not record a notice when the daemon was never in play', async () => {
    delete process.env.LAZYHUB_DAEMON_SOCKET
    await runGh(TYPED_READ)
    expect(requestDaemon).not.toHaveBeenCalled()
    expect(getDaemonFallback()).toBeNull()
  })
})
