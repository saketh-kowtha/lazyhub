#!/usr/bin/env node
// Pre-publish smoke test (#282): pack the working tree, install the tarball into
// an empty global prefix with a throwaway HOME, and prove the package is
// self-contained -- no runtime dependencies resolved, and the bundled CLI runs.
//
// Usage: npm run build && node scripts/packed-install-smoke.mjs
// Subprocesses use execFileSync with array args only. Exits non-zero on failure.

import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, mkdirSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const root = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const work = mkdtempSync(join(tmpdir(), 'lazyhub-packed-'))
const home = join(work, 'home')
mkdirSync(home)
const env = { ...process.env, HOME: home, USERPROFILE: home, XDG_CONFIG_HOME: join(home, '.config'), XDG_CACHE_HOME: join(home, '.cache') }
const prefix = join(work, 'prefix')
const run = (cmd, argv, opts = {}) =>
  execFileSync(cmd, argv, { encoding: 'utf8', env, shell: process.platform === 'win32' && cmd === 'npm', ...opts })
const failures = []
const check = (cond, msg) => { console.log(`${cond ? 'ok:  ' : 'FAIL:'} ${msg}`); if (!cond) failures.push(msg) }

try {
  const tgzName = run('npm', ['pack', '--silent', '--pack-destination', work], { cwd: root }).trim().split('\n').pop()
  run('npm', ['install', '-g', '--prefix', prefix, '--no-audit', '--no-fund', join(work, tgzName)])

  const globalRoot = run('npm', ['root', '-g', '--prefix', prefix]).trim()
  const installed = join(globalRoot, 'lazyhub')
  check(existsSync(join(installed, 'dist', 'lazyhub.js')), 'tarball installed with dist/lazyhub.js')
  check(!existsSync(join(installed, 'node_modules')), 'no nested node_modules (no runtime dependencies installed)')
  check(readdirSync(globalRoot).join() === 'lazyhub', `global prefix contains only lazyhub (found: ${readdirSync(globalRoot).join(', ')})`)
  for (const asset of ['yoga.wasm', 'defaultConfig.toml', 'THIRD_PARTY_LICENSES']) {
    check(existsSync(join(installed, 'dist', asset)), `dist/${asset} shipped`)
  }

  const ls = JSON.parse(run('npm', ['ls', '-g', '--prefix', prefix, '--all', '--json']))
  check(Object.keys(ls.dependencies ?? {}).join() === 'lazyhub' && !ls.dependencies.lazyhub.dependencies, 'npm ls shows lazyhub with no dependencies')

  const bin = join(installed, 'dist', 'lazyhub.js')
  const version = run('node', [bin, '--version'], { timeout: 30_000 }).trim()
  check(/^\d+\.\d+\.\d+/.test(version), `--version reports ${version}`)
  // doctor exits non-zero when the temp HOME has no config; only its output matters here.
  const doctor = spawnSync('node', [bin, 'doctor', '--help'], { encoding: 'utf8', env, timeout: 30_000 })
  check(doctor.stdout.includes('Schema validation passed'), 'doctor --help runs (bundled ESM + lazy chunks load)')
} catch (err) {
  failures.push(`unexpected error: ${err.stdout || ''}${err.stderr || ''}${err.message}`)
  console.error(failures.at(-1))
} finally {
  rmSync(work, { recursive: true, force: true })
}

if (failures.length) {
  console.error(`\n${failures.length} packed-install check(s) failed`)
  process.exit(1)
}
console.log('\nAll packed-install checks passed')
