#!/usr/bin/env node
// The Homebrew formula and the check that the tap carries the npm version (#472).
//
//   node scripts/homebrew-formula.mjs render <tarball-url> <sha256> <version>   print the formula
//   node scripts/homebrew-formula.mjs check [--wait <seconds>]                  tap version must equal npm `latest`
//
// `render` is what promote.yml pushes to the tap; `check` is its last step and the weekly
// tap-check workflow. Neither publishes anything: `check` only reads the public registry and
// the public tap.

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const TEMPLATE = new URL('../packaging/homebrew/lazyhub.rb.tmpl', import.meta.url)
const NPM_LATEST = 'https://registry.npmjs.org/lazyhub/latest'
const TAP_FORMULA = 'https://raw.githubusercontent.com/saketh-kowtha/homebrew-tap/main/Formula/lazyhub.rb'

/**
 * Fill the formula template.
 * @param {{ url: string, sha256: string, version: string }} values
 * @param {string} [template]
 * @returns {string}
 */
export function renderFormula({ url, sha256, version }, template = readFileSync(TEMPLATE, 'utf8')) {
  if (!/^https:\/\/registry\.npmjs\.org\/lazyhub\/-\/lazyhub-[0-9A-Za-z.+-]+\.tgz$/.test(url)) throw new Error(`unexpected tarball URL: ${url}`)
  if (!/^[0-9a-f]{64}$/.test(sha256)) throw new Error('sha256 must be 64 hex characters')
  if (!/^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?$/.test(version)) throw new Error(`unexpected version: ${version}`)
  return template.replaceAll('@URL@', url).replaceAll('@SHA256@', sha256).replaceAll('@VERSION@', version)
}

/**
 * The version a formula declares, preferring `version "x"` and falling back to the tarball name.
 * @param {string} text
 * @returns {string|null}
 */
export function formulaVersion(text) {
  const explicit = /^\s*version\s+"([^"]+)"/m.exec(text)
  if (explicit) return explicit[1]
  const tarball = /lazyhub-([0-9][^/"]*)\.tgz/.exec(text)
  return tarball ? tarball[1] : null
}

/**
 * @param {{ npm: string|null, tap: string|null }} versions
 * @returns {{ ok: boolean, message: string }}
 */
export function compareTap({ npm, tap }) {
  if (!npm) return { ok: false, message: 'could not read the npm latest version' }
  if (!tap) return { ok: false, message: 'could not read a version from the tap formula' }
  return npm === tap
    ? { ok: true, message: `tap and npm agree on ${npm}` }
    : { ok: false, message: `the Homebrew tap is on ${tap} but npm latest is ${npm}: run Promote for ${npm} (or update Formula/lazyhub.rb)` }
}

async function readVersions() {
  const [npmRes, tapRes] = await Promise.all([fetch(NPM_LATEST), fetch(TAP_FORMULA)])
  const npm = npmRes.ok ? (await npmRes.json()).version ?? null : null
  const tap = tapRes.ok ? formulaVersion(await tapRes.text()) : null
  return { npm, tap }
}

async function check(waitSeconds) {
  const deadline = Date.now() + waitSeconds * 1000
  for (;;) {
    const result = compareTap(await readVersions())
    if (result.ok || Date.now() >= deadline) {
      process.stdout.write(`${result.message}\n`)
      return result.ok ? 0 : 1
    }
    // The tap's raw file and the registry can lag a push by a short while.
    await new Promise(resolve => setTimeout(resolve, 10_000))
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [cmd, ...rest] = process.argv.slice(2)
  if (cmd === 'render') {
    const [url, sha256, version] = rest
    process.stdout.write(renderFormula({ url, sha256, version }))
  } else if (cmd === 'check') {
    const i = rest.indexOf('--wait')
    process.exit(await check(i >= 0 ? Number(rest[i + 1]) || 0 : 0))
  } else {
    process.stderr.write('usage: homebrew-formula.mjs render <url> <sha256> <version> | check [--wait <seconds>]\n')
    process.exit(2)
  }
}
