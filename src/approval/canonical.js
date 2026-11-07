/**
 * approval/canonical.js - restricted JCS (RFC 8785) canonical form, request
 * validation and hashing (docs/design/optional-approval.md 4.3).
 *
 * Permitted values are plain objects, strings, safe integers and booleans.
 * Keys sort by UTF-16 code unit and strings and keys serialize with
 * JSON.stringify, which equals RFC 8785 for exactly these value types.
 * The hash input is the UTF-8 encoding of a domain prefix, a newline and the
 * canonical string. Pure and offline.
 */

import { createHash } from 'node:crypto'
import { approvalError } from './errors.js'
import { APPROVABLE_OPERATIONS } from './policy.js'

export const REQUEST_SCHEMA = 'lazyhub.approval/1'
const REQUEST_DOMAIN = `${REQUEST_SCHEMA}\n`
const ID_PREFIX = 'lzap1_'

/**
 * Canonical string of a value in the restricted profile.
 * @param {unknown} value
 * @returns {string}
 */
export function canonicalize(value) {
  return canon(value, '')
}

function canon(value, path) {
  switch (typeof value) {
    case 'string': return JSON.stringify(value)
    case 'boolean': return value ? 'true' : 'false'
    case 'number':
      if (!Number.isSafeInteger(value) || Object.is(value, -0)) throw approvalError('ERR_APPROVAL_INVALID_INPUT', [path || '(value)'])
      return String(value)
    case 'object': {
      if (value === null || Array.isArray(value)) throw approvalError('ERR_APPROVAL_INVALID_INPUT', [path || '(value)'])
      const proto = Object.getPrototypeOf(value)
      if ((proto !== Object.prototype && proto !== null) || Object.getOwnPropertySymbols(value).length > 0) {
        throw approvalError('ERR_APPROVAL_INVALID_INPUT', [path || '(value)'])
      }
      const parts = Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canon(value[key], path ? `${path}.${key}` : key)}`)
      return `{${parts.join(',')}}`
    }
    default:
      throw approvalError('ERR_APPROVAL_INVALID_INPUT', [path || '(value)'])
  }
}

/**
 * SHA-256 (lowercase hex) over a domain prefix, a newline and the canonical form of `value`.
 * @param {string} domain
 * @param {unknown} value
 * @returns {string}
 */
export function hashDomain(domain, value) {
  return createHash('sha256').update(`${domain}\n${canonicalize(value)}`, 'utf8').digest('hex')
}

// --- field validation --------------------------------------------------------

const HOST_RE = /^[a-z0-9.-]+(:[0-9]{1,5})?$/
const NODE_RE = /^[A-Za-z0-9_=-]{1,100}$/
const SHA_RE = /^([0-9a-f]{40}|[0-9a-f]{64})$/
const HEX64_RE = /^[0-9a-f]{64}$/
const NONCE_RE = /^[0-9a-f]{32}$/
const NWO_RE = /^[A-Za-z0-9._-]{1,100}\/[A-Za-z0-9._-]{1,100}$/
const LOGIN_RE = /^[A-Za-z0-9._[\]-]{1,100}$/
const POLICY_RE = /^lazyhub-approval-policy\/[0-9]{1,6}$/
const OPERATION_RE = /^[a-z_]{1,32}$/
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/
// C0/C1 controls, DEL, bidi controls, zero-width and invisible characters, tag characters.
// eslint-disable-next-line no-control-regex
const FORBIDDEN_REF_RE = /[\u0000-\u001f\u007f-\u009f\u00AD\u061C\u180E\u200B-\u200F\u202A-\u202E\u2060\u2066-\u2069\uFEFF\u{e0000}-\u{e007f}]/u
const COVERAGE_CLASSES = ['github_enforced', 'managed_gateway', 'advisory', 'ungoverned']
const ORIGIN_KINDS = ['human', 'agent', 'unknown']

const isString = v => typeof v === 'string'
const re = rx => v => isString(v) && rx.test(v)
const oneOf = list => v => isString(v) && list.includes(v)
const isPositiveInt = v => Number.isSafeInteger(v) && v > 0
const isRef = v => isString(v) && v.length >= 1 && v.length <= 255 && v.normalize('NFC') === v
  && !FORBIDDEN_REF_RE.test(v) && !v.startsWith('refs/heads/')
const isIso = v => isString(v) && ISO_RE.test(v) && !Number.isNaN(Date.parse(v)) && new Date(v).toISOString() === v
// eslint-disable-next-line no-control-regex
const isPrintableAscii = v => isString(v) && v.length <= 64 && /^[\x20-\x7e]*$/.test(v)

// Leaf validators by field; nested objects mirror the request layout.
const APPROVER_SPEC = {
  host: re(HOST_RE),
  login: re(LOGIN_RE),
  node_id: re(NODE_RE),
  auth_method: v => v === 'gh_session_tty',
}
const REQUEST_SPEC = {
  schema: v => v === REQUEST_SCHEMA,
  host: re(HOST_RE),
  repo: { node_id: re(NODE_RE), name_with_owner: re(NWO_RE) },
  pr: { node_id: re(NODE_RE), number: isPositiveInt },
  base: { ref: isRef, sha: re(SHA_RE) },
  head: { ref: isRef, sha: re(SHA_RE), repo_node_id: re(NODE_RE) },
  operation: re(OPERATION_RE),
  policy_version: re(POLICY_RE),
  evidence: { schema_version: isPositiveInt, digest: re(HEX64_RE), observed_at: isIso },
  coverage_class: oneOf(COVERAGE_CLASSES),
  approver: APPROVER_SPEC,
  origin: { declared_kind: oneOf(ORIGIN_KINDS), label: isPrintableAscii, verified: v => v === false },
  issued_at: isIso,
  expires_at: isIso,
  nonce: re(NONCE_RE),
}

function isPlain(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const proto = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
}

// Paths that fail `spec`, in spec order; unknown keys are reported after the known ones.
function badPaths(value, spec, prefix, out) {
  if (!isPlain(value)) {
    out.push(prefix || '(request)')
    return
  }
  for (const [key, rule] of Object.entries(spec)) {
    const path = prefix ? `${prefix}.${key}` : key
    const v = value[key]
    if (typeof rule === 'function') {
      if (!Object.hasOwn(value, key) || !rule(v)) out.push(path)
    } else if (!Object.hasOwn(value, key)) out.push(path)
    else badPaths(v, rule, path, out)
  }
  for (const key of Object.keys(value)) {
    if (!Object.hasOwn(spec, key)) out.push(prefix ? `${prefix}.${key}` : key)
  }
}

/**
 * Check an approver object ({host, login, node_id, auth_method}).
 * @param {unknown} approver
 * @param {string} [field]
 * @returns {object} the approver, unchanged
 */
export function validateApprover(approver, field = 'approver') {
  const bad = []
  badPaths(approver, APPROVER_SPEC, field, bad)
  if (bad.length) throw approvalError('ERR_APPROVAL_INVALID_INPUT', bad)
  return approver
}

/**
 * Validate a canonical request: exact field set, exact formats. Throws
 * ERR_APPROVAL_INVALID_INPUT naming the fields, or ERR_APPROVAL_UNSUPPORTED
 * for a non-approvable operation or a head repository that differs from the
 * base repository (forks).
 * @param {unknown} request
 * @returns {object} the request, unchanged
 */
export function validateRequest(request) {
  const bad = []
  const req = /** @type {any} */ (request)
  badPaths(request, REQUEST_SPEC, '', bad)
  if (bad.length) throw approvalError('ERR_APPROVAL_INVALID_INPUT', bad)
  if (!APPROVABLE_OPERATIONS.includes(req.operation)) throw approvalError('ERR_APPROVAL_UNSUPPORTED', ['operation'])
  if (req.head.repo_node_id !== req.repo.node_id) throw approvalError('ERR_APPROVAL_UNSUPPORTED', ['head.repo_node_id'])
  return request
}

/**
 * Hex SHA-256 of a validated request under the request domain.
 * @param {unknown} request
 * @returns {string}
 */
export function hashRequest(request) {
  validateRequest(request)
  return createHash('sha256').update(REQUEST_DOMAIN + canonicalize(request), 'utf8').digest('hex')
}

/**
 * The request ID (also the check-run external_id) for a request hash.
 * @param {string} hash
 * @returns {string}
 */
export function requestIdFor(hash) {
  if (!HEX64_RE.test(hash)) throw approvalError('ERR_APPROVAL_INVALID_INPUT', ['request_hash'])
  return ID_PREFIX + hash
}

/**
 * True for a well-formed request ID.
 * @param {unknown} id
 * @returns {boolean}
 */
export function isRequestId(id) {
  return isString(id) && id.startsWith(ID_PREFIX) && HEX64_RE.test(id.slice(ID_PREFIX.length))
}

/**
 * Escape any character outside printable ASCII as \u{HEX} and cap at 64 characters.
 * @param {unknown} label
 * @returns {string}
 */
export function escapeOriginLabel(label) {
  let out = ''
  for (const ch of String(label ?? '')) {
    const cp = ch.codePointAt(0)
    out += cp >= 0x20 && cp <= 0x7e ? ch : `\\u{${cp.toString(16).toUpperCase()}}`
    if (out.length >= 64) break
  }
  return out.slice(0, 64)
}

/**
 * True for a timestamp in exactly the Date#toISOString() form.
 * @param {unknown} value
 * @returns {boolean}
 */
export function isIsoTimestamp(value) {
  return isIso(value)
}
