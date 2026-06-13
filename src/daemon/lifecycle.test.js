import { mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import { daemonPidPath, daemonSocketPath, ensureSocketDir, requestDaemon } from './lifecycle.js'

const tempDirs = []

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('daemon lifecycle helpers', () => {
  it('resolves configured unix socket and pid paths', () => {
    const config = {
      daemon: {
        socket_path: '~/.config/lazyhub/test-daemon.sock',
        pid_file: '~/.config/lazyhub/test-daemon.pid',
      },
    }
    expect(daemonSocketPath(config)).toContain('test-daemon.sock')
    expect(daemonPidPath(config)).toContain('test-daemon.pid')
  })

  it('rejects cleanly when no daemon is listening', async () => {
    const dir = mkdtempSync(join(process.cwd(), '.lazyhub-daemon-test-'))
    tempDirs.push(dir)
    const socketPath = join(dir, 'daemon.sock')
    ensureSocketDir(socketPath)
    await expect(requestDaemon(socketPath, { type: 'status', id: 'test' }, 50)).rejects.toThrow()
  })
})
