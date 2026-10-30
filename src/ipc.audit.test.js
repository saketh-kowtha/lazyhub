import { mkdtempSync, rmSync } from 'fs'
import { connect } from 'net'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const posix = process.platform !== 'win32'
let root
let ipc
let savedSocket

beforeEach(async () => {
  savedSocket = process.env.LAZYHUB_SOCKET
  root = mkdtempSync(join('/tmp', 'lh-ipca-'))
  process.env.LAZYHUB_SOCKET = join(root, 's.sock')
  ipc = await import('./ipc.js')
})

afterEach(() => {
  ipc.stopIPC()
  if (savedSocket === undefined) delete process.env.LAZYHUB_SOCKET
  else process.env.LAZYHUB_SOCKET = savedSocket
  rmSync(root, { recursive: true, force: true })
})

async function waitForSocket(path) {
  for (let i = 0; i < 100; i += 1) {
    const ok = await new Promise(resolve => {
      const c = connect(path)
      c.once('connect', () => { c.destroy(); resolve(true) })
      c.once('error', () => resolve(false))
    })
    if (ok) return
    await new Promise(r => setTimeout(r, 20))
  }
  throw new Error('socket never came up')
}

describe.skipIf(!posix)('IPC message validation (audit)', () => {
  it.each(['null', '5', '"str"', 'true'])(
    'a well-formed JSON line that is not an object (%s) must not crash the process',
    async (line) => {
      const uncaught = []
      const onUncaught = err => uncaught.push(err)
      process.on('uncaughtException', onUncaught)
      try {
        const path = ipc.startIPC()
        await waitForSocket(path)
        const client = connect(path)
        await new Promise(resolve => client.once('connect', resolve))
        client.write(`${line}\n`)
        await new Promise(r => setTimeout(r, 150))
        client.destroy()
      } finally {
        process.off('uncaughtException', onUncaught)
      }
      expect(uncaught.map(e => e.message)).toEqual([])
    },
  )
})
