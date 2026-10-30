import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { execa } from 'execa'
import { describe, expect, it } from 'vitest'

const root = new URL('../', import.meta.url)

describe('Dependabot dependency overrides (#355)', () => {
  it.each(['individual', 'grouped'])('%s update can change the direct esbuild specification', async (mode) => {
    const manifest = JSON.parse(readFileSync(new URL('package.json', root), 'utf8'))
    const lock = JSON.parse(readFileSync(new URL('package-lock.json', root), 'utf8'))
    // Use locked versions to exercise npm's override validation without registry access.
    // Even an equivalent range -> exact version change used to throw EOVERRIDE.
    for (const name of mode === 'grouped' ? ['esbuild', 'vite'] : ['esbuild']) {
      const version = lock.packages[`node_modules/${name}`].version
      manifest.devDependencies[name] = version
      lock.packages[''].devDependencies[name] = version
    }
    const dir = mkdtempSync(new URL('.dependency-overrides-', root))
    try {
      writeFileSync(join(dir, 'package.json'), JSON.stringify(manifest))
      writeFileSync(join(dir, 'package-lock.json'), JSON.stringify(lock))
      const result = await execa('npm', ['ls', 'esbuild', '--package-lock-only', '--json', '--offline'], {
        cwd: dir,
        env: { PATH: process.env.PATH, HOME: dir, USER: process.env.USER, npm_config_cache: join(dir, '.npm') },
        extendEnv: false,
        reject: false,
      })
      expect(result.stderr).not.toContain('EOVERRIDE')
      expect(result.exitCode, result.stderr).toBe(0)
      expect(JSON.parse(result.stdout).dependencies.esbuild.version).toBe(manifest.devDependencies.esbuild)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
