import { createHash } from 'node:crypto'
import { fork } from 'node:child_process'
import {
  chmodSync, lstatSync, mkdtempSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { canonicalize, hashRequest } from './canonical.js'
import { openApprovalStore } from './store.js'

const versions = vi.hoisted(() => ({ override: null }))
vi.mock('./policy.js', async importOriginal => {
  const actual = await importOriginal()
  return { ...actual, getPolicyVersions: () => versions.override ?? actual.getPolicyVersions() }
})

const posix = process.platform !== 'win32'
const T0 = Date.parse('2026-11-07T12:00:00.000Z')
const MIN = 60_000
const HOUR = 60 * MIN
const SHA1 = '1'.repeat(40)
const SHA2 = '2'.repeat(40)

let nowMs
let counter
let dir
let store
const dirs = []

const iso = ms => new Date(ms).toISOString()
const now = () => new Date(nowMs)
const random = n => Buffer.alloc(n, ++counter)
const open = () => openApprovalStore({ dir, now, random })

function context(over = {}) {
  return {
    host: 'github.com',
    repo_node_id: 'R_kgDOExample01',
    name_with_owner: 'octo-org/sandbox',
    pr_node_id: 'PR_kwDOExample0001',
    number: 42,
    state: 'OPEN',
    is_draft: false,
    is_cross_repository: false,
    base_ref: 'main',
    base_sha: SHA1,
    head_ref: 'feature/x',
    head_sha: SHA2,
    head_repo_node_id: 'R_kgDOExample01',
    auto_merge_enabled: false,
    approver: { host: 'github.com', login: 'octocat', node_id: 'U_kgDOExample' },
    fetched_at: iso(nowMs),
    ...over,
  }
}

const evidence = () => ({ digest: '3'.repeat(64), observed_at: iso(nowMs) })
const approve = (ctx = context(), extra = {}) => store.createApprovalRecord({
  context: ctx, decision: 'approve', evidence: evidence(), coverageClass: 'advisory', ...extra,
})
const deny = (ctx = context()) => store.createApprovalRecord({
  context: ctx, decision: 'deny', evidence: evidence(), coverageClass: 'advisory',
})
const prCtx = n => context({ number: n, pr_node_id: `PR_kwDOExample${String(n).padStart(4, '0')}` })
const BY = { host: 'github.com', login: 'octocat', node_id: 'U_kgDOExample', auth_method: 'gh_session_tty' }
const journalFile = () => join(dir, 'approvals-v1.ndjson')
const lines = () => {
  try { return readFileSync(journalFile(), 'utf8').split('\n').filter(Boolean) } catch { return [] }
}
const code = expected => expect.objectContaining({ code: expected })

function rehash(entry) {
  const { hash: _drop, ...rest } = entry
  const hash = createHash('sha256').update(`lazyhub.approval-journal/1\n${canonicalize(rest)}`).digest('hex')
  return canonicalize({ ...rest, hash })
}

beforeEach(() => {
  nowMs = T0
  counter = 0
  versions.override = null
  dir = join(mkdtempSync(join(tmpdir(), 'lh-approval-')), 'approvals')
  dirs.push(dirname(dir))
  store = open()
})

afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

describe('approval store: decisions are durable and attributable', () => {
  it('records approve, deny, revoke and expire, and survives reopen', () => {
    const a = approve(prCtx(1))
    const d = deny(prCtx(2))
    const r = approve(prCtx(3))
    store.revoke(r.requestId, { by: { ...BY, login: 'revoker', node_id: 'U_kgDORevoker' } })
    const e = approve(prCtx(4))
    nowMs += 5 * HOUR
    store.sweepExpired()

    const reopened = open()
    const states = Object.fromEntries(reopened.list().map(s => [s.prNumber, s.state]))
    expect(states).toEqual({ 1: 'expired', 2: 'denied', 3: 'revoked', 4: 'expired' })
    expect(reopened.get(a.requestId).request.approver.login).toBe('octocat')
    expect(reopened.get(d.requestId).decision).toBe('deny')
    const revoked = reopened.get(r.requestId)
    expect(revoked.entries.at(-1)).toMatchObject({ type: 'revoked', by: { login: 'revoker', node_id: 'U_kgDORevoker' }, reason_code: 'user_revoked' })
    expect(reopened.get(e.requestId).entries.at(-1).type).toBe('expired')
    expect(reopened.get('lzap1_' + '0'.repeat(64))).toBeNull()
  })

  it('lists newest first with summaries and filters', () => {
    approve(prCtx(1))
    nowMs += MIN
    approve(prCtx(2))
    nowMs += MIN
    deny(prCtx(3))
    const all = store.list()
    expect(all.map(s => s.prNumber)).toEqual([3, 2, 1])
    expect(all[0]).toMatchObject({
      state: 'denied', nameWithOwner: 'octo-org/sandbox', headSha: SHA2, baseRef: 'main', baseSha: SHA1, approverLogin: 'octocat',
    })
    expect(all[0].requestId).toMatch(/^lzap1_[0-9a-f]{64}$/)
    expect(store.list({ state: 'approved' }).map(s => s.prNumber)).toEqual([2, 1])
    expect(store.list({ prNodeId: 'PR_kwDOExample0002' }).map(s => s.prNumber)).toEqual([2])
    expect(store.list({ host: 'other.example' })).toEqual([])
    expect(store.list({ repoNodeId: 'R_kgDOExample01' })).toHaveLength(3)
  })

  it('default expiry is 4 hours and ttl is bounded to 5 minutes through 24 hours', () => {
    const rec = approve()
    expect(Date.parse(rec.record.request.expires_at) - Date.parse(rec.record.request.issued_at)).toBe(4 * HOUR)
    expect(Date.parse(approve(prCtx(2), { ttlMinutes: 5 }).record.request.expires_at) - T0).toBe(5 * MIN)
    expect(Date.parse(approve(prCtx(3), { ttlMinutes: 1440 }).record.request.expires_at) - T0).toBe(24 * HOUR)
    for (const bad of [4, 1441, 1.5, 0, -1, '60']) {
      expect(() => approve(prCtx(9), { ttlMinutes: bad })).toThrow(code('ERR_APPROVAL_INVALID_INPUT'))
    }
  })
})

describe('approval store: verify', () => {
  it('is ok for an unchanged context, even with new facts that are not bound', () => {
    const rec = approve()
    const ok = store.verify(rec.requestId, context({ auto_merge_enabled: true, is_draft: true, fetched_at: iso(nowMs + MIN) }))
    expect(ok).toMatchObject({ ok: true })
    expect(ok.record.requestId).toBe(rec.requestId)
  })

  it('stays ok when the repository is renamed (same node ID)', () => {
    const rec = approve()
    expect(store.verify(rec.requestId, context({ name_with_owner: 'octo-org/renamed' })).ok).toBe(true)
  })

  it.each([
    ['head SHA', { head_sha: '4'.repeat(40) }, 'ERR_APPROVAL_STALE_HEAD', ['head.sha']],
    ['head ref', { head_ref: 'feature/other' }, 'ERR_APPROVAL_STALE_HEAD', ['head.ref']],
    ['base SHA', { base_sha: '5'.repeat(40) }, 'ERR_APPROVAL_STALE_BASE', ['base.sha']],
    ['base ref', { base_ref: 'release' }, 'ERR_APPROVAL_STALE_BASE', ['base.ref']],
    ['host', { host: 'ghe.example.com', approver: { host: 'ghe.example.com', login: 'octocat', node_id: 'U_kgDOExample' } }, 'ERR_APPROVAL_CONTEXT_MISMATCH', ['host']],
    ['repo node ID', { repo_node_id: 'R_kgDOExample77', head_repo_node_id: 'R_kgDOExample77' }, 'ERR_APPROVAL_CONTEXT_MISMATCH', ['repo.node_id']],
    ['PR node ID', { pr_node_id: 'PR_kwDOExample7777' }, 'ERR_APPROVAL_CONTEXT_MISMATCH', ['pr.node_id']],
    ['approver', { approver: { host: 'github.com', login: 'someone', node_id: 'U_kgDOSomeone' } }, 'ERR_APPROVAL_APPROVER_CHANGED', ['approver.node_id']],
    ['fork', { head_repo_node_id: 'R_kgDOFork0002', is_cross_repository: true }, 'ERR_APPROVAL_UNSUPPORTED', ['head.repo_node_id']],
  ])('returns the exact code and changed list when the %s changed', (_name, over, expectedCode, changed) => {
    const rec = approve()
    const res = store.verify(rec.requestId, context(over))
    expect(res).toEqual({ ok: false, code: expectedCode, changed })
  })

  it('reports every changed field and uses the first failure for the code', () => {
    const rec = approve()
    const res = store.verify(rec.requestId, context({ head_sha: '4'.repeat(40), base_sha: '5'.repeat(40) }))
    expect(res.code).toBe('ERR_APPROVAL_STALE_HEAD')
    expect(res.changed).toEqual(['head.sha', 'base.sha'])
  })

  it('detects a policy version change from the code constant, not the caller', () => {
    const rec = approve()
    versions.override = { policy: 'lazyhub-approval-policy/2', evidence: 1 }
    expect(store.verify(rec.requestId, context())).toEqual({
      ok: false, code: 'ERR_APPROVAL_POLICY_CHANGED', changed: ['policy_version'],
    })
  })

  it('detects an evidence schema version change', () => {
    const rec = approve()
    versions.override = { policy: 'lazyhub-approval-policy/1', evidence: 2 }
    expect(store.verify(rec.requestId, context())).toEqual({
      ok: false, code: 'ERR_APPROVAL_EVIDENCE_CHANGED', changed: ['evidence.schema_version'],
    })
  })

  it('expires exactly at expires_at, and after a persisted expired event', () => {
    const rec = approve()
    nowMs = T0 + 4 * HOUR - 1
    expect(store.verify(rec.requestId, context()).ok).toBe(true)
    nowMs = T0 + 4 * HOUR
    expect(store.verify(rec.requestId, context())).toEqual({ ok: false, code: 'ERR_APPROVAL_EXPIRED', changed: ['expires_at'] })
    store.sweepExpired()
    expect(store.verify(rec.requestId, context())).toMatchObject({ ok: false, code: 'ERR_APPROVAL_EXPIRED' })
  })

  it('returns revoked and denied codes, and not found', () => {
    const rec = approve()
    store.revoke(rec.requestId, { by: BY })
    expect(store.verify(rec.requestId, context())).toMatchObject({ ok: false, code: 'ERR_APPROVAL_REVOKED' })
    const d = deny(prCtx(2))
    expect(store.verify(d.requestId, prCtx(2))).toMatchObject({ ok: false, code: 'ERR_APPROVAL_DENIED' })
    expect(store.verify('lzap1_' + 'a'.repeat(64), context())).toMatchObject({ ok: false, code: 'ERR_APPROVAL_NOT_FOUND' })
  })

  it('returns a clock error when the record was issued in the future of the local clock', () => {
    const rec = approve()
    nowMs = T0 - 10 * MIN
    expect(store.verify(rec.requestId, context())).toMatchObject({ ok: false, code: 'ERR_APPROVAL_CLOCK' })
  })

  it('rejects malformed request IDs and observed contexts as invalid input', () => {
    const rec = approve()
    expect(() => store.verify('nope', context())).toThrow(code('ERR_APPROVAL_INVALID_INPUT'))
    expect(() => store.verify(rec.requestId, { ...context(), head_sha: undefined })).toThrow(code('ERR_APPROVAL_INVALID_INPUT'))
  })
})

describe('approval store: create', () => {
  it('refuses forks, non-merge operations and closed pull requests', () => {
    expect(() => approve(context({ head_repo_node_id: 'R_kgDOFork0002' }))).toThrow(code('ERR_APPROVAL_UNSUPPORTED'))
    expect(() => approve(context({ is_cross_repository: true }))).toThrow(code('ERR_APPROVAL_UNSUPPORTED'))
    expect(() => approve(context(), { operation: 'close' })).toThrow(code('ERR_APPROVAL_UNSUPPORTED'))
    expect(() => approve(context({ state: 'MERGED' }))).toThrow(code('ERR_APPROVAL_UNSUPPORTED'))
    expect(lines()).toHaveLength(0)
  })

  it('refuses stale evidence and clock skew', () => {
    expect(() => store.createApprovalRecord({
      context: context(), decision: 'approve', coverageClass: 'advisory',
      evidence: { digest: '3'.repeat(64), observed_at: iso(nowMs - 6 * MIN) },
    })).toThrow(code('ERR_APPROVAL_EVIDENCE_STALE'))
    expect(() => approve(context({ fetched_at: iso(nowMs - 6 * MIN) }))).toThrow(code('ERR_APPROVAL_EVIDENCE_STALE'))
    expect(() => store.createApprovalRecord({
      context: context(), decision: 'approve', coverageClass: 'advisory',
      evidence: { digest: '3'.repeat(64), observed_at: iso(nowMs + 6 * MIN) },
    })).toThrow(code('ERR_APPROVAL_CLOCK'))
    expect(() => approve(context({ fetched_at: iso(nowMs + 6 * MIN) }))).toThrow(code('ERR_APPROVAL_CLOCK'))
    expect(() => store.createApprovalRecord({
      context: context(), decision: 'approve', coverageClass: 'advisory',
      evidence: { digest: '3'.repeat(64), observed_at: iso(nowMs - 4 * MIN) },
    })).not.toThrow()
  })

  it('refuses invalid inputs without writing', () => {
    expect(() => approve(context({ head_sha: 'ABC' }))).toThrow(code('ERR_APPROVAL_INVALID_INPUT'))
    expect(() => approve(context({ number: undefined }))).toThrow(code('ERR_APPROVAL_INVALID_INPUT'))
    expect(() => approve(context(), { coverageClass: 'protected' })).toThrow(code('ERR_APPROVAL_INVALID_INPUT'))
    expect(() => store.createApprovalRecord({ context: context(), decision: 'maybe', evidence: evidence(), coverageClass: 'advisory' })).toThrow(code('ERR_APPROVAL_INVALID_INPUT'))
    expect(lines()).toHaveLength(0)
  })

  it('gives two records for the same context different nonces and request IDs; a second active one conflicts', () => {
    const first = approve()
    expect(() => approve()).toThrow(code('ERR_APPROVAL_CONFLICT'))
    expect(() => deny()).toThrow(code('ERR_APPROVAL_CONFLICT'))
    store.revoke(first.requestId, { by: BY })
    const second = approve()
    expect(second.record.request.nonce).not.toBe(first.record.request.nonce)
    expect(second.requestId).not.toBe(first.requestId)
    expect(second.requestHash).toBe(hashRequest(second.record.request))
  })

  it('does not treat an expired approval as active', () => {
    approve()
    nowMs += 5 * HOUR
    expect(() => approve()).not.toThrow()
  })

  it('records origin as unverified metadata and escapes an unprintable label', () => {
    const rec = approve(context(), { origin: { declared_kind: 'agent', label: 'bot‮!' } })
    expect(rec.record.request.origin).toEqual({ declared_kind: 'agent', label: 'bot\\u{202E}!', verified: false })
    const dflt = approve(prCtx(2))
    expect(dflt.record.request.origin).toEqual({ declared_kind: 'unknown', label: '', verified: false })
  })

  it('stores untrusted intent outside the hash, bounded and sanitized', () => {
    const a = approve(context(), { untrustedIntent: '\u001b[31mplease approve\u001b[0m '.repeat(300) })
    const got = store.get(a.requestId)
    expect(got.untrusted.intent.length).toBeLessThanOrEqual(2000)
    expect(got.untrusted.intent).not.toContain('\u001b')
    expect(got.untrusted.intent).toContain('please approve')
    expect(got.requestHash).toBe(hashRequest(got.request))
    expect(store.verify(a.requestId, context()).ok).toBe(true)
    const noIntent = approve(prCtx(2))
    expect(store.get(noIntent.requestId).untrusted.intent).toBe('')
    expect(a.record.request).not.toHaveProperty('untrusted')
  })

  it('keeps tokens, bodies and diffs out of the journal', () => {
    approve(context({ body: 'SECRET-BODY', diff: 'SECRET-DIFF', token: 'ghp_SECRETTOKEN', prompt: 'SECRET-PROMPT' }))
    const text = readFileSync(journalFile(), 'utf8')
    expect(text).not.toMatch(/SECRET/)
    const keys = new Set()
    const walk = node => {
      if (node && typeof node === 'object') for (const [k, v] of Object.entries(node)) { keys.add(k); walk(v) }
    }
    for (const line of lines()) walk(JSON.parse(line))
    expect([...keys].filter(k => /token|secret|password|credential|body|diff|prompt|cookie/i.test(k))).toEqual([])
  })
})

describe('approval store: revoke and sweep', () => {
  it('revoke is idempotent and attributable', () => {
    const rec = approve()
    const first = store.revoke(rec.requestId, { by: BY })
    expect(first.state).toBe('revoked')
    expect(first.already).toBeUndefined()
    const count = lines().length
    const again = store.revoke(rec.requestId, { by: BY })
    expect(again.already).toBe(true)
    expect(lines()).toHaveLength(count)
  })

  it('revoking an expired approval appends revoked; a denied one is refused; unknown ids are not found', () => {
    const rec = approve()
    nowMs += 5 * HOUR
    expect(store.revoke(rec.requestId, { by: BY, reasonCode: 'safe_mode' }).state).toBe('revoked')
    expect(store.get(rec.requestId).entries.at(-1)).toMatchObject({ type: 'revoked', reason_code: 'safe_mode' })
    const d = deny(prCtx(2))
    expect(() => store.revoke(d.requestId, { by: BY })).toThrow(code('ERR_APPROVAL_DENIED'))
    expect(() => store.revoke('lzap1_' + 'b'.repeat(64), { by: BY })).toThrow(code('ERR_APPROVAL_NOT_FOUND'))
    expect(() => store.revoke(rec.requestId, { by: BY, reasonCode: 'because' })).toThrow(code('ERR_APPROVAL_INVALID_INPUT'))
    expect(() => store.revoke(rec.requestId, { by: { login: 'x' } })).toThrow(code('ERR_APPROVAL_INVALID_INPUT'))
  })

  it('sweepExpired appends one expired entry per expired approval and is idempotent', () => {
    const a = approve(prCtx(1))
    const b = approve(prCtx(2), { ttlMinutes: 60 })
    const c = approve(prCtx(3))
    const d = deny(prCtx(4))
    const r = approve(prCtx(5))
    store.revoke(r.requestId, { by: BY })
    nowMs += 2 * HOUR
    expect(store.sweepExpired()).toEqual([b.requestId])
    expect(store.sweepExpired()).toEqual([])
    nowMs += 3 * HOUR
    expect(store.sweepExpired().sort()).toEqual([a.requestId, c.requestId].sort())
    expect(store.sweepExpired()).toEqual([])
    const expired = lines().map(l => JSON.parse(l)).filter(e => e.type === 'expired')
    expect(expired).toHaveLength(3)
    expect(expired.map(e => e.request_id)).not.toContain(d.requestId)
    expect(expired.map(e => e.request_id)).not.toContain(r.requestId)
  })
})

describe('approval store: journal integrity', () => {
  it('writes a hash-linked chain from seq 1 with a zero prev', () => {
    approve(prCtx(1))
    approve(prCtx(2))
    const entries = lines().map(l => JSON.parse(l))
    expect(entries.map(e => e.seq)).toEqual([1, 2])
    expect(entries[0].prev).toBe('0'.repeat(64))
    expect(entries[1].prev).toBe(entries[0].hash)
    expect(entries[0]).toMatchObject({ v: 1, type: 'decided', decision: 'approve' })
  })

  const MUTATIONS = {
    'one edited byte': text => text.replace('octocat', 'octocaT'),
    'a deleted middle line': text => text.split('\n').filter((_l, i) => i !== 1).join('\n'),
    'a broken prev link': text => {
      const ls = text.split('\n')
      const e = JSON.parse(ls[1])
      e.prev = 'f'.repeat(64)
      ls[1] = rehash(e)
      return ls.join('\n')
    },
    'a truncated trailing newline': text => text.replace(/\n$/, ''),
    'a stored request changed without its hash': text => {
      const ls = text.split('\n')
      const idx = ls.length - 2
      const e = JSON.parse(ls[idx])
      e.request.pr.number = 999
      ls[idx] = rehash(e)
      return ls.join('\n')
    },
    'inserted whitespace': text => text.replace('"seq":1', '"seq": 1'),
    'an unknown entry type': text => {
      const ls = text.split('\n')
      const e = JSON.parse(ls[2])
      e.type = 'mystery'
      ls[2] = rehash(e)
      return ls.join('\n')
    },
    'an unknown version': text => {
      const ls = text.split('\n')
      const e = JSON.parse(ls[2])
      e.v = 2
      ls[2] = rehash(e)
      return ls.join('\n')
    },
    'garbage': text => `${text}not json\n`,
  }

  it.each(Object.entries(MUTATIONS))('fails closed on %s', (_name, mutate) => {
    const a = approve(prCtx(1))
    approve(prCtx(2))
    approve(prCtx(3))
    writeFileSync(journalFile(), mutate(readFileSync(journalFile(), 'utf8')), { mode: 0o600 })
    const corrupt = code('ERR_APPROVAL_STORE_CORRUPT')
    expect(() => approve(prCtx(4))).toThrow(corrupt)
    expect(() => store.verify(a.requestId, prCtx(1))).toThrow(corrupt)
    expect(() => store.revoke(a.requestId, { by: BY })).toThrow(corrupt)
    expect(() => store.list()).toThrow(corrupt)
    expect(() => store.sweepExpired()).toThrow(corrupt)
  })

  it('reports corruption for an empty-line gap in the middle', () => {
    approve(prCtx(1))
    approve(prCtx(2))
    const ls = lines()
    writeFileSync(journalFile(), `${ls[0]}\n\n${ls[1]}\n`, { mode: 0o600 })
    expect(() => store.list()).toThrow(code('ERR_APPROVAL_STORE_CORRUPT'))
  })

  it.skipIf(!posix)('keeps the directory 0700 and the journal 0600, and refuses a symlinked journal', () => {
    approve()
    expect(lstatSync(dir).mode & 0o777).toBe(0o700)
    expect(lstatSync(journalFile()).mode & 0o777).toBe(0o600)

    const target = join(dirname(dir), 'elsewhere.ndjson')
    renameSync(journalFile(), target)
    symlinkSync(target, journalFile())
    expect(() => approve(prCtx(2))).toThrow(code('ERR_APPROVAL_STORE_UNAVAILABLE'))
    expect(() => store.list()).toThrow(code('ERR_APPROVAL_STORE_UNAVAILABLE'))
    expect(readFileSync(target, 'utf8').split('\n').filter(Boolean)).toHaveLength(1)
  })

  it.skipIf(!posix)('tightens a loose store directory on open and refuses a symlinked one', () => {
    approve()
    chmodSync(dir, 0o755)
    open().list()
    expect(lstatSync(dir).mode & 0o777).toBe(0o700)

    const real = join(dirname(dir), 'real-dir')
    renameSync(dir, real)
    symlinkSync(real, dir)
    expect(() => open().list()).toThrow(code('ERR_APPROVAL_STORE_UNAVAILABLE'))
  })

  it('reports an unavailable store (not corruption) when the lock is held', () => {
    approve()
    writeFileSync(join(dir, 'approvals-v1.lock'), JSON.stringify({ pid: process.pid }), { mode: 0o600 })
    const started = performance.now()
    expect(() => approve(prCtx(2))).toThrow(code('ERR_APPROVAL_STORE_UNAVAILABLE'))
    expect(performance.now() - started).toBeLessThan(6000)
    expect(store.list()).toHaveLength(1)
  })
})

describe('approval store: concurrency', () => {
  it('lets exactly one of two processes approve the same context', async () => {
    const worker = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'approve-worker.js')
    const ctx = JSON.stringify(context())
    const run = fill => new Promise((resolve, reject) => {
      const child = fork(worker, [dir, ctx, iso(nowMs), String(fill)], { silent: true })
      child.once('message', resolve)
      child.once('error', reject)
      child.once('exit', c => { if (c !== 0) reject(new Error(`worker exited ${c}`)) })
    })
    const results = await Promise.all([run(7), run(9)])
    expect(results.filter(r => r.ok)).toHaveLength(1)
    const failed = results.find(r => !r.ok)
    expect(failed.code).toBe('ERR_APPROVAL_CONFLICT')
    const entries = lines().map(l => JSON.parse(l))
    expect(entries.filter(e => e.type === 'decided')).toHaveLength(1)
    expect(open().list()).toHaveLength(1)
  }, 20_000)
})
