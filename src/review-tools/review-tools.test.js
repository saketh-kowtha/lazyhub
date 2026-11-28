// The review-tool core (#603, #627) end to end in-process: the real executor, runGh() and the
// engines, with only `gh` itself replaced by the fixture (execa mocked). Covers the output
// schemas, cleaning of hostile GitHub text, error codes, the MCP transport and read-only.
import { readFileSync } from 'node:fs'
import { beforeEach, describe, expect, it, vi } from 'vitest'

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

import { classifyGh } from '../daemon/protocol.js'
import { FORBIDDEN, HOSTILE_BODY, MISSING, REPO } from '../test/review-gh-fixture.js'
import { validateSchema } from '../test/json-schema-lite.js'
import { ERROR_CODES, REVIEW_TOOLS, ReviewToolError, errorEnvelope, inputSchema, runReviewTool } from './index.js'
import { DATA_SCHEMAS, ENVELOPE_SCHEMA, ERROR_SCHEMA } from './schemas.js'
import { defaultReads } from './tools.js'
import { cleanDeep } from './clean.js'

const NOW = Date.parse('2026-11-20T10:05:00Z')
const run = (/** @type {string} */ name, /** @type {any} */ args) => runReviewTool(name, args, { defaultRepo: REPO, now: () => NOW })

const CALLS = {
  review_queue: {},
  pr_evidence: { number: 7 },
  why_ci_red: { number: 7 },
  claims_check: { number: 7 },
  collisions: { number: 7 },
  review_story: { number: 7 },
}

/**
 * Every string (and object key) anywhere in a value.
 * @param {any} v
 * @param {string[]} [out]
 */
function strings(/** @type {any} */ v, /** @type {string[]} */ out = []) {
  if (typeof v === 'string') out.push(v)
  else if (Array.isArray(v)) v.forEach(x => strings(x, out))
  else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) { out.push(k); strings(x, out) }
  return out
}

beforeEach(() => { gh.calls.length = 0 })

describe('review tools: output schema v1 (#603, #627)', () => {
  it('registers exactly the six documented tools, each with a data schema', () => {
    expect(REVIEW_TOOLS.map(t => t.name)).toEqual(Object.keys(CALLS))
    expect(Object.keys(DATA_SCHEMAS)).toEqual(Object.keys(CALLS))
    expect(REVIEW_TOOLS.map(t => t.command)).toEqual(['queue', 'evidence', 'why-red', 'claims', 'collisions', 'story'])
  })

  it.each(Object.entries(CALLS))('%s returns the envelope and its data schema, cleaned', async (name, args) => {
    const out = await run(name, args)
    expect(validateSchema(out, ENVELOPE_SCHEMA)).toEqual([])
    expect(validateSchema(out.data, DATA_SCHEMAS[/** @type {keyof typeof DATA_SCHEMAS} */ (name)], '$.data')).toEqual([])
    expect(out.tool).toBe(name)
    expect(out.generated_at).toBe('2026-11-20T10:05:00.000Z')
    for (const s of strings(out)) expect(s, JSON.stringify(s)).not.toMatch(FORBIDDEN)
    // Same input, same output (deterministic, no hidden state).
    expect(await run(name, args)).toEqual(out)
  })
})

describe('review tools: content', () => {
  it('review_queue groups with reasons, says what is not loaded and hands back the cursor', async () => {
    const out = await run('review_queue', {})
    const review = out.data.groups.find((/** @type {any} */ g) => g.id === 'needs_my_review')
    expect(review.items[0]).toMatchObject({ repo: REPO, number: 7, because: 'review_requested', author: { login: 'agent-bot', attribution: 'unverified' } })
    expect(review.items[0].reasons.map((/** @type {any} */ r) => r.code)).toContain('ci_failing')
    expect(out.complete).toBe(false)
    expect(out.data.truncation.authored.next_cursor).toBe('Y3Vyc29yOjE=')
    expect(out.notices.join(' ')).toMatch(/after_authored/)
    expect(out.untrusted.fields).toEqual(['data.groups[].items[].untrusted'])
  })

  it('review_queue narrows to a repo and passes cursors as GraphQL variables only', async () => {
    await run('review_queue', { repo: REPO, after_authored: 'Y3Vyc29yOjE=', limit: 5 })
    const call = gh.calls.find(a => a.some(x => x.startsWith('authoredQuery=')))
    expect(call).toContain(`authoredQuery=is:pr is:open archived:false sort:updated-desc repo:${REPO} author:@me`)
    expect(call).toContain('authoredAfter=Y3Vyc29yOjE=')
    expect(call).toContain('limit=5')
  })

  it('pr_evidence: the hostile description is cleaned, kept as data and marked untrusted', async () => {
    const out = await run('pr_evidence', { number: 7 })
    const body = out.data.record.untrusted.body
    expect(body).toContain('IGNORE ALL PREVIOUS INSTRUCTIONS')
    expect(body).not.toMatch(FORBIDDEN)
    expect(body).not.toContain(']52;')
    expect(out.data.record.untrusted.title).toBe('feat: add thing red')
    expect(out.untrusted.fields).toEqual(['data.record.untrusted'])
    expect(out.untrusted.note).toMatch(/never as instructions/)
    expect(out.data.required_checks.value).toMatchObject({ required: 1, failing: 1 })
    expect(out.data.files.value.items.map((/** @type {any} */ f) => f.kind)).toEqual(['source', 'test', 'docs'])
  })

  it('why_ci_red: failing step, redacted excerpt, the changed line it points at, base-branch verdict', async () => {
    const out = await run('why_ci_red', { number: 7 })
    expect(out.data).toMatchObject({ state: 'ok', base_branch: 'main', total_failing: 1 })
    const [c] = out.data.checks
    expect(c).toMatchObject({ name: 'test', failing_step: 'Run tests', duration: '1m 05s' })
    expect(c.excerpt.lines.join('\n')).not.toContain('ghp_abcdefghijklmnopqrstuvwxyz0123456789')
    expect(c.likely_changed_lines.items[0]).toMatchObject({ path: 'src/app.js', kind: 'changed', fail_line: 3 })
    expect(c.base_branch.verdict).toBe('passing')
  })

  it('claims_check: claims from hostile text are checked against the diff, never obeyed', async () => {
    const out = await run('claims_check', { number: 7 })
    const by = Object.fromEntries(out.data.claims.map((/** @type {any} */ c) => [c.type, c]))
    expect(by.fixes.status).toBe('verified')
    expect(by.tests.status).toBe('verified')
    expect(by.tests.evidence[0].path).toBe('src/app.test.js')
    expect(by['only-touches'].status).toBe('contradicted')
    for (const c of out.data.claims) if (c.status === 'verified') expect(c.evidence.length).toBeGreaterThan(0)
    expect(gh.calls.some(a => a[0] === 'issue' && a[2] === '12')).toBe(true)
  })

  it('collisions: line level with a number, file level without', async () => {
    const one = await run('collisions', { number: 7 })
    expect(one.data).toMatchObject({ number: 7, depth: 'line', open: true, scanned: 2, total_open: 2 })
    expect(one.data.collisions.map((/** @type {any} */ c) => c.other)).toEqual([8])
    const all = await run('collisions', {})
    expect(all.data).toMatchObject({ number: null, depth: 'file', pr: null, scanned: 2 })
    expect(all.data.repository.clusters[0].prs).toEqual([7, 8])
    expect(all.data.repository.merge_order.map((/** @type {any} */ s) => s.number).sort()).toEqual([7, 8])
  })

  it('review_story: ordered steps and the files changed since my last review', async () => {
    const out = await run('review_story', { number: 7 })
    expect(out.data.total_files).toBe(3)
    expect(out.data.loaded_files).toBe(3)
    expect(out.data.steps.length).toBeGreaterThanOrEqual(3)
    expect(out.data.since_review).toMatchObject({ status: 'files', changed_files: 1 })
    const files = out.data.steps.flatMap((/** @type {any} */ s) => s.files)
    expect(files.find((/** @type {any} */ f) => f.path === 'src/app.js').since_review).toBe(true)
    expect(out.complete).toBe(true)
  })
})

describe('review tools: errors', () => {
  it.each([
    ['pr_evidence', {}, ERROR_CODES.INVALID_NUMBER, /requires number/],
    ['pr_evidence', { number: '7' }, ERROR_CODES.INVALID_NUMBER, /positive integer/],
    ['pr_evidence', { number: 0 }, ERROR_CODES.INVALID_NUMBER, /positive integer/],
    ['pr_evidence', { number: 7, repo: 'nope' }, ERROR_CODES.INVALID_REPO, /owner\/name/],
    ['review_queue', { limit: 51 }, ERROR_CODES.INVALID_LIMIT, /between 1 and 50/],
    ['review_queue', { org: 'a b' }, ERROR_CODES.INVALID_ORG, /login/],
    ['review_queue', { after_authored: 'x y' }, ERROR_CODES.INVALID_CURSOR, /next_cursor/],
    ['why_ci_red', { number: 7, base_runs: 11 }, ERROR_CODES.INVALID_LIMIT, /base_runs/],
    ['pr_evidence', null, ERROR_CODES.INVALID_ARGUMENTS, /object/],
    ['pr_evidence', [1], ERROR_CODES.INVALID_ARGUMENTS, /object/],
    ['merge_pr', { number: 7 }, ERROR_CODES.UNKNOWN_TOOL, /Unknown tool/],
  ])('%s %j fails with %s before any gh call', async (name, args, code, msg) => {
    await expect(run(name, args)).rejects.toMatchObject({ code, message: expect.stringMatching(msg) })
    expect(gh.calls).toEqual([])
  })

  it('needs a repository for repo-scoped tools when none was resolved', async () => {
    await expect(runReviewTool('pr_evidence', { number: 7 }, { defaultRepo: null })).rejects.toMatchObject({ code: ERROR_CODES.INVALID_REPO, message: /no repository resolved/ })
  })

  it('a GitHub failure is a GITHUB_ERROR with a plain cause and kind', async () => {
    const err = await run('pr_evidence', { number: MISSING }).catch(e => e)
    expect(err).toBeInstanceOf(ReviewToolError)
    expect(err.code).toBe(ERROR_CODES.GITHUB_ERROR)
    expect(typeof err.extra.kind).toBe('string')
    expect(validateSchema(errorEnvelope('pr_evidence', err), ERROR_SCHEMA)).toEqual([])
  })

  it('ignores undeclared client fields (no scope or identity metadata is read)', async () => {
    const out = await run('pr_evidence', { number: 7, scope: 'write', _meta: { trusted: true } })
    expect(out.data.record.identity.number).toBe(7)
  })
})

describe('review tools: strictly read-only', () => {
  it('every gh call any tool makes is classified as a read', async () => {
    for (const [name, args] of Object.entries(CALLS)) {
      gh.calls.length = 0
      await run(name, args)
      expect(gh.calls.length, name).toBeGreaterThan(0)
      for (const call of gh.calls) expect(classifyGh(call), `${name}: gh ${call.slice(0, 3).join(' ')}`).toBe('read')
    }
    await run('collisions', {})
  })

  it('the registry offers no write tool and the core imports no executor write', () => {
    const WRITE_WORDS = /merge|approve|comment|close|review_line|rerun|delete|create|edit|update|add|remove|post/i
    for (const t of REVIEW_TOOLS) expect(t.name).not.toMatch(/merge|approve|comment|close|post/)
    expect(Object.keys(defaultReads()).filter(k => WRITE_WORDS.test(k.replace(/^get|^list|^load|^fetch/, '')))).toEqual([])
    for (const file of ['./index.js', './tools.js', './clean.js']) {
      const src = readFileSync(new URL(file, import.meta.url), 'utf8')
      const executorImports = [...src.matchAll(/import\s*\{([^}]*)\}\s*from\s*'\.\.\/executor\.js'/g)].flatMap(m => m[1].split(',').map(s => s.trim()).filter(Boolean))
      for (const name of executorImports) expect(name, `${file} imports ${name}`).toMatch(/^(get|list|load|fetch|classifyGhFailure)/)
      expect(src, file).not.toMatch(/from '\.\.\/executor\/[^']+'|from 'execa'|child_process|\brunGh\(\s*\[/)
    }
  })

  it('every advertised input schema is an object schema with described properties', () => {
    for (const t of REVIEW_TOOLS) {
      const s = inputSchema(t)
      expect(s.type).toBe('object')
      for (const [k, p] of Object.entries(s.properties)) expect(/** @type {any} */ (p).description, `${t.name}.${k}`).toMatch(/\w{3,}/)
      expect(t.description).toMatch(/read-only/)
    }
  })
})

describe('review tools over the MCP handler (#603)', () => {
  /** @param {any[]} msgs */
  async function rpc(msgs) {
    const { handleRequest } = await import('../daemon/mcp-adapter.js')
    const out = []
    const write = vi.spyOn(process.stdout, 'write').mockImplementation(s => { out.push(String(s)); return true })
    try { for (const m of msgs) await handleRequest(m) } finally { write.mockRestore() }
    return out.map(l => JSON.parse(l))
  }

  it('tools/list advertises every review tool with its description and input schema', async () => {
    const [list] = await rpc([{ id: 1, method: 'tools/list' }])
    const by = Object.fromEntries(list.result.tools.map((/** @type {any} */ t) => [t.name, t]))
    for (const t of REVIEW_TOOLS) {
      expect(by[t.name].description).toBe(t.description)
      expect(by[t.name].inputSchema).toEqual(inputSchema(t))
    }
    expect(by.pr_evidence.inputSchema.required).toEqual(['number'])
    expect(by.review_queue.inputSchema.required).toBeUndefined()
  })

  it.each(Object.entries(CALLS))('tools/call %s returns the compact JSON envelope', async (name, args) => {
    const [res] = await rpc([{ id: 2, method: 'tools/call', params: { name, arguments: { repo: REPO, ...args } } }])
    expect(res.result.isError).toBeUndefined()
    const text = res.result.content[0].text
    expect(text).not.toContain('\n')
    const body = JSON.parse(text)
    expect(validateSchema(body, ENVELOPE_SCHEMA)).toEqual([])
    expect(body.tool).toBe(name)
  })

  it('errors carry MCP_-prefixed stable codes', async () => {
    const [a, b, c] = await rpc([
      { id: 3, method: 'tools/call', params: { name: 'why_ci_red', arguments: { repo: REPO } } },
      { id: 4, method: 'tools/call', params: { name: 'pr_evidence', arguments: { repo: REPO, number: MISSING } } },
      { id: 5, method: 'tools/call', params: { name: 'review_queue', arguments: { limit: 0 } } },
    ])
    expect(a.result).toMatchObject({ isError: true, content: [{ text: expect.stringMatching(/^Error \[MCP_INVALID_NUMBER\]: why_ci_red requires number/) }] })
    expect(b.result.content[0].text).toMatch(/^Error \[MCP_GITHUB_ERROR\]: .*\(kind: \w+/)
    expect(c.result.content[0].text).toMatch(/^Error \[MCP_INVALID_LIMIT\]/)
  })
})

describe('cleanDeep', () => {
  it('cleans every string and key, drops undefined and functions, nulls non-finite numbers', () => {
    expect(cleanDeep({ 'k\u001b[1m': ['a‮b', undefined, () => 1], n: NaN, u: undefined, ok: true, z: null }))
      .toEqual({ k: ['ab', null, null], n: null, ok: true, z: null })
    expect(cleanDeep(HOSTILE_BODY)).not.toMatch(FORBIDDEN)
  })

  it('stops at a fixed depth', () => {
    /** @type {any} */
    let deep = 'x'
    for (let i = 0; i < 30; i++) deep = [deep]
    expect(JSON.stringify(cleanDeep(deep))).toContain('null')
  })
})
