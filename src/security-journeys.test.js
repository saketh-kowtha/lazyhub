/**
 * security-journeys.test.js — scaffold for the end-to-end security journeys (#140).
 *
 * One table (`JOURNALS`) lists every journey from docs/design/optional-approval.md
 * section 6. A journey that can be exercised today with fixtures and a stubbed gh
 * is a real test over production modules (nothing is copied from other tests).
 * What cannot be exercised yet is an `it.todo(... blocked on #n)`, so the gap is
 * visible in the test output. A todo is tracking, not an implementation.
 *
 * Nothing here claims enforcement: the journeys assert that the code does NOT
 * claim it. Hermetic: HOME is a temp dir (src/test/setup-hermetic.js), the
 * approval store lives in a temp dir, and no real gh, network or editor runs.
 */

import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./executor.js', async importOriginal => {
  const actual = await importOriginal()
  return {
    ...actual,
    listPRs: vi.fn().mockResolvedValue([{ number: 7, title: 'a change', body: 'long body', statusCheckRollup: [] }]),
    getPR: vi.fn().mockResolvedValue({ number: 7 }),
  }
})

import { openApprovalStore } from './approval/index.js'
import { checkCoverage } from './cli/doctor/coverage.js'
import { MCP_MUTATIONS_DISABLED, MUTATING_TOOLS, TOOLS, callTool } from './daemon/mcp-adapter.js'
import { classifyGh } from './daemon/protocol.js'
import { generateWatchOnlyReport } from './watch-only/index.js'

/**
 * @typedef {object} Journey
 * @property {string} id
 * @property {string} title
 * @property {number[]} blockedOn issues that must land before the remaining part can run
 * @property {string} [remaining] what is still a todo when the journey is partly runnable
 */
/** @type {Journey[]} */
const JOURNALS = [
  { id: 'J1', title: 'Watch-only reports without claiming enforcement', blockedOn: [] },
  { id: 'J2', title: 'Another source cannot satisfy the approval check', blockedOn: [244, 141] },
  { id: 'J3', title: 'New head or base invalidates approval', blockedOn: [141], remaining: 'GitHub half: a new commit or base change blocks the merge (live E4/E5)' },
  { id: 'J4', title: 'Unknown agent write denied, reads still work', blockedOn: [] },
  { id: 'J5', title: 'Policy or audit loss blocks writes, no fallback', blockedOn: [], remaining: 'daemon half is covered by src/daemon/fallback.js tests and is referenced, not duplicated' },
  { id: 'J6', title: 'Ambiguous outcome reconciles before retry', blockedOn: [244, 245] },
  { id: 'J7', title: 'Safe mode blocks writes; revocation guidance available', blockedOn: [203] },
  { id: 'J8', title: 'Control text cannot spoof the approval screen', blockedOn: [203] },
  { id: 'J9', title: 'Alternate credentials lower coverage', blockedOn: [] },
  { id: 'J10', title: 'Privileged workflow rerun asks or denies', blockedOn: [255], remaining: 'the "ask" half needs governed execution (Beta)' },
]

const NOW = Date.parse('2026-10-21T10:40:00Z')
const fixture = () => JSON.parse(readFileSync(new URL('./watch-only/fixtures/pr-activity.json', import.meta.url), 'utf8'))
const pageFrom = f => ({ rateLimit: f.data.rateLimit, pullRequests: f.data.repository.pullRequests })
const ENFORCING = ['github_enforced', 'managed_gateway']

const dirs = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})
const tmp = prefix => {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  dirs.push(dir)
  return dir
}

describe('journeys table', () => {
  it('lists J1 to J10 once each', () => {
    expect(JOURNALS.map(j => j.id)).toEqual(Array.from({ length: 10 }, (_, i) => `J${i + 1}`))
  })
})

describe('J1 watch-only reports without claiming enforcement', () => {
  const report = (opts = {}) => generateWatchOnlyReport({ repo: 'acme/widgets', now: () => NOW, fetchPage: async () => pageFrom(fixture()), ...opts })

  it('never assigns github_enforced or managed_gateway to any operation', async () => {
    const r = await report()
    expect(r.operations.length).toBeGreaterThan(0)
    for (const o of r.operations) {
      expect(ENFORCING).not.toContain(o.coverage)
      expect(o.evidence.enforcement).toBe('none')
    }
  })

  it('stays honest when observation is truncated or stale', async () => {
    const truncated = fixture()
    truncated.data.repository.pullRequests.pageInfo = { hasNextPage: true, endCursor: 'x' }
    const cases = [
      await report({ maxPages: 1, fetchPage: async () => pageFrom(truncated) }),
      await report({ now: () => NOW + 3_600_000, observeNow: () => NOW }),
    ]
    for (const r of cases) {
      for (const o of r.operations) expect(ENFORCING).not.toContain(o.coverage)
    }
    expect(cases[0].operations.find(o => o.operation === 'pr_merge').coverage).toBe('ungoverned')
  })
})

describe('approval store journeys (J3 and J5)', () => {
  let store
  let dir
  const T0 = Date.parse('2026-11-07T12:00:00.000Z')
  const ctx = over => ({
    host: 'github.com', repo_node_id: 'R_kgDOExample01', name_with_owner: 'octo-org/sandbox', pr_node_id: 'PR_kwDOExample0001', number: 42,
    state: 'OPEN', is_draft: false, is_cross_repository: false, base_ref: 'main', base_sha: '1'.repeat(40), head_ref: 'feature/x',
    head_sha: '2'.repeat(40), head_repo_node_id: 'R_kgDOExample01', auto_merge_enabled: false,
    approver: { host: 'github.com', login: 'octocat', node_id: 'U_kgDOExample' }, fetched_at: new Date(T0).toISOString(), ...over,
  })

  beforeEach(() => {
    dir = join(tmp('lh-journey-'), 'approvals')
    let n = 0
    store = openApprovalStore({ dir, now: () => new Date(T0), random: size => Buffer.alloc(size, ++n) })
  })

  it('J3: a new head commit or a moved base makes the approval unusable (local half)', () => {
    const { requestId } = store.createApprovalRecord({
      context: ctx(), decision: 'approve', evidence: { digest: '3'.repeat(64), observed_at: new Date(T0).toISOString() }, coverageClass: 'advisory',
    })
    expect(store.verify(requestId, ctx()).ok).toBe(true)
    expect(store.verify(requestId, ctx({ head_sha: '4'.repeat(40) }))).toMatchObject({ ok: false, code: 'ERR_APPROVAL_STALE_HEAD' })
    expect(store.verify(requestId, ctx({ base_sha: '5'.repeat(40) }))).toMatchObject({ ok: false, code: 'ERR_APPROVAL_STALE_BASE' })
    expect(store.verify(requestId, ctx({ base_ref: 'release' }))).toMatchObject({ ok: false, code: 'ERR_APPROVAL_STALE_BASE' })
  })

  describe('J5 (store half): an unavailable or corrupt store blocks writes and checks', () => {
    const create = (over, s = store) => s.createApprovalRecord({
      context: ctx(over), decision: 'approve', evidence: { digest: '3'.repeat(64), observed_at: new Date(T0).toISOString() }, coverageClass: 'advisory',
    })

    it('a corrupt journal refuses create, verify and revoke, and nothing falls back', () => {
      const { requestId } = create()
      const journal = join(dir, 'approvals-v1.ndjson')
      writeFileSync(journal, readFileSync(journal, 'utf8').replace('octocat', 'octocaT'), { mode: 0o600 })
      const by = { host: 'github.com', login: 'octocat', node_id: 'U_kgDOExample', auth_method: 'gh_session_tty' }
      const corrupt = expect.objectContaining({ code: 'ERR_APPROVAL_STORE_CORRUPT' })
      expect(() => create({ number: 43, pr_node_id: 'PR_kwDOExample0043' })).toThrow(corrupt)
      expect(() => store.verify(requestId, ctx())).toThrow(corrupt)
      expect(() => store.revoke(requestId, { by })).toThrow(corrupt)
    })

    it.skipIf(process.platform === 'win32')('a symlinked journal refuses create and verify', () => {
      const { requestId } = create()
      const journal = join(dir, 'approvals-v1.ndjson')
      const elsewhere = join(tmp('lh-journey-elsewhere-'), 'copy.ndjson')
      writeFileSync(elsewhere, readFileSync(journal, 'utf8'), { mode: 0o600 })
      rmSync(journal)
      symlinkSync(elsewhere, journal)
      const unavailable = expect.objectContaining({ code: 'ERR_APPROVAL_STORE_UNAVAILABLE' })
      expect(() => create({ number: 43, pr_node_id: 'PR_kwDOExample0043' })).toThrow(unavailable)
      expect(() => store.verify(requestId, ctx())).toThrow(unavailable)
    })
  })
})

describe('J4 unknown agent write denied, reads still work', () => {
  const WRITE_NAMES = ['merge_pr', 'lazyhub_pr_merge', 'approve_pr', 'lazyhub_pr_approve', 'post_comment', 'lazyhub_pr_comment', 'close_issue', 'review_line']

  it('advertises no write tool', () => {
    const names = TOOLS.map(t => t.name)
    for (const name of WRITE_NAMES) expect(names).not.toContain(name)
    expect(MUTATING_TOOLS.size).toBeGreaterThan(0)
  })

  it.each(WRITE_NAMES)('refuses %s even with claimed identity or scope metadata', async name => {
    await expect(callTool(name, {
      repo: 'acme/widgets', number: 7, scope: 'full', agent: 'trusted', _meta: { agent: 'trusted', scope: 'full' },
    })).rejects.toMatchObject({ code: 'MCP_MUTATIONS_DISABLED', message: MCP_MUTATIONS_DISABLED })
  })

  it('still serves reads, without PR bodies', async () => {
    const rows = await callTool('lazyhub_pr_list', { repo: 'acme/widgets', _meta: { agent: 'unknown' } })
    expect(rows).toHaveLength(1)
    expect(rows[0]).not.toHaveProperty('body')
    await expect(callTool('get_pr', { repo: 'acme/widgets', number: 7 })).resolves.toEqual({ number: 7 })
  })
})

describe('J9 alternate credentials lower coverage', () => {
  it('a detected alternate credential downgrades local-agent approval to ungoverned and never upgrades anything', async () => {
    const root = tmp('lh-journey-home-')
    const clean = { HOME: root, PATH: '' }
    const run = env => checkCoverage({
      repo: 'acme/widgets', env, home: root, cwd: root, now: () => NOW,
      watchOnly: { fetchPage: async () => pageFrom(fixture()) },
      identity: async () => ({ status: 'verified', repo: 'acme/widgets', host: 'github.com', node_id: 'R_kgDOabc', reason: null }),
      rulesets: async () => ({ status: 'readable', count: 1, names: ['protect main'], approval_check_verified: false }),
    })
    const base = await run(clean)
    const withToken = await run({ ...clean, GH_TOKEN: 'ghp_notarealtoken0000000000' })
    const local = r => r.operations.find(o => o.operation === 'local_agent_approval')
    expect(local(base).coverage).toBe('advisory')
    expect(local(withToken).coverage).toBe('ungoverned')
    expect(local(withToken).downgrade_reasons).toContain('alternate_path_detected:env_tokens')
    for (const r of [base, withToken]) for (const o of r.operations) expect(ENFORCING).not.toContain(o.coverage)
    expect(JSON.stringify(withToken)).not.toContain('ghp_notarealtoken')
  })
})

describe('J10 privileged workflow rerun (deny half)', () => {
  it('agent surfaces expose no rerun, and the executor never treats one as a read', async () => {
    const names = TOOLS.map(t => t.name)
    expect(names.filter(n => /rerun|workflow|run_/i.test(n))).toEqual([])
    for (const name of ['rerun_workflow', 'lazyhub_run_rerun', 'run_rerun']) {
      await expect(callTool(name, { repo: 'acme/widgets', number: 7 })).rejects.toMatchObject({ code: 'MCP_UNKNOWN_TOOL' })
    }
    expect(classifyGh(['run', 'rerun', '123'])).toBe('write')
    expect(classifyGh(['api', '-X', 'POST', 'repos/acme/widgets/actions/runs/123/rerun'])).toBe('write')
  })
})

// Blocked journeys, or the blocked half of a partly runnable one. Visible as todos in test output.
describe('blocked journeys (tracked, not implemented)', () => {
  for (const j of JOURNALS.filter(entry => entry.blockedOn.length > 0)) {
    it.todo(`${j.id} ${j.remaining || j.title}: blocked on ${j.blockedOn.map(n => `#${n}`).join(', ')}`)
  }
  it.todo('J5 daemon half: covered by src/daemon/fallback.js tests (referenced, not duplicated)')
})
