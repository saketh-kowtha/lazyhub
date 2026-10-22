// Per-worker setup: point HOME (and XDG dirs) at a throwaway temp dir BEFORE any
// module resolves os.homedir(), so USER_CONFIG_PATH, the cache dir, logs and
// sockets never touch the developer's real ~/.config/lazyhub (#291).
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll } from 'vitest'

const home = mkdtempSync(join(tmpdir(), 'lazyhub-test-home-'))
process.env.HOME = home
process.env.USERPROFILE = home
process.env.XDG_CONFIG_HOME = join(home, '.config')
process.env.XDG_CACHE_HOME = join(home, '.cache')
delete process.env.XDG_RUNTIME_DIR

// Each test file gets its own home; remove it so runs don't leak temp dirs.
afterAll(() => { rmSync(home, { recursive: true, force: true }) })
