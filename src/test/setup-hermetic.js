// Per-worker setup: point HOME (and XDG dirs) at a throwaway temp dir BEFORE any
// module resolves os.homedir(), so USER_CONFIG_PATH, the cache dir, logs and
// sockets never touch the developer's real ~/.config/lazyhub (#291).
import { spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { afterAll } from 'vitest'

const home = mkdtempSync(join(tmpdir(), 'lazyhub-test-home-'))

// Guard (#479): a test must never reach the real browser, git or clipboard. Each of these names is a
// shim at the front of PATH that records its call and exits non-zero; afterAll fails the file if one ran.
// Tests that really need git (a throwaway repo) get the genuine binary from LAZYHUB_REAL_GIT.
const SHIMMED = ['open', 'xdg-open', 'git', 'pbcopy', 'xclip']
const shimDir = join(home, 'guard-bin')
const shimLog = join(home, 'guard-calls.log')
if (!process.env.LAZYHUB_REAL_GIT) {
  const found = spawnSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).stdout.trim()
  if (found) process.env.LAZYHUB_REAL_GIT = found
}
mkdirSync(shimDir)
writeFileSync(shimLog, '')
for (const name of SHIMMED) {
  const file = join(shimDir, name)
  writeFileSync(file, `#!/bin/sh\necho "${name} $*" >> "${shimLog}"\necho "lazyhub test guard: a test ran the real ${name}; mock it" >&2\nexit 97\n`)
  chmodSync(file, 0o755)
}
process.env.PATH = `${shimDir}${delimiter}${process.env.PATH}`
process.env.HOME = home
process.env.USERPROFILE = home
process.env.XDG_CONFIG_HOME = join(home, '.config')
process.env.XDG_CACHE_HOME = join(home, '.cache')
delete process.env.XDG_RUNTIME_DIR

// Each test file gets its own home; remove it so runs don't leak temp dirs. Best effort:
// the async disk cache can still be writing into it (ENOTEMPTY), which must not fail the file.
afterAll(() => {
  const calls = existsSync(shimLog) ? readFileSync(shimLog, 'utf8').trim() : ''
  try { rmSync(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }) } catch { /* left in tmpdir */ }
  if (calls) throw new Error(`A test started a real process that must be mocked (#479):\n${calls}`)
})
