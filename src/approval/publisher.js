/**
 * approval/publisher.js — the interface #203 codes against (docs/design/optional-approval.md 1.6).
 *
 * Contract only. There is no implementation here and no default publisher:
 * until #244 lands, UI tests inject a fake object in-process, and no
 * environment variable or config switch selects one in a built binary.
 *
 *   publishApprovalCheck({ requestId, kind }) -> Promise<PublisherResult>
 *   readBackApprovalCheck({ requestId })      -> Promise<PublisherResult>
 *
 * `kind` is `success` (from an approved record) or `failure` (denied, revoked
 * or expired). The result state is `confirmed`, `failed` (safe to publish
 * again) or `uncertain` (never resent; resolved by read-back only).
 */

import { approvalError } from './errors.js'

export const PUBLICATION_KINDS = Object.freeze(['success', 'failure'])
export const PUBLICATION_RESULT_STATES = Object.freeze(['confirmed', 'failed', 'uncertain'])

const CODES_BY_STATE = {
  confirmed: [],
  failed: ['ERR_APPROVAL_PUBLISH_FAILED', 'ERR_APPROVAL_CREDENTIALS_MISSING'],
  uncertain: ['ERR_APPROVAL_PUBLISH_UNCERTAIN'],
}
const URL_MAX = 500

/**
 * @typedef {object} PublisherResult
 * @property {'confirmed'|'failed'|'uncertain'} state
 * @property {string} [checkRunUrl] https URL, present only when confirmed
 * @property {string} [code] publication error code, present only when failed or uncertain
 */

/**
 * Check that a publisher result has exactly the contracted shape.
 * @param {unknown} result
 * @returns {PublisherResult} the same object
 */
export function assertPublisherResult(result) {
  const r = /** @type {any} */ (result)
  if (r === null || typeof r !== 'object' || Array.isArray(r)) throw approvalError('ERR_APPROVAL_INVALID_INPUT', ['result'])
  const bad = Object.keys(r).filter(k => !['state', 'checkRunUrl', 'code'].includes(k))
  if (!PUBLICATION_RESULT_STATES.includes(r.state)) bad.push('state')
  if (r.checkRunUrl !== undefined) {
    const ok = typeof r.checkRunUrl === 'string' && r.checkRunUrl.startsWith('https://') && r.checkRunUrl.length <= URL_MAX && r.state === 'confirmed'
    if (!ok) bad.push('checkRunUrl')
  }
  if (r.code !== undefined && !(CODES_BY_STATE[r.state] || []).includes(r.code)) bad.push('code')
  if (bad.length) throw approvalError('ERR_APPROVAL_INVALID_INPUT', bad)
  return r
}

/**
 * Check that an object provides both publisher functions.
 * @param {unknown} publisher
 * @returns {{ publishApprovalCheck: Function, readBackApprovalCheck: Function }} the same object
 */
export function assertPublisher(publisher) {
  const p = /** @type {any} */ (publisher)
  const bad = []
  for (const fn of ['publishApprovalCheck', 'readBackApprovalCheck']) if (typeof p?.[fn] !== 'function') bad.push(fn)
  if (bad.length) throw approvalError('ERR_APPROVAL_INVALID_INPUT', bad)
  return p
}
