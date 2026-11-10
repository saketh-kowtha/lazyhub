#!/usr/bin/env node
// Spec-driven stub `gh` for launch-path tests (onboarding journeys, group C).
// LAZYHUB_LAUNCH_SPEC names a JSON file:
//   { hosts: ['github.com', 'ghe.corp'],            // hosts gh is logged in to
//     repos: { 'host/owner/name': { status, body?, location? } } }  // api repos/<o>/<n> answers per host
// `gh repo view` emulates gh's cwd resolution: it reads `git remote -v` and answers
// when exactly one distinct repository on a logged-in host is found.
import { readFileSync, appendFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'

const spec = JSON.parse(readFileSync(process.env.LAZYHUB_LAUNCH_SPEC, 'utf8'))
const args = process.argv.slice(2)
const host = process.env.GH_HOST || 'github.com'
if (spec.log) appendFileSync(spec.log, `${process.env.GH_HOST || '-'} ${args.join(' ')}\n`)
const fail = (msg, code = 1) => { process.stderr.write(`${msg}\n`); process.exit(code) }
const hostArg = () => { const i = args.indexOf('--hostname'); return i >= 0 ? args[i + 1] : host }

if (args[0] === '--version') { process.stdout.write('gh version 2.60.0 (stub)\n'); process.exit(0) }
if (args[0] === 'auth' && args[1] === 'token') {
  const h = hostArg()
  if (spec.hosts.includes(h)) { process.stdout.write(`stub-token-${h}\n`); process.exit(0) }
  fail(`no oauth token found for ${h}`)
}
if (args[0] === 'auth' && args[1] === 'status') {
  const out = spec.hosts.map((h, i) => `${h}\n  ✓ Logged in to ${h} account stub (keyring)\n  - Active account: ${i === 0}\n`).join('\n')
  process.stderr.write(out)
  process.exit(0)
}
if (args[0] === 'repo' && args[1] === 'view') {
  let remotes = ''
  try { remotes = execFileSync('git', ['remote', '-v'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }) } catch { fail('fatal: not a git repository', 1) }
  const found = new Set()
  for (const line of remotes.split('\n')) {
    const m = line.match(/\s(?:https?:\/\/(?:[^@/]+@)?([^/:]+)\/|(?:ssh:\/\/)?(?:[^@/\s]+@)?([^/:\s]+)[:/])([^/\s]+\/[^/\s]+?)(?:\.git)?\/?\s/)
    if (m && spec.hosts.includes(m[1] || m[2])) found.add(m[3])
  }
  if (found.size === 1) {
    const [o, n] = [...found][0].split('/')
    process.stdout.write(JSON.stringify({ name: n, owner: { login: o } }))
    process.exit(0)
  }
  fail(found.size ? 'multiple remotes detected, set a default with gh repo set-default' : 'none of the git remotes configured for this repository point to a known GitHub host')
}
if (args[0] === 'api') {
  const m = (args[1] || '').match(/^repos\/([^/]+)\/([^/?]+)/)
  if (m) {
    const r = spec.repos?.[`${host}/${m[1]}/${m[2]}`]
    if (!r) fail('gh: Not Found (HTTP 404)')
    if (r.status >= 400) fail(`gh: ${r.message || 'error'} (HTTP ${r.status})`)
    if (r.status === 301) { process.stdout.write(JSON.stringify({ message: 'Moved Permanently', url: r.location })); process.exit(0) }
    process.stdout.write(JSON.stringify(r.body ?? { full_name: `${m[1]}/${m[2]}`, archived: false }))
    process.exit(0)
  }
}
process.stdout.write('[]')
