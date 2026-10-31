#!/usr/bin/env node
// Pre-publish smoke test (#282): pack the working tree, install the tarball into
// an empty global prefix with a throwaway HOME, and prove the package is
// self-contained -- no runtime dependencies resolved, and the bundled CLI runs.
//
// Usage: npm run build && node scripts/packed-install-smoke.mjs
// Subprocesses use execFileSync with array args only. Exits non-zero on failure.

import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

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
  // CLI entry contract (#514): these must answer and exit without starting the TUI.
  // stdin is not a TTY and the timeout is short, so a TUI start shows up as a
  // null status (hang), an Ink raw-mode crash, or alt-screen escape codes.
  const pkgVersion = JSON.parse(readFileSync(join(installed, 'package.json'), 'utf8')).version
  const cli = (args) => spawnSync('node', [bin, ...args], { encoding: 'utf8', env, input: '', timeout: 15_000 })
  const noTui = (r) => r.status !== null && !/\x1b\[\?1049h|Raw mode is not supported/.test(`${r.stdout}${r.stderr}`)
  const v = cli(['--version'])
  check(v.status === 0 && v.stdout.trim() === pkgVersion && noTui(v), `--version prints package.json version ${pkgVersion} and exits 0`)
  const h = cli(['--help'])
  check(h.status === 0 && h.stdout.includes('Usage:') && noTui(h), '--help exits 0 and prints "Usage:"')
  const bad = cli(['--definitely-not-a-flag'])
  check(bad.status === 2 && bad.stderr.includes('Usage:') && noTui(bad), 'unknown flag exits 2 with usage and does not start the TUI')
  // doctor exits non-zero when the temp HOME has no config; only its output matters here.
  const doctor = spawnSync('node', [bin, 'doctor', '--config'], { encoding: 'utf8', env, timeout: 30_000 })
  check(doctor.stdout.includes('Schema validation passed'), 'doctor --config runs (bundled ESM + lazy chunks load)')
  const doctorHelp = spawnSync('node', [bin, 'doctor', '--help'], { encoding: 'utf8', env, timeout: 30_000 })
  check(doctorHelp.status === 0 && /--coverage/.test(doctorHelp.stdout), 'doctor --help prints usage')
  // Evaluating the chunk that bundles Ink's layout engine proves yoga.wasm resolves from the installed dist/ (top-level await).
  const dist = join(installed, 'dist')
  const yogaChunk = readdirSync(dist).find(f => f.endsWith('.js') && readFileSync(join(dist, f), 'utf8').includes('./yoga.wasm'))
  const yoga = yogaChunk
    ? spawnSync('node', ['--input-type=module', '-e', `await import(${JSON.stringify(pathToFileURL(join(dist, yogaChunk)).href)})`], { encoding: 'utf8', env, timeout: 30_000 })
    : { status: 1, stderr: 'no chunk references ./yoga.wasm' }
  check(yoga.status === 0, `bundled Ink layout engine loads yoga.wasm${yoga.status === 0 ? '' : `: ${yoga.stderr}`}`)
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
