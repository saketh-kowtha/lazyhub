/**
 * src/test/spawn-adapter.js — lets provider unit tests keep mocking an execFile-shaped
 * function while src/services/ai-cli.js uses spawn. Test-only.
 */
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'

/**
 * @param {object} actual the real node:child_process module
 * @param {Function} fn   vi.fn
 */
export function mockChildProcess(actual, fn) {
  const execFile = fn()
  const spawn = (cmd, args, opts) => {
    /** @type {any} */
    const ee = new EventEmitter()
    ee.stdout = new PassThrough()
    ee.stderr = new PassThrough()
    ee.pid = undefined
    const child = execFile(cmd, args, opts, (err, so, se) => {
      setImmediate(() => {
        if (err?.code === 'ENOENT') { ee.emit('error', err); return }
        if (so) ee.stdout.write(so)
        if (se) ee.stderr.write(se)
        if (err?.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') ee.stdout.write('a'.repeat(256 * 1024 + 1))
        const killed = Boolean(err && (err.killed || err.signal === 'SIGTERM'))
        const code = !err ? 0 : typeof err.code === 'number' ? err.code : (killed || err.signal) ? null : 1
        setImmediate(() => ee.emit('close', code, killed ? 'SIGTERM' : (err?.signal || null)))
      })
    })
    ee.stdin = child?.stdin
    ee.kill = (...a) => child?.kill?.(...a)
    return ee
  }
  return { ...actual, execFile, spawn }
}
