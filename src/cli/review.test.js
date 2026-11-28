// `lazyhub <review command> --json` (#627) in-process: argument parsing, exit codes, structured
// errors, and the same envelope the MCP tools return (the real core; only gh is the fixture).
import { describe, expect, it, vi } from 'vitest'

const gh = vi.hoisted(() => ({ calls: /** @type {string[][]} */ ([]) }))
vi.mock('execa', async () => {
  const { ghFixture } = await import('../test/review-gh-fixture.js')
  return {
    execa: vi.fn((_cmd, args = []) => {
      gh.calls.push([...args])
      const r = ghFixture(args)
      const result = 'err' in r ? { stdout: '', stderr: r.err.stderr, exitCode: r.err.code } : { stdout: r.out, stderr: '', exitCode: 0 }
      return Object.assign(Promise.resolve(result), { stdin: { write() {}, end() {} } })
    }),
  }
})

import { EXIT, REVIEW_COMMANDS, REVIEW_USAGE, parseReviewArgs, runReviewCli } from './review.js'
import { runReviewTool } from '../review-tools/index.js'
import { classifyGh } from '../daemon/protocol.js'
import { FORBIDDEN, MISSING, REPO } from '../test/review-gh-fixture.js'
import { validateSchema } from '../test/json-schema-lite.js'
import { ENVELOPE_SCHEMA, ERROR_SCHEMA } from '../review-tools/schemas.js'

const NOW = Date.parse('2026-11-20T10:05:00Z')

/**
 * @param {string} command
 * @param {string[]} argv
 * @param {{ok: boolean, message?: string}} [pre]
 */
async function cli(command, argv, pre = { ok: true }) {
  const out = { stdout: '', stderr: '' }
  const io = {
    stdout: { write: (/** @type {string} */ s, /** @type {any} */ cb) => { out.stdout += s; cb?.() } },
    stderr: { write: (/** @type {string} */ s, /** @type {any} */ cb) => { out.stderr += s; cb?.() } },
  }
  const preflight = vi.fn(async () => pre)
  const code = await runReviewCli(command, argv, {
    io,
    preflight,
    run: (name, args, o) => runReviewTool(name, args, { ...o, now: () => NOW }),
  })
  return { code, ...out, preflight }
}

describe('lazyhub review commands --json (#627)', () => {
  it.each([
    ['queue', ['--json']],
    ['evidence', ['7', '--repo', REPO, '--json']],
    ['why-red', ['#7', `--repo=${REPO}`, '--json', '--base-runs', '2']],
    ['claims', [`${REPO}#7`, '--json']],
    ['collisions', ['--json', '--repo', REPO]],
    ['collisions', [`https://github.com/${REPO}/pull/7`, '--json']],
    ['story', ['7', '--repo', REPO, '--json']],
  ])('%s %j prints one envelope on stdout and exits 0', async (command, argv) => {
    gh.calls.length = 0
    const r = await cli(command, argv)
    expect(r.stderr).toBe('')
    expect(r.code).toBe(EXIT.OK)
    expect(r.stdout.endsWith('\n')).toBe(true)
    expect(r.stdout.trim().split('\n')).toHaveLength(1)
    const body = JSON.parse(r.stdout)
    expect(validateSchema(body, ENVELOPE_SCHEMA)).toEqual([])
    expect(r.stdout).not.toMatch(FORBIDDEN)
    for (const call of gh.calls) expect(classifyGh(call)).toBe('read')
  })

  it('returns exactly what the MCP tool returns for the same input', async () => {
    const r = await cli('evidence', ['7', '--repo', REPO, '--json'])
    const direct = await runReviewTool('pr_evidence', { repo: REPO, number: 7 }, { now: () => NOW })
    expect(JSON.parse(r.stdout)).toEqual(direct)
  })

  it.each([
    ['evidence', ['--json'], /needs a PR number/],
    ['evidence', ['7', '8', '--json'], /at most one/],
    ['evidence', ['7', '--bogus', '--json'], /unknown option: --bogus/],
    ['evidence', ['7', '--repo', '--json'], /--repo needs a value/],
    ['evidence', ['7', '--repo', 'a/b', '--repo', 'c/d', '--json'], /only once/],
    ['evidence', ['c/d#7', '--repo', 'a/b', '--json'], /conflicts/],
    ['evidence', [`https://github.com/${REPO}/issues/7`, '--json'], /not an issue/],
    ['evidence', ['nope', '--json'], /not a PR or issue reference/],
    ['queue', ['7', '--json'], /takes no PR reference/],
    ['queue', ['--base-runs', '2', '--json'], /does not apply to queue/],
    ['queue', ['--limit', '99', '--json'], /between 1 and 50/],
    ['queue', ['--limit', 'many', '--json'], /between 1 and 50/],
    ['evidence', ['7', '--repo', 'not a repo', '--json'], /owner\/name/],
  ])('%s %j: exit 2, structured error, no gh call', async (command, argv, msg) => {
    gh.calls.length = 0
    const r = await cli(command, argv)
    expect(r.code).toBe(EXIT.USAGE)
    const body = JSON.parse(r.stdout)
    expect(validateSchema(body, ERROR_SCHEMA)).toEqual([])
    expect(body.error.message).toMatch(msg)
    expect(r.stderr).toMatch(/^lazyhub: /)
    expect(r.preflight).not.toHaveBeenCalled()
    expect(gh.calls).toEqual([])
  })

  it('without --json: exit 2 with a hint, nothing on stdout', async () => {
    const r = await cli('evidence', ['7'])
    expect(r.code).toBe(EXIT.USAGE)
    expect(r.stdout).toBe('')
    expect(r.stderr).toMatch(/add --json/)
  })

  it('--help prints the command usage and exits 0', async () => {
    const r = await cli('why-red', ['--help'])
    expect(r.code).toBe(EXIT.OK)
    expect(r.stdout).toBe(REVIEW_USAGE)
    for (const [command] of REVIEW_COMMANDS) expect(REVIEW_USAGE).toContain(`  ${command}`)
  })

  it('setup problems: exit 3 and a SETUP error, never a prompt', async () => {
    const r = await cli('evidence', ['7', '--repo', REPO, '--json'], { ok: false, message: 'lazyhub --mcp: not authenticated with github.com; run `gh auth login`, then restart' })
    expect(r.code).toBe(EXIT.SETUP)
    const body = JSON.parse(r.stdout)
    expect(body.error).toMatchObject({ code: 'SETUP', message: expect.stringMatching(/^not authenticated/) })
  })

  it('a failed GitHub read: exit 1 and a GITHUB_ERROR with its kind', async () => {
    const r = await cli('evidence', [String(MISSING), '--repo', REPO, '--json'])
    expect(r.code).toBe(EXIT.GITHUB)
    const body = JSON.parse(r.stdout)
    expect(body.error.code).toBe('GITHUB_ERROR')
    expect(typeof body.error.kind).toBe('string')
  })

  it('no repository resolved: exit 2 with INVALID_REPO', async () => {
    const saved = process.env.GHUI_REPO
    delete process.env.GHUI_REPO
    try {
      const r = await cli('story', ['7', '--json'])
      expect(r.code).toBe(EXIT.USAGE)
      expect(JSON.parse(r.stdout).error.code).toBe('INVALID_REPO')
    } finally {
      if (saved !== undefined) process.env.GHUI_REPO = saved
    }
  })

  it('an unexpected throw is still a structured GitHub error', async () => {
    const out = { stdout: '' }
    const io = { stdout: { write: (/** @type {string} */ s, /** @type {any} */ cb) => { out.stdout += s; cb?.() } }, stderr: { write: (/** @type {string} */ _s, /** @type {any} */ cb) => cb?.() } }
    const code = await runReviewCli('queue', ['--json'], { io, preflight: async () => ({ ok: true }), run: async () => { throw new Error('boom\u001b[31m') } })
    expect(code).toBe(EXIT.GITHUB)
    expect(JSON.parse(out.stdout).error).toMatchObject({ code: 'GITHUB_ERROR', message: 'boom' })
  })

  it('an unknown command prints usage and exits 2', async () => {
    const r = await cli('nope', ['--json'])
    expect(r.code).toBe(EXIT.USAGE)
    expect(r.stderr).toContain('Usage: lazyhub <command>')
  })

  it('parseReviewArgs maps flags to core inputs', () => {
    expect(parseReviewArgs('queue', ['--json', '--org', 'octo', '--limit=5', '--after-authored', 'Y3Vy', '--after-review-requested=QQ=='])).toEqual({
      json: true, args: { org: 'octo', limit: 5, after_authored: 'Y3Vy', after_review_requested: 'QQ==' },
    })
    expect(parseReviewArgs('collisions', ['--json']).args).toEqual({})
    expect(parseReviewArgs('evidence', ['https://ghe.example.com/a/b/pull/3', '--json'], { hosts: ['ghe.example.com'] }).args).toEqual({ repo: 'a/b', number: 3 })
  })
})
