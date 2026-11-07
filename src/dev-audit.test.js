import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// Dev-dependency audit guard (#388): the advisories fixed by the test-exclude override must
// not come back through a lockfile regeneration, and Vitest stays on the pinned ^3 line.
const root = new URL('../', import.meta.url)
const lock = JSON.parse(readFileSync(new URL('package-lock.json', root), 'utf8'))
const manifest = JSON.parse(readFileSync(new URL('package.json', root), 'utf8'))

const versionsOf = (name) => Object.entries(lock.packages)
  .filter(([path]) => path === `node_modules/${name}` || path.endsWith(`/node_modules/${name}`))
  .map(([, pkg]) => pkg.version)
const cmp = (a, b) => {
  const [x, y] = [a, b].map(v => v.split('-')[0].split('.').map(Number))
  for (let i = 0; i < 3; i += 1) if (x[i] !== y[i]) return x[i] - y[i]
  return 0
}

describe('dev dependency audit (#388)', () => {
  it('no glob in 9.0.0 - 14.0.1 (GHSA-3g3m-2fjr-6pw4)', () => {
    for (const v of versionsOf('glob')) expect(cmp(v, '9.0.0') < 0 || cmp(v, '14.0.2') >= 0, `glob@${v}`).toBe(true)
  })

  it('no minimatch in 7.0.0 - 11.0.0 (GHSA-g3hv-75wg-m249)', () => {
    for (const v of versionsOf('minimatch')) expect(cmp(v, '7.0.0') < 0 || cmp(v, '11.0.1') >= 0, `minimatch@${v}`).toBe(true)
  })

  it('the coverage tool chain override is declared, and Vitest and its coverage plugin stay on ^3', () => {
    expect(manifest.overrides['test-exclude']).toEqual({ glob: '^14.0.2', minimatch: '^11.0.1' })
    expect(manifest.devDependencies.vitest).toMatch(/^\^3\./)
    expect(manifest.devDependencies['@vitest/coverage-v8']).toMatch(/^\^3\./)
  })
})
