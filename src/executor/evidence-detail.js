/**
 * executor/evidence-detail.js - the read-only evidence DETAIL for one PR (#175, #127).
 *
 * Builds on the per-PR record in evidence.js / activity.js (`fetchPRReviewEvidence`) and adds
 * what that record does not carry: file-level diff facts, the required-checks read, and the
 * inspected-revision / freshness comparison. Display evidence only: nothing here is an
 * authorization input and nothing is written (ARCHITECT_DECISIONS D1, THREAT_MODEL T1/T3/T7).
 * Exact binding to a head stays with the approval work (#235/#244/#278).
 *
 * STABLE API (the review queue, #177, may consume these; names and shapes will not change
 * without a bump of EVIDENCE_DETAIL_VERSION):
 *
 *   loadEvidenceDetail(repo, number, { cache?, force?, inspectedHead?, now? })
 *       -> Promise<EvidenceDetail>
 *      Three independent reads (record, files, required checks). The record failing throws; the
 *      other two degrade to an explicit `unknown` fact plus an entry in `errors`, never a guess.
 *   classifyPath(path) -> 'test' | 'docs' | 'ci' | 'lockfile' | 'manifest' | 'source'
 *   fileObservations(files) -> observation[]            deterministic, each cites a path
 *   compareHead(inspectedHead, currentHead) -> { state: 'current'|'stale'|'unknown', inspected, current }
 *   freshness(fetchedAt, now?, ttlMs?) -> { age_ms, stale }
 *   evidenceRows(detail, { now? }) -> Row[]             the flat, ordered, display-ready model
 *   returnTarget({ view, position, filter, key }) -> frozen { view, position, filter, key }
 *      The shape a caller (queue or detail) passes to the evidence view to get back where it was.
 *
 * EvidenceDetail:
 *   { schema_version, record, files, required_checks, head: compareHead(...), errors: [{part, message}], fetched_at }
 *   record          the evidence.js record with facts.required_checks replaced by `required_checks`
 *   files           fact whose value is { items[{path,additions,deletions,change_type,kind}], total,
 *                   returned, truncated, head } (value 'unknown' when it could not be read)
 *   required_checks fact whose value is { required, passing, failing, pending, total, truncated, head }
 *
 * Row: { section, label, value, tone: 'ok'|'bad'|'warn'|'muted'|'plain', source, fetched_at, untrusted? }
 *   `untrusted` rows hold author-written prose (already cleaned by sanitize()); they are display
 *   only. Every other row is a computed fact with its source and read time.
 *
 * D16: file lists are read by cursor to FILE_CEILING and `truncated` says so with the total;
 * counts that cover only fetched checks/threads are marked as lower bounds, never as totals.
 */

import { runGh } from './core.js'
import { isOwnerName } from '../config/schema.js'
import { sanitize, sanitizePath, sanitizeRaw } from '../utils-core.js'
import { UNKNOWN, fact } from './evidence.js'
import { fetchPRReviewEvidence } from './activity.js'

export const EVIDENCE_DETAIL_VERSION = 1
const FILES_PAGE = 100
/** Files read per PR (3 cursor pages). GitHub caps a PR at 3000; the rest is reported, not hidden. */
export const FILE_CEILING = 300
const CHECKS_PAGE = 100
/** Record older than this is shown as stale and is not trusted as current. */
export const FRESH_MS = 60_000

const FILES_QUERY = `
query($owner: String!, $name: String!, $number: Int!, $limit: Int!, $after: String) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      headRefOid
      files(first: $limit, after: $after) {
        totalCount
        pageInfo { hasNextPage endCursor }
        nodes { path additions deletions changeType }
      }
    }
  }
}`

// isRequired is evaluated by GitHub for this PR, so it needs no branch-protection admin read.
const REQUIRED_QUERY = `
query($owner: String!, $name: String!, $number: Int!, $limit: Int!) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      headRefOid
      commits(last: 1) { nodes { commit { statusCheckRollup { contexts(first: $limit) {
        totalCount
        pageInfo { hasNextPage }
        nodes {
          __typename
          ... on CheckRun { name status conclusion isRequired(pullRequestNumber: $number) }
          ... on StatusContext { context state isRequired(pullRequestNumber: $number) }
        }
      } } } } }
    }
  }
}`

const PATH_KINDS = /** @type {const} */ ([
  ['ci', /^\.github\/workflows\//],
  ['lockfile', /(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|Cargo\.lock|go\.sum|poetry\.lock|Gemfile\.lock|composer\.lock)$/],
  ['manifest', /(^|\/)(package\.json|go\.mod|Cargo\.toml|requirements\.txt|pyproject\.toml|Gemfile|composer\.json|pom\.xml)$/],
  ['test', /(^|\/)(tests?|__tests__|spec|specs)\/|\.(test|spec)\.[cm]?[jt]sx?$|_test\.go$|(^|\/)test_[^/]*\.py$|_spec\.rb$/],
  ['docs', /(^|\/)docs?\/|\.(md|mdx|rst|txt)$/i],
])

/**
 * Deterministic, path-only classification. It says what a path LOOKS like, not what the change does.
 * @param {string} path
 * @returns {'test'|'docs'|'ci'|'lockfile'|'manifest'|'source'}
 */
export function classifyPath(path) {
  const p = String(path || '')
  for (const [kind, re] of PATH_KINDS) if (re.test(p)) return kind
  return 'source'
}

/**
 * Neutral observations about the changed files. Each cites the paths it came from and is a
 * pointer for a human, not a verdict.
 * @param {{path: string, change_type: string, kind: string}[]} files
 */
export function fileObservations(files) {
  /** @type {{code: string, paths: string[]}[]} */
  const out = []
  const pick = (/** @type {(f: any) => boolean} */ pred) => files.filter(pred).map(f => f.path)
  const testsRemoved = pick(f => f.kind === 'test' && f.change_type === 'DELETED')
  if (testsRemoved.length) out.push({ code: 'tests_removed', paths: testsRemoved })
  const ci = pick(f => f.kind === 'ci')
  if (ci.length) out.push({ code: 'ci_workflow_changed', paths: ci })
  const manifests = files.some(f => f.kind === 'manifest')
  const locks = pick(f => f.kind === 'lockfile')
  if (locks.length && !manifests) out.push({ code: 'lockfile_without_manifest', paths: locks })
  if (files.length > 0 && !files.some(f => f.kind === 'test') && files.some(f => f.kind === 'source')) out.push({ code: 'no_test_files_changed', paths: [] })
  return out
}

/**
 * Inspected revision vs the revision GitHub reports now.
 * @param {string|null|undefined} inspectedHead
 * @param {string|null|undefined} currentHead
 * @returns {{state: 'current'|'stale'|'unknown', inspected: string|null, current: string|null}}
 */
export function compareHead(inspectedHead, currentHead) {
  const inspected = inspectedHead && inspectedHead !== UNKNOWN ? inspectedHead : null
  const current = currentHead && currentHead !== UNKNOWN ? currentHead : null
  if (!inspected || !current) return { state: 'unknown', inspected, current }
  return { state: inspected === current ? 'current' : 'stale', inspected, current }
}

/**
 * @param {string|null|undefined} fetchedAt ISO time
 * @param {number} [now]
 * @param {number} [ttlMs]
 */
export function freshness(fetchedAt, now = Date.now(), ttlMs = FRESH_MS) {
  const at = Date.parse(String(fetchedAt || ''))
  if (!Number.isFinite(at)) return { age_ms: /** @type {number|null} */ (null), stale: true }
  const age = Math.max(0, now - at)
  return { age_ms: /** @type {number|null} */ (age), stale: age > ttlMs }
}

/**
 * @param {{view?: string, position?: number, filter?: string, key?: string}} [t]
 */
export function returnTarget({ view = 'detail', position = 0, filter = '', key = '' } = {}) {
  return Object.freeze({ view: String(view), position: Math.max(0, Math.trunc(Number(position)) || 0), filter: String(filter), key: String(key) })
}

/** @param {string} repo @param {number} number */
function validate(repo, number) {
  const [owner, name] = String(repo || '').split('/')
  const n = Number(number)
  if (!owner || !name || !isOwnerName(repo)) throw new Error(`invalid repo "${repo}", expected owner/name`)
  if (!Number.isInteger(n) || n < 1) throw new Error(`invalid pull request number "${number}"`)
  return { owner, name, n }
}

/**
 * File-level diff facts, read by cursor up to FILE_CEILING. Paths only (no patch text).
 * @param {string} repo
 * @param {number} number
 * @param {{now?: () => number}} [opts]
 */
export async function fetchFileEvidence(repo, number, { now = Date.now } = {}) {
  const { owner, name, n } = validate(repo, number)
  /** @type {any[]} */
  const items = []
  let after = null
  let total = 0
  let head = null
  let hasMore = false
  while (items.length < FILE_CEILING) {
    const args = ['api', 'graphql', '-f', `query=${FILES_QUERY}`, '-f', `owner=${owner}`, '-f', `name=${name}`, '-F', `number=${n}`, '-F', `limit=${FILES_PAGE}`]
    if (after) args.push('-f', `after=${after}`)
    const result = await runGh(args)
    const pr = result?.data?.repository?.pullRequest
    if (!pr) throw new Error(`could not read files for ${repo}#${n}: ${result?.errors?.[0]?.message || 'not found or not readable'}`)
    const conn = pr.files || {}
    if (head && pr.headRefOid && head !== pr.headRefOid) throw new Error('head moved while reading files; refresh to read a consistent set')
    head = pr.headRefOid || head
    total = Number(conn.totalCount ?? 0)
    for (const f of conn.nodes || []) {
      if (!f || typeof f.path !== 'string' || !f.path) continue
      items.push({ path: f.path, additions: Number(f.additions) || 0, deletions: Number(f.deletions) || 0, change_type: String(f.changeType || 'MODIFIED'), kind: classifyPath(f.path) })
    }
    hasMore = Boolean(conn.pageInfo?.hasNextPage && conn.pageInfo.endCursor)
    after = hasMore ? conn.pageInfo.endCursor : null
    if (!hasMore) break
  }
  const kept = items.slice(0, FILE_CEILING)
  const value = { items: kept, total: Math.max(total, kept.length), returned: kept.length, truncated: hasMore || total > kept.length, head: head || UNKNOWN }
  return fact(value, 'github.graphql.pullRequest.files', new Date(now()).toISOString())
}

/**
 * Required-check state from GitHub's own per-PR `isRequired`. A required check that never
 * reported cannot be seen from here; the value says so instead of counting it as passing.
 * @param {string} repo
 * @param {number} number
 * @param {{now?: () => number}} [opts]
 */
export async function fetchRequiredChecks(repo, number, { now = Date.now } = {}) {
  const { owner, name, n } = validate(repo, number)
  const result = await runGh(['api', 'graphql', '-f', `query=${REQUIRED_QUERY}`, '-f', `owner=${owner}`, '-f', `name=${name}`, '-F', `number=${n}`, '-F', `limit=${CHECKS_PAGE}`])
  const pr = result?.data?.repository?.pullRequest
  if (!pr) throw new Error(`could not read required checks for ${repo}#${n}: ${result?.errors?.[0]?.message || 'not found or not readable'}`)
  const rollup = pr.commits?.nodes?.[0]?.commit?.statusCheckRollup
  const fetchedAt = new Date(now()).toISOString()
  const source = 'github.graphql.pullRequest.commits.last.statusCheckRollup.contexts.isRequired'
  if (!rollup) return fact({ required: 0, passing: 0, failing: 0, pending: 0, total: 0, truncated: false, head: pr.headRefOid || UNKNOWN, names: [] }, source, fetchedAt)
  const nodes = rollup.contexts?.nodes || []
  let passing = 0
  let failing = 0
  let pending = 0
  /** @type {string[]} */
  const names = []
  for (const c of nodes) {
    if (!c || c.isRequired !== true) continue
    const outcome = c.__typename === 'StatusContext' ? c.state : (c.status === 'COMPLETED' ? c.conclusion : 'PENDING')
    names.push(String(c.name || c.context || ''))
    if (['SUCCESS', 'NEUTRAL', 'SKIPPED'].includes(outcome)) passing += 1
    else if (['FAILURE', 'ERROR', 'TIMED_OUT', 'CANCELLED', 'STARTUP_FAILURE', 'ACTION_REQUIRED'].includes(outcome)) failing += 1
    else pending += 1
  }
  const total = Number(rollup.contexts?.totalCount ?? nodes.length)
  return fact({ required: passing + failing + pending, passing, failing, pending, total, truncated: total > nodes.length || Boolean(rollup.contexts?.pageInfo?.hasNextPage), head: pr.headRefOid || UNKNOWN, names }, source, fetchedAt)
}

/** @param {unknown} err */
const messageOf = err => sanitizeRaw(err instanceof Error ? err.message : String(err)).slice(0, 300)

/**
 * The full read-only detail: record + files + required checks, three independent reads.
 *
 * @param {string} repo
 * @param {number} number
 * @param {object} [opts]
 * @param {any} [opts.cache]            createEvidenceCache() instance
 * @param {boolean} [opts.force]
 * @param {string|null} [opts.inspectedHead] head the user first inspected; defaults to the head read now
 * @param {() => number} [opts.now]
 */
export async function loadEvidenceDetail(repo, number, { cache, force = false, inspectedHead = null, now = Date.now } = {}) {
  validate(repo, number)
  const [recordR, filesR, requiredR] = await Promise.allSettled([
    fetchPRReviewEvidence(repo, number, { cache, force, now }),
    fetchFileEvidence(repo, number, { now }),
    fetchRequiredChecks(repo, number, { now }),
  ])
  if (recordR.status === 'rejected') throw recordR.reason
  const fetchedAt = new Date(now()).toISOString()
  /** @type {{part: string, message: string}[]} */
  const errors = []
  const settle = (/** @type {PromiseSettledResult<any>} */ r, /** @type {string} */ part) => {
    if (r.status === 'fulfilled') return r.value
    errors.push({ part, message: messageOf(r.reason) })
    return fact(UNKNOWN, `unavailable:${part}`, fetchedAt)
  }
  const files = settle(filesR, 'files')
  const required = settle(requiredR, 'required_checks')
  const currentHead = recordR.value.context.head.value
  const record = { ...recordR.value, facts: { ...recordR.value.facts, required_checks: required } }
  return {
    schema_version: EVIDENCE_DETAIL_VERSION,
    record,
    files,
    required_checks: required,
    head: compareHead(inspectedHead || currentHead, currentHead),
    errors,
    fetched_at: fetchedAt,
  }
}

/** @param {any} f a fact */
const isUnknown = f => f?.value === UNKNOWN

/** @param {number} n @param {string} one @param {string} many */
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`

const short = (/** @type {any} */ sha) => (sha && sha !== UNKNOWN ? sanitize(String(sha)).slice(0, 7) : UNKNOWN)
/** Enum-like values come from GitHub too; they are cleaned before they reach a row. */
const word = (/** @type {any} */ v) => sanitize(String(v))

/**
 * Flat, ordered, display-ready rows. Pure: `detail` in, rows out. All GitHub text is cleaned here
 * (prose with sanitize(), paths with sanitizePath()); the view draws row.value as-is.
 *
 * @param {any} detail from loadEvidenceDetail()
 * @param {{now?: number}} [opts]
 * @returns {{section: string, label: string, value: string, tone: 'ok'|'bad'|'warn'|'muted'|'plain', source?: string, fetched_at?: string, untrusted?: boolean}[]}
 */
export function evidenceRows(detail, { now = Date.now() } = {}) {
  const rec = detail.record
  const facts = rec.facts
  /** @type {any[]} */
  const rows = []
  const row = (/** @type {string} */ section, /** @type {string} */ label, /** @type {string} */ value, /** @type {string} */ tone = 'plain', /** @type {any} */ f = null, /** @type {boolean} */ untrusted = false) =>
    rows.push({ section, label, value, tone, ...(f ? { source: f.source, fetched_at: f.fetched_at } : {}), ...(untrusted ? { untrusted: true } : {}) })
  const unknownRow = (/** @type {string} */ section, /** @type {string} */ label, /** @type {any} */ f, /** @type {string} */ why = '') => row(section, label, `unknown${why ? ` (${sanitizeRaw(why)})` : ''}`, 'warn', f)

  // Revision and freshness first: everything below is true of this head at this time.
  const fr = freshness(rec.fetched_at, now)
  const head = detail.head
  row('Revision', 'head', head.current ? `${short(head.current)} on ${word(rec.context.base.value)}` : 'unknown', head.current ? 'plain' : 'warn', rec.context.head)
  if (head.state === 'stale') row('Revision', 'changed', `head moved since you opened this: ${short(head.inspected)} -> ${short(head.current)}. Read the evidence again; earlier reading no longer applies`, 'bad')
  else if (head.state === 'unknown') row('Revision', 'inspected', 'cannot compare: a head is unknown', 'warn')
  else row('Revision', 'inspected', 'same head as when you opened this', 'ok')
  row('Revision', 'read', `${fr.age_ms == null ? 'time unknown' : `${Math.round(fr.age_ms / 1000)}s ago`}${fr.stale ? ', STALE: refresh before relying on it' : ''}`, fr.stale ? 'warn' : 'plain', { source: rec.identity.account === UNKNOWN ? 'github.graphql' : `github.graphql as ${sanitize(rec.identity.account)}`, fetched_at: rec.fetched_at })

  for (const a of rec.attention) row('Attention', a.code, `from ${a.fact}${a.detail ? `: ${a.detail}` : ''}`, ['ci_failing', 'merge_conflict', 'changes_requested', 'stale_approval'].includes(a.code) ? 'bad' : 'warn', { source: a.source, fetched_at: rec.fetched_at })
  if (rec.attention.length === 0) row('Attention', 'none', 'no attention reason from the facts below', 'muted')

  const checks = facts.checks.value
  if (isUnknown(facts.checks) || checks.state === UNKNOWN) unknownRow('Checks', 'checks', facts.checks)
  else {
    const lower = checks.truncated ? ' (lower bound: more checks exist than were read)' : ''
    row('Checks', 'rollup', `${word(checks.state)}: ${checks.passed} passed, ${checks.failed} failed, ${checks.pending} pending of ${checks.total}${lower}`, checks.failed > 0 ? 'bad' : checks.pending > 0 ? 'warn' : 'ok', facts.checks)
  }
  const req = detail.required_checks
  if (isUnknown(req)) unknownRow('Checks', 'required', req, detail.errors.find((/** @type {any} */ e) => e.part === 'required_checks')?.message || 'not read')
  else {
    const v = req.value
    const stale = v.head !== UNKNOWN && head.current && v.head !== head.current
    row('Checks', 'required', `${v.required} required: ${v.passing} passing, ${v.failing} failing, ${v.pending} pending. A required check that has not reported is not visible here${v.truncated ? '; only the first checks were read' : ''}${stale ? '; read at an earlier head' : ''}`, v.failing > 0 ? 'bad' : v.pending > 0 || stale ? 'warn' : 'ok', req)
  }

  const reviews = facts.reviews.value
  row('Review', 'decision', word(facts.review_decision.value), facts.review_decision.value === 'APPROVED' ? 'ok' : facts.review_decision.value === UNKNOWN ? 'warn' : 'plain', facts.review_decision)
  if (isUnknown(facts.reviews) || reviews.approvals === UNKNOWN) unknownRow('Review', 'reviews', facts.reviews)
  else {
    row('Review', 'approvals', `${plural(reviews.approvals, 'approval', 'approvals')}${reviews.staleApprovals > 0 ? `, ${reviews.staleApprovals} given on an earlier head (stale)` : ''}, ${reviews.changesRequested} requesting changes${reviews.truncated ? ' (lower bound: more reviews exist)' : ''}`, reviews.staleApprovals > 0 || reviews.changesRequested > 0 ? 'warn' : 'ok', facts.reviews)
    if (reviews.mine !== undefined) row('Review', 'you', reviews.mine === UNKNOWN ? 'unknown' : word(reviews.mine).toLowerCase().replace('_', ' '), 'plain', facts.reviews)
  }
  const requests = facts.review_requests.value
  if (isUnknown(facts.review_requests) || requests.via === UNKNOWN) unknownRow('Review', 'requested of you', facts.review_requests)
  else row('Review', 'requested of you', requests.via === 'team_unverified' ? `via a team (${requests.teams.map((/** @type {string} */ s) => sanitize(s)).join(', ')}); GitHub does not say which of your teams matched` : requests.via, 'plain', facts.review_requests)
  const threads = facts.unresolved_threads.value
  if (isUnknown(facts.unresolved_threads) || threads.unresolved === UNKNOWN) unknownRow('Review', 'threads', facts.unresolved_threads)
  else row('Review', 'threads', `${threads.unresolved} unresolved${threads.truncated ? ' (lower bound)' : ''} of ${threads.total}`, threads.unresolved > 0 ? 'warn' : 'ok', facts.unresolved_threads)

  row('Merge', 'mergeable', word(facts.mergeable.value), facts.mergeable.value === 'MERGEABLE' ? 'ok' : facts.mergeable.value === 'CONFLICTING' ? 'bad' : 'warn', facts.mergeable)
  row('Merge', 'draft', facts.is_draft.value === UNKNOWN ? 'unknown' : word(facts.is_draft.value), facts.is_draft.value === true ? 'warn' : 'plain', facts.is_draft)

  const files = detail.files
  if (isUnknown(files)) unknownRow('Files', 'files', files, detail.errors.find((/** @type {any} */ e) => e.part === 'files')?.message || 'not read')
  else {
    const v = files.value
    const byKind = /** @type {Record<string, number>} */ ({})
    for (const f of v.items) byKind[f.kind] = (byKind[f.kind] || 0) + 1
    const adds = v.items.reduce((/** @type {number} */ s, /** @type {any} */ f) => s + f.additions, 0)
    const dels = v.items.reduce((/** @type {number} */ s, /** @type {any} */ f) => s + f.deletions, 0)
    row('Files', 'changed', `${plural(v.total, 'file', 'files')}${v.truncated ? `; the first ${v.returned} are listed, the rest are in the diff (d)` : ''}  +${adds} -${dels}`, v.truncated ? 'warn' : 'plain', files)
    row('Files', 'by path', Object.entries(byKind).map(([k, c]) => `${word(k)} ${c}`).join(', ') || 'none', 'plain', files)
    if (v.head !== UNKNOWN && head.current && v.head !== head.current) row('Files', 'note', 'files were read at an earlier head than the record above; refresh', 'warn', files)
    for (const o of fileObservations(v.items)) {
      row('Files', o.code, o.paths.length ? `${o.paths.slice(0, 3).map(sanitizePath).join(', ')}${o.paths.length > 3 ? ` and ${o.paths.length - 3} more` : ''}${v.truncated ? ' (among the files read)' : ''}` : `none of the ${v.returned} files read${v.truncated ? ' (more files exist)' : ''}`, o.code === 'no_test_files_changed' ? 'muted' : 'warn', files)
    }
    for (const f of v.items) row('File', word(f.change_type).toLowerCase(), `+${f.additions} -${f.deletions}  ${sanitizePath(f.path)}`, 'plain')
  }

  // Author-written prose last and labelled: never an input to anything above.
  row('Written by the author (unverified)', 'actor', `${sanitize(rec.actor.login)} (${sanitize(rec.actor.github_type)}); attribution unverified`, 'muted', null, true)
  row('Written by the author (unverified)', 'title', `${sanitize(rec.untrusted.title)}${rec.untrusted.title_truncated ? ' ...(cut)' : ''}`, 'plain', null, true)
  const body = rec.untrusted.body
  row('Written by the author (unverified)', 'description', body === UNKNOWN ? 'unknown' : `${sanitize(String(body).split('\n')[0] || '(empty)')}${rec.untrusted.body_truncated ? ' ...(cut)' : ''}`, 'plain', null, true)
  for (const t of rec.untrusted.threads) row('Written by the author (unverified)', `${sanitizePath(t.path)} ${sanitize(t.author)}`, `${sanitize(t.excerpt)}${t.truncated ? ' ...(cut)' : ''}`, 'plain', null, true)
  for (const e of detail.errors) row('Not read', word(e.part), sanitizeRaw(e.message), 'warn')
  return rows
}
