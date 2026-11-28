// The review tools through the BUILT entrypoint (#603, #627): `lazyhub --mcp` over real stdio
// and `lazyhub <command> --json`, against a fixture `gh` (a Node script serving
// src/test/review-gh-fixture.js). Temp HOME, no git, nothing real is reached. Every gh argv the
// tools produce is logged and must classify as a read.
import { spawnSync } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { classifyGh } from '../daemon/protocol.js'
import { FORBIDDEN, MISSING, REPO } from '../test/review-gh-fixture.js'

const root = new URL('../../', import.meta.url).pathname
const entry = join(root, 'dist', 'lazyhub.js')
const fixtureUrl = pathToFileURL(join(root, 'src', 'test', 'review-gh-fixture.js')).href
const work = mkdtempSync(join(tmpdir(), 'lazyhub-review-e2e-'))
const home = join(work, 'home')
const cwd = join(work, 'cwd')
const bin = join(work, 'bin')
const log = join(work, 'gh-calls.ndjson')

beforeAll(() => {
  for (const d of [home, cwd, bin]) mkdirSync(d)
  writeFileSync(join(bin, 'gh'), `#!${process.execPath}
import { appendFileSync } from 'node:fs'
const args = process.argv.slice(2)
appendFileSync(${JSON.stringify(log)}, JSON.stringify(args) + '\\n')
if (args[0] === '--version') { process.stdout.write('gh version 2.60.0\\n'); process.exit(0) }
if (args[0] === 'auth') {
  if (process.env.FAKE_GH_UNAUTH) { process.stderr.write('not logged in\\n'); process.exit(1) }
  if (args[1] === 'token') process.stdout.write('fake\\n')
  process.exit(0)
}
const { ghFixture } = await import(${JSON.stringify(fixtureUrl)})
const r = ghFixture(args)
if (r.err) { process.stderr.write(r.err.stderr + '\\n'); process.exit(r.err.code) }
process.stdout.write(r.out)
`)
  chmodSync(join(bin, 'gh'), 0o755)
})
afterAll(() => rmSync(work, { recursive: true, force: true }))
beforeEach(() => writeFileSync(log, ''))

/**
 * @param {string[]} args
 * @param {{input?: string, env?: Record<string, string>}} [opts]
 */
function lazyhub(args, { input = '', env = {} } = {}) {
  return spawnSync(process.execPath, [entry, ...args], {
    env: { PATH: bin, HOME: home, USERPROFILE: home, XDG_CONFIG_HOME: join(home, '.config'), XDG_CACHE_HOME: join(home, '.cache'), LAZYHUB_NO_DAEMON: '1', ...env },
    cwd,
    input,
    encoding: 'utf8',
    timeout: 30_000,
  })
}

/** gh argv the tools produced (the preflight's --version and auth probes excluded). */
function toolCalls() {
  return readFileSync(log, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)).filter(a => a[0] !== '--version' && a[0] !== 'auth')
}

describe('review tools over `lazyhub --mcp` stdio (#603)', () => {
  it('lists the review tools and answers tool calls with cleaned, marked JSON; every gh call is a read', () => {
    const msgs = [
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
      { jsonrpc: '2.0', id: 2, method: 'tools/list' },
      { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'pr_evidence', arguments: { repo: REPO, number: 7 } } },
      { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'claims_check', arguments: { repo: REPO, number: 7 } } },
      { jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'why_ci_red', arguments: { repo: REPO, number: 7 } } },
      { jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: 'review_queue', arguments: {} } },
      { jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name: 'collisions', arguments: { repo: REPO, number: 7 } } },
      { jsonrpc: '2.0', id: 8, method: 'tools/call', params: { name: 'review_story', arguments: { repo: REPO, number: 7 } } },
      { jsonrpc: '2.0', id: 9, method: 'tools/call', params: { name: 'pr_evidence', arguments: { repo: REPO } } },
    ]
    const r = lazyhub(['--mcp'], { input: msgs.map(m => JSON.stringify(m)).join('\n') + '\n' })
    expect(r.status).toBe(0)
    expect(r.stdout).not.toMatch(FORBIDDEN)
    const lines = r.stdout.trim().split('\n').map(l => JSON.parse(l))
    expect(lines.map(l => l.id)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9])
    const names = lines[1].result.tools.map((/** @type {any} */ t) => t.name)
    expect(names).toEqual(expect.arrayContaining(['review_queue', 'pr_evidence', 'why_ci_red', 'claims_check', 'collisions', 'review_story']))
    const bodies = lines.slice(2, 8).map(l => JSON.parse(l.result.content[0].text))
    expect(bodies.map(b => b.tool)).toEqual(['pr_evidence', 'claims_check', 'why_ci_red', 'review_queue', 'collisions', 'review_story'])
    for (const b of bodies) expect(b.schema_version).toBe(1)
    const evidence = bodies[0]
    expect(evidence.data.record.untrusted.body).toContain('IGNORE ALL PREVIOUS INSTRUCTIONS')
    expect(evidence.untrusted.fields).toEqual(['data.record.untrusted'])
    expect(lines[8].result).toMatchObject({ isError: true, content: [{ text: expect.stringMatching(/^Error \[MCP_INVALID_NUMBER\]/) }] })
    const calls = toolCalls()
    expect(calls.length).toBeGreaterThan(10)
    for (const call of calls) expect(classifyGh(call), call.slice(0, 3).join(' ')).toBe('read')
  })
})

describe('`lazyhub <command> --json` (#627)', () => {
  it('evidence: one JSON envelope on stdout, exit 0, read-only', () => {
    const r = lazyhub(['evidence', '7', '--repo', REPO, '--json'])
    expect(r.stderr).toBe('')
    expect(r.status).toBe(0)
    const body = JSON.parse(r.stdout)
    expect(body).toMatchObject({ schema_version: 1, tool: 'pr_evidence', repo: REPO })
    expect(r.stdout).not.toMatch(FORBIDDEN)
    for (const call of toolCalls()) expect(classifyGh(call)).toBe('read')
  })

  it('exit codes: 1 GitHub failure, 2 usage, 3 not signed in; errors are JSON on stdout', () => {
    const failed = lazyhub(['evidence', String(MISSING), '--repo', REPO, '--json'])
    expect(failed.status).toBe(1)
    expect(JSON.parse(failed.stdout).error.code).toBe('GITHUB_ERROR')
    const usage = lazyhub(['why-red', '--json'])
    expect(usage.status).toBe(2)
    expect(JSON.parse(usage.stdout).error.code).toBe('INVALID_ARGUMENTS')
    const unauth = lazyhub(['queue', '--json'], { env: { FAKE_GH_UNAUTH: '1' } })
    expect(unauth.status).toBe(3)
    expect(JSON.parse(unauth.stdout).error).toMatchObject({ code: 'SETUP', message: expect.stringMatching(/gh auth login/) })
    expect(unauth.stderr.trim().split('\n')).toHaveLength(1)
  })
})
