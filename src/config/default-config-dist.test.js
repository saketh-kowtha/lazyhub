import { describe, it, expect, afterEach } from 'vitest'
import { build } from 'esbuild'
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { pathToFileURL } from 'url'

let dir
afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }) })

describe('bundled default config (packaged builds)', () => {
  it('build.js ships defaultConfig.toml beside the bundle entry', () => {
    expect(readFileSync('build.js', 'utf8')).toContain("copyFile('src/config/defaultConfig.toml', 'dist/defaultConfig.toml')")
  })

  it('writeDefaultConfig finds the default TOML when bundled into a flat dist/', async () => {
    dir = mkdtempSync(join(tmpdir(), 'lazyhub-dist-'))
    await build({
      entryPoints: ['src/config.js'], bundle: true, platform: 'node', format: 'esm',
      outdir: join(dir, 'dist'), packages: 'external', loader: { '.js': 'jsx' }, logLevel: 'silent',
    })
    // Mirror build.js's asset copy.
    copyFileSync('src/config/defaultConfig.toml', join(dir, 'dist', 'defaultConfig.toml'))
    const built = await import(pathToFileURL(join(dir, 'dist', 'config.js')).href)
    const target = join(dir, 'home', 'lazyhub.toml')
    built.writeDefaultConfig(target)
    expect(existsSync(target)).toBe(true)
  })
})
