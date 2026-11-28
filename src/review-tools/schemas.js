/**
 * src/review-tools/schemas.js - the output contract of the review tools, `schema_version` 1
 * (#603, #627), as JSON Schema. docs/CONTRACT.md describes the same shapes in prose and
 * review-tools.test.js validates every tool's fixture output against them.
 *
 * Stability: a field listed here is never removed or retyped within schema_version 1. New
 * fields may be added (objects are open), so a client must ignore fields it does not know.
 */

const str = { type: 'string' }
const bool = { type: 'boolean' }
const int = { type: 'integer' }
const nullable = (/** @type {any} */ s) => ({ anyOf: [s, { type: 'null' }] })
const arr = (/** @type {any} */ items) => ({ type: 'array', items })
/**
 * @param {Record<string, any>} properties
 * @param {string[]} [required] defaults to every property
 */
const obj = (properties, required = Object.keys(properties)) => ({ type: 'object', properties, required })
/**
 * A value GitHub may not have returned: the value, or the string "unknown".
 * @param {any} s
 */
const orUnknown = (/** @type {any} */ s) => ({ anyOf: [s, { const: 'unknown' }] })

export const ENVELOPE_SCHEMA = obj({
  schema_version: { const: 1 },
  tool: str,
  repo: nullable(str),
  generated_at: str,
  complete: bool,
  notices: arr(str),
  untrusted: obj({ note: str, fields: arr(str) }),
  data: { type: 'object' },
})

export const ERROR_SCHEMA = obj({
  schema_version: { const: 1 },
  tool: nullable(str),
  error: obj({ code: str, message: str, kind: str, fix: str, hint: str }, ['code', 'message']),
})

const QUEUE_ITEM = obj({
  repo: str,
  number: int,
  url: nullable(str),
  group: str,
  because: str,
  why: str,
  reasons: arr(obj({ code: str, text: str, fact: str, source: str })),
  head: str,
  base: str,
  checks: { type: 'object' },
  review_decision: str,
  mergeable: str,
  is_draft: orUnknown(bool),
  updated_at: str,
  membership: arr(str),
  author: obj({ login: str, attribution: { const: 'unverified' } }),
  untrusted: obj({ title: str, title_truncated: bool }),
})

const TRUNCATION = obj({ total: orUnknown(int), returned: int, has_more: bool, next_cursor: nullable(str) })

const PAIR = obj({
  a: int,
  b: int,
  likely: bool,
  level: str,
  generated_only: bool,
  files: arr(obj({ path: str, kind: str, level: str, likely: bool, detail: str }, ['path', 'kind', 'likely', 'detail'])),
  generated: arr(str),
}, ['a', 'b', 'likely', 'generated_only', 'files', 'generated'])

const SCANNED_PR = obj({ number: int, base: str, is_draft: bool, url: nullable(str), author: str, untrusted: obj({ title: str }) })

/** `data` of each tool. */
export const DATA_SCHEMAS = {
  review_queue: obj({
    account: str,
    host: str,
    scope: { type: 'object' },
    order: str,
    groups: arr(obj({ id: str, label: str, count: int, items: arr(QUEUE_ITEM) })),
    truncation: obj({ review_requested: TRUNCATION, authored: TRUNCATION }),
    rate_limit: { anyOf: [{ type: 'object' }, { const: 'unknown' }] },
  }),
  pr_evidence: obj({
    evidence_version: int,
    record: obj({
      identity: obj({ host: str, repo: str, number: int, url: nullable(str), account: str }),
      context: { type: 'object' },
      facts: { type: 'object' },
      attention: arr(obj({ code: str, fact: str, source: str }, ['code', 'fact', 'source'])),
      group: obj({ group: str, because: str }),
      actor: obj({ login: str, attribution: { const: 'unverified' } }, ['login', 'attribution']),
      untrusted: obj({ title: str, body: str, body_truncated: bool, title_truncated: bool, threads: arr({ type: 'object' }) }),
    }, ['identity', 'context', 'facts', 'attention', 'group', 'actor', 'untrusted']),
    files: obj({ value: orUnknown({ type: 'object' }), source: str, fetched_at: str }),
    required_checks: obj({ value: orUnknown({ type: 'object' }), source: str, fetched_at: str }),
    head: obj({ state: { enum: ['current', 'stale', 'unknown'] }, inspected: nullable(str), current: nullable(str) }),
    errors: arr(obj({ part: str, message: str })),
    fetched_at: str,
  }),
  why_ci_red: obj({
    state: { enum: ['no-checks', 'pending', 'no-failures', 'ok'] },
    base_branch: str,
    total_failing: int,
    pending: int,
    not_analysed: int,
    checks: arr(obj({
      name: str,
      url: nullable(str),
      duration: nullable(str),
      failing_step: nullable(str),
      job: nullable(str),
      log: obj({ state: str, detail: str }),
      excerpt: nullable(obj({ kind: str, lines: arr(str), locations: arr(obj({ path: str, line: int, col: nullable(int) })), truncated: bool })),
      likely_changed_lines: nullable(obj({
        items: arr(obj({ path: str, line: int, fail_line: int, kind: { enum: ['changed', 'near', 'file', 'no-patch'] }, via: str, code: str })),
        unmatched: int,
        ambiguous: int,
        capped: bool,
      })),
      likely_changed_lines_note: nullable(str),
      base_branch: obj({ verdict: { enum: ['also-failing', 'possibly-flaky', 'passing', 'unknown'] }, text: str }),
    })),
  }),
  claims_check: obj({
    summary: obj({ verified: int, contradicted: int, unverifiable: int, total: int, line: str }),
    claims: arr(obj({
      id: str,
      type: str,
      status: { enum: ['verified', 'contradicted', 'unverifiable'] },
      reason: str,
      source: { enum: ['title', 'body'] },
      line: nullable(int),
      evidence: arr(obj({ path: nullable(str), line: nullable(int), text: nullable(str) })),
      untrusted: obj({ text: str }),
    })),
    files_read: int,
    files_truncated: bool,
  }),
  collisions: obj({
    number: nullable(int),
    depth: { enum: ['file', 'line'] },
    open: nullable(bool),
    pr: nullable(SCANNED_PR),
    collisions: arr({ ...PAIR, properties: { ...PAIR.properties, other: int }, required: [...PAIR.required, 'other'] }),
    repository: obj({
      clusters: arr(obj({ prs: arr(int), likely: bool, pairs: arr(PAIR) })),
      generated_files: arr(obj({ path: str, prs: arr(int) })),
      merge_order: arr(obj({ number: int, overlaps: int, size: int, serial_with: arr(int), affects: arr(int), reason: str })),
      independent: int,
    }),
    scanned: int,
    total_open: int,
    prs: arr(SCANNED_PR),
  }),
  review_story: obj({
    total_files: int,
    loaded_files: int,
    steps: arr(obj({
      index: int,
      kind: str,
      title: str,
      id: str,
      why: str,
      since_review: nullable(int),
      files: arr(obj({ path: str, additions: nullable(int), deletions: nullable(int), change_type: nullable(str), reason: str, since_review: bool })),
    })),
    since_review: obj({ status: { enum: ['none', 'unknown', 'same', 'files'] }, reason: str, reviewed_commit: nullable(str), head: nullable(str), changed_files: nullable(int), approximate: bool }),
  }),
}
