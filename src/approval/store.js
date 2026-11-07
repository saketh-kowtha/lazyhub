/**
 * approval/store.js - the local approval record store (docs/design/optional-approval.md section 4).
 *
 * An append-only, hash-linked NDJSON journal under the user config directory.
 * It detects corruption and fails closed; it is not tamper-proof against
 * software running as the same OS user, and is never described as immutable.
 *
 * Groundwork only: nothing outside src/approval imports this module, it adds
 * no network call, config key, command or screen, and it enforces nothing.
 * Time and randomness are injected (`now`, `random`) so tests are exact.
 */

import { closeSync, constants, fstatSync, lstatSync, openSync, readFileSync, unlinkSync, writeSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { appendPrivateFile, assertPrivateDir, ensurePrivateDir } from '../secure-fs.js'
import { sanitize } from '../utils-core.js'
import {
  canonicalize, escapeOriginLabel, hashDomain, hashRequest, isIsoTimestamp as isIso, isRequestId, requestIdFor, validateApprover, validateRequest,
  REQUEST_SCHEMA,
} from './canonical.js'
import { ApprovalError, approvalError } from './errors.js'
import {
  APPROVABLE_OPERATIONS, CLOCK_SKEW_MAX_MS, FRESHNESS_MAX_MS, TTL_DEFAULT_MIN, TTL_MAX_MIN, TTL_MIN_MIN, getPolicyVersions,
} from './policy.js'

const JOURNAL_FILE = 'approvals-v1.ndjson'
const LOCK_FILE = 'approvals-v1.lock'
const JOURNAL_DOMAIN = 'lazyhub.approval-journal/1'
const ZERO_HASH = '0'.repeat(64)
const LOCK_WAIT_MS = 2000
const LOCK_STALE_MS = 30_000
const INTENT_MAX = 2000
const NOFOLLOW = constants.O_NOFOLLOW || 0

const STATES = ['approved', 'denied', 'revoked', 'expired']
const REVOKE_REASONS = ['user_revoked', 'safe_mode']
const PUBLICATION_KINDS = ['success', 'failure']
const PUBLICATION_STATES = ['attempted', 'confirmed', 'failed', 'uncertain']

const corrupt = () => approvalError('ERR_APPROVAL_STORE_CORRUPT')
const unavailable = () => approvalError('ERR_APPROVAL_STORE_UNAVAILABLE')
const invalid = (...fields) => approvalError('ERR_APPROVAL_INVALID_INPUT', fields)

// Wall-clock milliseconds without the ambient Date clock (only used for lock ageing).
const wallMs = () => performance.timeOrigin + performance.now()

function sleepMs(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && [Object.prototype, null].includes(Object.getPrototypeOf(value))
}

function pidAlive(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    return err.code === 'EPERM'
  }
}

// --- journal parsing ---------------------------------------------------------

const hasExactKeys = (obj, required, optional = []) => {
  const keys = Object.keys(obj)
  return required.every(k => keys.includes(k)) && keys.every(k => required.includes(k) || optional.includes(k))
}

// Validate one parsed entry's type-specific fields. Throws on any problem.
function checkEntryFields(entry, models) {
  const known = id => models.get(id)
  switch (entry.type) {
    case 'decided': {
      if (!hasExactKeys(entry, ['v', 'seq', 'prev', 'at', 'type', 'hash', 'request_id', 'request_hash', 'request', 'decision', 'untrusted'])) throw corrupt()
      if (!['approve', 'deny'].includes(entry.decision)) throw corrupt()
      if (!isPlainObject(entry.untrusted) || !hasExactKeys(entry.untrusted, ['intent']) || typeof entry.untrusted.intent !== 'string' || entry.untrusted.intent.length > INTENT_MAX) throw corrupt()
      validateRequest(entry.request)
      const hash = hashRequest(entry.request)
      if (entry.request_hash !== hash || entry.request_id !== requestIdFor(hash)) throw corrupt()
      if (models.has(entry.request_id)) throw corrupt()
      break
    }
    case 'revoked': {
      if (!hasExactKeys(entry, ['v', 'seq', 'prev', 'at', 'type', 'hash', 'request_id', 'by', 'reason_code'])) throw corrupt()
      if (!known(entry.request_id) || known(entry.request_id).decision !== 'approve') throw corrupt()
      if (!REVOKE_REASONS.includes(entry.reason_code)) throw corrupt()
      validateApprover(entry.by, 'by')
      break
    }
    case 'expired':
      if (!hasExactKeys(entry, ['v', 'seq', 'prev', 'at', 'type', 'hash', 'request_id'])) throw corrupt()
      if (!known(entry.request_id) || known(entry.request_id).decision !== 'approve') throw corrupt()
      break
    case 'publication': {
      if (!hasExactKeys(entry, ['v', 'seq', 'prev', 'at', 'type', 'hash', 'request_id', 'kind', 'state'], ['check_run_id', 'check_run_url', 'code'])) throw corrupt()
      if (!known(entry.request_id) || !PUBLICATION_KINDS.includes(entry.kind) || !PUBLICATION_STATES.includes(entry.state)) throw corrupt()
      if ('check_run_id' in entry && !(Number.isSafeInteger(entry.check_run_id) && entry.check_run_id > 0)) throw corrupt()
      if ('check_run_url' in entry && !(typeof entry.check_run_url === 'string' && entry.check_run_url.length <= 500)) throw corrupt()
      if ('code' in entry && !(typeof entry.code === 'string' && /^ERR_APPROVAL_[A-Z_]{1,60}$/.test(entry.code))) throw corrupt()
      break
    }
    case 'safe_mode':
      if (!hasExactKeys(entry, ['v', 'seq', 'prev', 'at', 'type', 'hash', 'engaged', 'by']) || typeof entry.engaged !== 'boolean') throw corrupt()
      validateApprover(entry.by, 'by')
      break
    default:
      throw corrupt()
  }
}

// Parse and fully verify a journal text. Throws ERR_APPROVAL_STORE_CORRUPT.
function parseJournal(text) {
  const entries = []
  const models = new Map()
  if (text === '') return { entries, models, tail: ZERO_HASH }
  if (!text.endsWith('\n')) throw corrupt()
  const lines = text.slice(0, -1).split('\n')
  for (let i = 0; i < lines.length; i += 1) {
    try {
      const line = lines[i]
      const entry = JSON.parse(line)
      if (!isPlainObject(entry)) throw corrupt()
      if (canonicalize(entry) !== line) throw corrupt()
      if (entry.v !== 1 || entry.seq !== i + 1 || entry.prev !== (i === 0 ? ZERO_HASH : entries[i - 1].hash) || !isIso(entry.at)) throw corrupt()
      const { hash, ...rest } = entry
      if (hash !== hashDomain(JOURNAL_DOMAIN, rest)) throw corrupt()
      checkEntryFields(entry, models)
      entries.push(entry)
      if (entry.type === 'decided') {
        models.set(entry.request_id, {
          requestId: entry.request_id,
          requestHash: entry.request_hash,
          request: entry.request,
          decision: entry.decision,
          untrusted: { intent: entry.untrusted.intent },
          entries: [entry],
          seq: entry.seq,
          revoked: null,
          expired: null,
          publications: [],
        })
      } else if (entry.request_id) {
        const model = models.get(entry.request_id)
        model.entries.push(entry)
        if (entry.type === 'revoked' && !model.revoked) model.revoked = entry
        if (entry.type === 'expired' && !model.expired) model.expired = entry
        if (entry.type === 'publication') model.publications.push(entry)
      }
    } catch {
      throw corrupt()
    }
  }
  return { entries, models, tail: entries[entries.length - 1].hash }
}

function stateOf(model, nowMs) {
  if (model.decision === 'deny') return 'denied'
  if (model.revoked) return 'revoked'
  if (model.expired || nowMs >= Date.parse(model.request.expires_at)) return 'expired'
  return 'approved'
}

function viewOf(model, nowMs) {
  return {
    requestId: model.requestId,
    requestHash: model.requestHash,
    request: model.request,
    decision: model.decision,
    untrusted: model.untrusted,
    state: stateOf(model, nowMs),
    entries: model.entries.map(e => ({ ...e })),
  }
}

// --- context handling --------------------------------------------------------

const BOUND_CONTEXT_KEYS = ['host', 'repo_node_id', 'pr_node_id', 'number', 'base_ref', 'base_sha', 'head_ref', 'head_sha', 'head_repo_node_id']
const CREATE_CONTEXT_KEYS = [...BOUND_CONTEXT_KEYS, 'name_with_owner', 'state', 'is_cross_repository', 'fetched_at']

function requireContext(context, keys) {
  if (!isPlainObject(context)) throw invalid('context')
  const missing = keys.filter(k => context[k] === undefined || context[k] === null)
  if (!isPlainObject(context.approver)) missing.push('approver')
  else for (const k of ['host', 'login', 'node_id']) if (typeof context.approver[k] !== 'string' || !context.approver[k]) missing.push(`approver.${k}`)
  if (missing.length) throw invalid(...missing)
  return context
}

function checkTimestamp(value, field, nowMs) {
  if (!isIso(value)) throw invalid(field)
  const at = Date.parse(value)
  if (at > nowMs + CLOCK_SKEW_MAX_MS) throw approvalError('ERR_APPROVAL_CLOCK', [field])
  return at
}

function escapeIntent(raw) {
  return sanitize(raw ?? '').slice(0, INTENT_MAX)
}

// --- the store ---------------------------------------------------------------

/**
 * Open (creating if needed) the approval store.
 * @param {{ dir?: string, now?: () => Date, random?: (n: number) => Uint8Array }} [opts]
 */
export function openApprovalStore({ dir = join(homedir(), '.config', 'lazyhub', 'approvals'), now = () => new Date(), random = randomBytes } = {}) {
  const journalPath = join(dir, JOURNAL_FILE)
  const lockPath = join(dir, LOCK_FILE)

  const nowMs = () => {
    const t = now().getTime()
    if (!Number.isFinite(t)) throw approvalError('ERR_APPROVAL_CLOCK')
    return t
  }

  // Run a filesystem step; anything that is not already an ApprovalError becomes "store unavailable".
  function guard(fn) {
    try {
      return fn()
    } catch (err) {
      if (err instanceof ApprovalError) throw err
      throw unavailable()
    }
  }

  function prepareDir() {
    guard(() => {
      try {
        if (lstatSync(dir).isSymbolicLink()) throw unavailable()
      } catch (err) {
        if (err.code !== 'ENOENT') throw err
      }
      ensurePrivateDir(dir)
      assertPrivateDir(dir)
    })
  }

  function readText() {
    return guard(() => {
      let fd
      try {
        fd = openSync(journalPath, constants.O_RDONLY | NOFOLLOW)
      } catch (err) {
        if (err.code === 'ENOENT') return ''
        throw err
      }
      try {
        if (!fstatSync(fd).isFile()) throw unavailable()
        return readFileSync(fd, 'utf8')
      } finally {
        closeSync(fd)
      }
    })
  }

  // Read and verify the whole journal; a concurrent append may be seen torn, so retry briefly.
  function readJournal() {
    prepareDir()
    for (let attempt = 0; ; attempt += 1) {
      try {
        return parseJournal(readText())
      } catch (err) {
        if (!(err instanceof ApprovalError) || err.code !== 'ERR_APPROVAL_STORE_CORRUPT' || attempt >= 2) throw err
        sleepMs(15)
      }
    }
  }

  function removeLockIfStale() {
    return guard(() => {
      let st
      try {
        st = lstatSync(lockPath)
      } catch (err) {
        if (err.code === 'ENOENT') return true
        throw err
      }
      if (wallMs() - st.mtimeMs <= LOCK_STALE_MS) return false
      let pid = null
      try { pid = JSON.parse(readFileSync(lockPath, 'utf8')).pid } catch { /* unreadable lock: treat as dead */ }
      if (pidAlive(pid)) return false
      try {
        if (lstatSync(lockPath).ino === st.ino) unlinkSync(lockPath)
      } catch { /* someone else removed or replaced it */ }
      return true
    })
  }

  function acquireLock() {
    prepareDir()
    const deadline = performance.now() + LOCK_WAIT_MS
    let delay = 5
    for (;;) {
      try {
        const fd = openSync(lockPath, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | NOFOLLOW, 0o600)
        try { writeSync(fd, JSON.stringify({ pid: process.pid })) } finally { closeSync(fd) }
        return
      } catch (err) {
        if (err.code !== 'EEXIST') throw unavailable()
      }
      if (removeLockIfStale()) continue
      if (performance.now() >= deadline) throw unavailable()
      sleepMs(delay)
      delay = Math.min(delay * 2, 100)
    }
  }

  function withLock(fn) {
    acquireLock()
    try {
      return fn()
    } finally {
      try { unlinkSync(lockPath) } catch { /* a stale lock is reclaimed by age and pid */ }
    }
  }

  // Appends entries inside the lock, tracking the chain tail in memory.
  function appender(journal) {
    let seq = journal.entries.length
    let prev = journal.tail
    return (type, fields) => {
      seq += 1
      const entry = { v: 1, seq, prev, at: new Date(nowMs()).toISOString(), type, ...fields }
      const hash = hashDomain(JOURNAL_DOMAIN, entry)
      const full = { ...entry, hash }
      guard(() => appendPrivateFile(journalPath, `${canonicalize(full)}\n`, { fsync: true }))
      prev = hash
      return full
    }
  }

  function activeConflict(journal, request, at) {
    for (const model of journal.models.values()) {
      const r = model.request
      if (model.decision === 'approve' && stateOf(model, at) === 'approved'
        && r.host === request.host && r.repo.node_id === request.repo.node_id && r.pr.node_id === request.pr.node_id
        && r.head.sha === request.head.sha && r.base.sha === request.base.sha && r.operation === request.operation) return true
    }
    return false
  }

  return {
    /**
     * Record an approve or deny decision for the exact observed context.
     * @param {object} input
     * @param {object} input.context the typed context read
     * @param {'approve'|'deny'} input.decision
     * @param {{digest: string, observed_at: string}} input.evidence what the approver saw
     * @param {string} input.coverageClass recorded as computed; never an authority input
     * @param {{declared_kind?: string, label?: string}} [input.origin] unverified metadata
     * @param {string} [input.untrustedIntent] agent or author text; stored outside the hash
     * @param {number} [input.ttlMinutes]
     * @param {string} [input.operation]
     */
    createApprovalRecord({ context, decision, evidence, coverageClass, origin, untrustedIntent, ttlMinutes = TTL_DEFAULT_MIN, operation = 'merge' }) {
      if (!['approve', 'deny'].includes(decision)) throw invalid('decision')
      if (!APPROVABLE_OPERATIONS.includes(operation)) throw approvalError('ERR_APPROVAL_UNSUPPORTED', ['operation'])
      if (!Number.isSafeInteger(ttlMinutes) || ttlMinutes < TTL_MIN_MIN || ttlMinutes > TTL_MAX_MIN) throw invalid('ttl_minutes')
      requireContext(context, CREATE_CONTEXT_KEYS)
      if (!isPlainObject(evidence)) throw invalid('evidence')
      if (context.state !== 'OPEN' || context.is_cross_repository !== false || context.head_repo_node_id !== context.repo_node_id) {
        throw approvalError('ERR_APPROVAL_UNSUPPORTED', ['context'])
      }
      const at = nowMs()
      const observedAt = checkTimestamp(evidence.observed_at, 'evidence.observed_at', at)
      const fetchedAt = checkTimestamp(context.fetched_at, 'context.fetched_at', at)
      if (at - observedAt > FRESHNESS_MAX_MS) throw approvalError('ERR_APPROVAL_EVIDENCE_STALE', ['evidence.observed_at'])
      if (at - fetchedAt > FRESHNESS_MAX_MS) throw approvalError('ERR_APPROVAL_EVIDENCE_STALE', ['context.fetched_at'])
      if (origin !== undefined && !isPlainObject(origin)) throw invalid('origin')
      const nonceBytes = Buffer.from(random(16))
      if (nonceBytes.length !== 16) throw invalid('nonce')
      const versions = getPolicyVersions()
      const request = {
        schema: REQUEST_SCHEMA,
        host: context.host,
        repo: { node_id: context.repo_node_id, name_with_owner: context.name_with_owner },
        pr: { node_id: context.pr_node_id, number: context.number },
        base: { ref: context.base_ref, sha: context.base_sha },
        head: { ref: context.head_ref, sha: context.head_sha, repo_node_id: context.head_repo_node_id },
        operation,
        policy_version: versions.policy,
        evidence: { schema_version: versions.evidence, digest: evidence.digest, observed_at: evidence.observed_at },
        coverage_class: coverageClass,
        approver: { host: context.approver.host, login: context.approver.login, node_id: context.approver.node_id, auth_method: 'gh_session_tty' },
        origin: { declared_kind: origin?.declared_kind ?? 'unknown', label: escapeOriginLabel(origin?.label), verified: false },
        issued_at: new Date(at).toISOString(),
        expires_at: new Date(at + ttlMinutes * 60_000).toISOString(),
        nonce: nonceBytes.toString('hex'),
      }
      validateRequest(request)
      const requestHash = hashRequest(request)
      const requestId = requestIdFor(requestHash)
      const intent = escapeIntent(untrustedIntent)

      return withLock(() => {
        const journal = readJournal()
        if (journal.models.has(requestId) || activeConflict(journal, request, nowMs())) throw approvalError('ERR_APPROVAL_CONFLICT')
        const append = appender(journal)
        const entry = append('decided', {
          request_id: requestId, request_hash: requestHash, request, decision, untrusted: { intent },
        })
        const record = {
          requestId, requestHash, request, decision, untrusted: { intent },
          state: decision === 'deny' ? 'denied' : 'approved', entries: [entry],
        }
        return { requestId, requestHash, record }
      })
    },

    /**
     * Check a stored approval against a freshly observed context.
     * Never throws for a stale record; throws only for store errors or bad input.
     * @param {string} requestId
     * @param {object} observed the typed context read
     */
    verify(requestId, observed) {
      if (!isRequestId(requestId)) throw invalid('request_id')
      requireContext(observed, BOUND_CONTEXT_KEYS)
      const model = readJournal().models.get(requestId)
      if (!model) return { ok: false, code: 'ERR_APPROVAL_NOT_FOUND', changed: [] }
      const at = nowMs()
      const state = stateOf(model, at)
      if (state === 'denied') return { ok: false, code: 'ERR_APPROVAL_DENIED', changed: ['denied'] }
      if (state === 'revoked') return { ok: false, code: 'ERR_APPROVAL_REVOKED', changed: ['revoked'] }
      if (state === 'expired') return { ok: false, code: 'ERR_APPROVAL_EXPIRED', changed: ['expires_at'] }
      const r = model.request
      if (Date.parse(r.issued_at) > at + CLOCK_SKEW_MAX_MS) return { ok: false, code: 'ERR_APPROVAL_CLOCK', changed: ['issued_at'] }

      const versions = getPolicyVersions()
      const problems = []
      const check = (differs, code, field) => { if (differs) problems.push([code, field]) }
      check(observed.host !== r.host, 'ERR_APPROVAL_CONTEXT_MISMATCH', 'host')
      check(observed.repo_node_id !== r.repo.node_id, 'ERR_APPROVAL_CONTEXT_MISMATCH', 'repo.node_id')
      check(observed.pr_node_id !== r.pr.node_id, 'ERR_APPROVAL_CONTEXT_MISMATCH', 'pr.node_id')
      check(observed.is_cross_repository === true || observed.head_repo_node_id !== observed.repo_node_id, 'ERR_APPROVAL_UNSUPPORTED', 'head.repo_node_id')
      check(observed.head_ref !== r.head.ref, 'ERR_APPROVAL_STALE_HEAD', 'head.ref')
      check(observed.head_sha !== r.head.sha, 'ERR_APPROVAL_STALE_HEAD', 'head.sha')
      check(observed.base_ref !== r.base.ref, 'ERR_APPROVAL_STALE_BASE', 'base.ref')
      check(observed.base_sha !== r.base.sha, 'ERR_APPROVAL_STALE_BASE', 'base.sha')
      check(r.policy_version !== versions.policy, 'ERR_APPROVAL_POLICY_CHANGED', 'policy_version')
      check(r.evidence.schema_version !== versions.evidence, 'ERR_APPROVAL_EVIDENCE_CHANGED', 'evidence.schema_version')
      check(observed.approver.node_id !== r.approver.node_id, 'ERR_APPROVAL_APPROVER_CHANGED', 'approver.node_id')
      if (problems.length) return { ok: false, code: problems[0][0], changed: problems.map(p => p[1]) }
      return { ok: true, record: viewOf(model, at) }
    },

    /**
     * Revoke an approval. Tightening is always allowed, including after expiry.
     * Idempotent: revoking a revoked record returns it with `already: true`.
     * @param {string} requestId
     * @param {{ by: object, reasonCode?: string }} opts
     */
    revoke(requestId, { by, reasonCode = 'user_revoked' }) {
      if (!isRequestId(requestId)) throw invalid('request_id')
      validateApprover(by, 'by')
      if (!REVOKE_REASONS.includes(reasonCode)) throw invalid('reason_code')
      return withLock(() => {
        const journal = readJournal()
        const model = journal.models.get(requestId)
        if (!model) throw approvalError('ERR_APPROVAL_NOT_FOUND')
        if (model.decision === 'deny') throw approvalError('ERR_APPROVAL_DENIED')
        if (model.revoked) return { ...viewOf(model, nowMs()), already: true }
        const entry = appender(journal)('revoked', { request_id: requestId, by: { ...by }, reason_code: reasonCode })
        model.entries.push(entry)
        model.revoked = entry
        return viewOf(model, nowMs())
      })
    },

    /**
     * Summaries of every record, newest first.
     * @param {{ host?: string, repoNodeId?: string, prNodeId?: string, state?: string }} [filter]
     */
    list({ host, repoNodeId, prNodeId, state } = {}) {
      if (state !== undefined && !STATES.includes(state)) throw invalid('state')
      const at = nowMs()
      const out = []
      for (const model of readJournal().models.values()) {
        const r = model.request
        const current = stateOf(model, at)
        if ((host && r.host !== host) || (repoNodeId && r.repo.node_id !== repoNodeId) || (prNodeId && r.pr.node_id !== prNodeId) || (state && current !== state)) continue
        const pub = model.publications[model.publications.length - 1]
        out.push({
          seq: model.seq,
          summary: {
            requestId: model.requestId,
            state: current,
            prNumber: r.pr.number,
            nameWithOwner: r.repo.name_with_owner,
            headSha: r.head.sha,
            baseRef: r.base.ref,
            baseSha: r.base.sha,
            issuedAt: r.issued_at,
            expiresAt: r.expires_at,
            approverLogin: r.approver.login,
            publication: pub
              ? { state: pub.state, kind: pub.kind, ...(pub.check_run_url ? { checkRunUrl: pub.check_run_url } : {}), ...(pub.code ? { code: pub.code } : {}) }
              : { state: 'none' },
          },
        })
      }
      return out.sort((a, b) => b.seq - a.seq).map(x => x.summary)
    },

    /**
     * The full record with its journal entries, or null.
     * @param {string} requestId
     */
    get(requestId) {
      const journal = readJournal()
      const model = isRequestId(requestId) ? journal.models.get(requestId) : null
      return model ? viewOf(model, nowMs()) : null
    },

    /**
     * Append one `expired` entry for each approval past its expiry. Idempotent.
     * Not called by anything in the groundwork.
     * @returns {string[]} request IDs that were expired by this call
     */
    sweepExpired() {
      return withLock(() => {
        const journal = readJournal()
        const append = appender(journal)
        const at = nowMs()
        const done = []
        for (const model of journal.models.values()) {
          if (model.decision !== 'approve' || model.revoked || model.expired) continue
          if (at < Date.parse(model.request.expires_at)) continue
          const entry = append('expired', { request_id: model.requestId })
          model.entries.push(entry)
          model.expired = entry
          done.push(model.requestId)
        }
        return done
      })
    },
  }
}
