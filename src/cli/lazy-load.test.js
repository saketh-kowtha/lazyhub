/**
 * #302 — non-TUI commands must not load the TUI stack. Builds the real code-split
 * bundle, runs each command under a module-resolution recorder, and asserts the
 * recorded specifiers contain no ink/react/highlight.js. Since #282 bundles those
 * packages, a loaded dist chunk is also checked for their bundled sources.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { execFileSync, spawnSync } from 'child_process'
import { mkdtempSync, readFileSync, readdirSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { dirname, join } from 'path'
import { builtinModules } from 'module'
import { fileURLToPath, pathToFileURL } from 'url'

const ROOT = new URL('../..', import.meta.url).pathname
const BIN = join(ROOT, 'dist', 'lazyhub.js')
const PRELOAD = join(ROOT, 'src', 'test', 'record-imports-register.mjs')
const TUI_PACKAGES = /^(ink|react|react-reconciler|highlight\.js)(\/|$)/

// esbuild prefixes each bundled module with `// node_modules/<pkg>/...`.
const BUNDLED_TUI = /^\/\/ node_modules\/(ink|react|react-reconciler|highlight\.js)\//m

/**
 * Resolved dist chunks (from the recorder output) that contain bundled TUI packages.
 * @param {string[]} specs
 */
function tuiChunks(specs) {
  return specs
    .filter(s => s.startsWith('file://') && s.startsWith(pathToFileUrlPrefix))
    .map(s => fileURLToPath(s))
    .filter(f => BUNDLED_TUI.test(readFileSync(f, 'utf8')))
}
const pathToFileUrlPrefix = `${pathToFileURL(join(ROOT, 'dist')).href}/`

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

  it('chunk check detects the TUI stack when a TUI chunk is actually imported (control)', () => {
    const home = mkdtempSync(join(tmpdir(), 'lazyhub-lazy-'))
    const out = join(home, 'imports.txt')
    const chunk = readdirSync(join(ROOT, 'dist')).find(f => f.endsWith('.js') && BUNDLED_TUI.test(readFileSync(join(ROOT, 'dist', f), 'utf8')))
    spawnSync(process.execPath, ['--import', PRELOAD, '--input-type=module', '-e', `await import(${JSON.stringify(join(ROOT, 'dist', chunk))})`], {
      cwd: ROOT, env: { PATH: dirname(process.execPath), HOME: home, LAZYHUB_RECORD_IMPORTS: out }, timeout: 30_000,
    })
    expect(tuiChunks(readFileSync(out, 'utf8').split('\n').filter(Boolean)).length).toBeGreaterThan(0)
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
    expect(tuiChunks(specs)).toEqual([])
  })
})

describe('self-contained package (#282)', () => {
  const DIST = join(ROOT, 'dist')
  const distFiles = () => readdirSync(DIST).filter(f => f.endsWith('.js'))

  it('declares no runtime dependencies', () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
    for (const field of ['dependencies', 'peerDependencies', 'optionalDependencies']) {
      expect(pkg[field] ?? {}, field).toEqual({})
    }
  })

  it('dist imports only relative files and Node builtins', () => {
    const builtins = new Set(builtinModules)
    const bare = []
    for (const file of distFiles()) {
      const src = readFileSync(join(DIST, file), 'utf8')
      // esbuild's ESM output: `import ... from "x"`, `} from "x"`, `import "x"`, `import("x")`, `__require("x")`.
      for (const m of src.matchAll(/^(?:import .*|\s*\}) from "([^"]+)";?$|^import "([^"]+)";?$|[^.\w]import\("([^"]+)"\)|\b__require\("([^"]+)"\)/gm)) {
        const spec = m[1] ?? m[2] ?? m[3] ?? m[4]
        if (spec.startsWith('.') || spec.startsWith('node:') || builtins.has(spec) || builtins.has(spec.split('/')[0])) continue
        bare.push(`${file}: ${spec}`)
      }
    }
    expect(bare).toEqual([])
  })

  it('ships the assets and license notices bundled code needs at runtime', () => {
    expect(existsSync(join(DIST, 'yoga.wasm'))).toBe(true)
    expect(existsSync(join(DIST, 'defaultConfig.toml'))).toBe(true)
    const licenses = readFileSync(join(DIST, 'THIRD_PARTY_LICENSES'), 'utf8')
    for (const name of ['ink@', 'react@', 'highlight.js@', 'yoga-wasm-web@', 'execa@']) expect(licenses).toContain(name)
  })
})
