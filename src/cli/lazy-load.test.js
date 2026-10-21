/**
 * #302 — non-TUI commands must not load the TUI stack. Builds the real code-split
 * bundle, runs each command under a module-resolution recorder, and asserts the
 * recorded specifiers contain no ink/react/highlight.js.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { execFileSync, spawnSync } from 'child_process'
import { mkdtempSync, readFileSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { dirname, join } from 'path'

const ROOT = new URL('../..', import.meta.url).pathname
const BIN = join(ROOT, 'dist', 'lazyhub.js')
const PRELOAD = join(ROOT, 'src', 'test', 'record-imports-register.mjs')
const TUI_PACKAGES = /^(ink|react|react-reconciler|highlight\.js)(\/|$)/

function loadedSpecifiers(args) {
  const home = mkdtempSync(join(tmpdir(), 'lazyhub-lazy-'))
  const out = join(home, 'imports.txt')
  spawnSync(process.execPath, ['--import', PRELOAD, BIN, ...args], {
    // No gh on PATH: commands fail fast offline, after their imports have run.
    env: { PATH: dirname(process.execPath), HOME: home, USER: 'lazyhub', LAZYHUB_RECORD_IMPORTS: out, LAZYHUB_NO_DAEMON: '1' },
    input: '',
    timeout: 30_000,
  })
  return existsSync(out) ? readFileSync(out, 'utf8').split('\n').filter(Boolean) : []
}

describe('code-split bundle', () => {
  beforeAll(() => {
    execFileSync(process.execPath, ['build.js'], { cwd: ROOT, stdio: 'ignore' })
  }, 60_000)

  it('recorder detects the TUI stack when it is actually imported (control)', () => {
    const home = mkdtempSync(join(tmpdir(), 'lazyhub-lazy-'))
    const out = join(home, 'imports.txt')
    spawnSync(process.execPath, ['--import', PRELOAD, '--input-type=module', '-e', "await import('ink')"], {
      cwd: ROOT, env: { PATH: dirname(process.execPath), LAZYHUB_RECORD_IMPORTS: out },
    })
    expect(readFileSync(out, 'utf8').split('\n').filter(s => TUI_PACKAGES.test(s))).toContain('ink')
  })

  it.each([
    [['--version']],
    [['doctor', '--json']],
    [['watch-only', '--json', '--repo', 'o/r']],
    [['--mcp']],
    [['serve', '--status']],
    [['status']],
  ])('%j never loads ink, react or highlight.js', args => {
    const specs = loadedSpecifiers(args)
    expect(specs.filter(s => TUI_PACKAGES.test(s))).toEqual([])
  })
})
