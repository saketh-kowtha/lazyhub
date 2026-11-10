import { describe, expect, it } from 'vitest'
import { nodeVersionProblem, MIN_NODE_MAJOR } from './node-guard.js'

describe('nodeVersionProblem (A4)', () => {
  it.each(['16.16.0', '18.17.0', '19.9.0'])('rejects Node %s with a one-line cause and the next step', (v) => {
    const msg = nodeVersionProblem(v)
    expect(msg).toContain(`Node.js ${MIN_NODE_MAJOR} or newer`)
    expect(msg).toContain(v)
    expect(msg).toContain('nvm install')
    expect(msg).not.toMatch(/SyntaxError|\n\s+at /)
  })
  it.each(['20.0.0', '22.20.0', '26.1.0'])('accepts Node %s', (v) => {
    expect(nodeVersionProblem(v)).toBeNull()
  })
  it('accepts the running Node (tests run on a supported version)', () => {
    expect(nodeVersionProblem()).toBeNull()
  })
})

// End to end on a real old Node, when one is installed (nvm): the built entry prints the guard
// message and exits 1 instead of a SyntaxError stack. Skipped where no Node 18 exists.
import { existsSync, readdirSync } from 'node:fs'
import { userInfo } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

// Real home: the suite runs with a temp HOME.
const nvmDir = join(process.env.NVM_DIR || join(userInfo().homedir, '.nvm'), 'versions', 'node')
const old = existsSync(nvmDir) ? readdirSync(nvmDir).find(v => /^v(16|18)\./.test(v)) : undefined
describe.skipIf(!old)('built entry on an old Node (A4)', () => {
  it('prints the guard message, exit 1, no stack trace', () => {
    const entry = new URL('../../dist/lazyhub.js', import.meta.url).pathname
    const r = spawnSync(join(nvmDir, old, 'bin', 'node'), [entry, '--help'], { encoding: 'utf8' })
    expect(r.status).toBe(1)
    expect(r.stderr).toMatch(/needs Node\.js 20 or newer/)
    expect(r.stderr).not.toMatch(/SyntaxError/)
    expect(r.stdout).toBe('')
  })
})
