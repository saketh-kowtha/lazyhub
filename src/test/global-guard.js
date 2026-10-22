// Fails the whole run if any test touched the developer's real lazyhub config
// dir. Read-only: it only stats/hashes, never writes (#291).
import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const WATCHED = /^(lazyhub\.toml|config\.json|\.config-cache\.toml)$/

function snapshot() {
  const dir = join(homedir(), '.config', 'lazyhub')
  if (!existsSync(dir)) return 'absent'
  // Logs/sockets legitimately change while a real lazyhub runs; guard only config files.
  return readdirSync(dir).filter((n) => WATCHED.test(n)).sort().map((name) => {
    try {
      const p = join(dir, name)
      const st = statSync(p)
      const body = st.isFile() ? createHash('sha256').update(readFileSync(p)).digest('hex') : 'dir'
      return `${name}:${body}`
    } catch { return `${name}:unreadable` }
  }).join('\n')
}

/**
 * Vitest globalSetup: snapshot the real config files, return a teardown that fails on change.
 * @returns {() => void} teardown
 */
export default function setup() {
  const before = snapshot()
  return () => {
    if (snapshot() !== before) {
      throw new Error('Tests modified the real ~/.config/lazyhub. Tests must be hermetic (see src/test/setup-hermetic.js).')
    }
  }
}
