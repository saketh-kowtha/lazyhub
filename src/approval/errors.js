/**
 * approval/errors.js - the stable error catalog (docs/design/optional-approval.md 4.5).
 *
 * Codes never change once merged. Every entry has a fixed `message` and
 * `humanHint`; raw server or file text is never copied into either, so an
 * error can be shown to a user as is. `changed` names the fields involved.
 */

const entry = (category, retriable, message, humanHint) => Object.freeze({ category, retriable, message, humanHint })

/** Frozen catalog: code -> { category, retriable, message, humanHint }. */
export const APPROVAL_ERRORS = Object.freeze({
  ERR_APPROVAL_NOT_FOUND: entry('approval', false, 'Unknown approval request.', 'Check the request ID; it may belong to another store.'),
  ERR_APPROVAL_INVALID_INPUT: entry('approval', false, 'A field is missing, unknown or not in canonical form.', 'Nothing was recorded. Reload the pull request and try again.'),
  ERR_APPROVAL_UNSUPPORTED: entry('approval', false, 'This pull request or operation is not supported for approval.', 'Only same-repository pull requests and the merge operation are supported.'),
  ERR_APPROVAL_CONFLICT: entry('approval', false, 'An active approval already exists for this exact context.', 'Revoke the existing approval first.'),
  ERR_APPROVAL_EVIDENCE_STALE: entry('approval', true, 'The facts are older than five minutes.', 'Reload the facts, then decide again.'),
  ERR_APPROVAL_CLOCK: entry('approval', false, 'A timestamp is ahead of the local clock or out of order.', 'Check the system clock.'),
  ERR_APPROVAL_STALE_HEAD: entry('stale', false, 'The head branch or commit changed.', 'A new commit needs a new approval.'),
  ERR_APPROVAL_STALE_BASE: entry('stale', false, 'The base branch or commit changed.', 'A change to the base needs a new approval.'),
  ERR_APPROVAL_CONTEXT_MISMATCH: entry('stale', false, 'The host, repository or pull request differs.', 'The approval belongs to a different pull request.'),
  ERR_APPROVAL_POLICY_CHANGED: entry('stale', false, 'The approval policy version differs.', 'Approve again under the current policy.'),
  ERR_APPROVAL_EVIDENCE_CHANGED: entry('stale', false, 'The evidence schema version differs.', 'Approve again under the current evidence format.'),
  ERR_APPROVAL_APPROVER_CHANGED: entry('stale', false, 'The signed-in GitHub account differs from the approver.', 'Sign in as the approving account, or approve again.'),
  ERR_APPROVAL_EXPIRED: entry('stale', false, 'The approval has expired.', 'Approve again.'),
  ERR_APPROVAL_REVOKED: entry('stale', false, 'The approval was revoked.', 'Approve again if still wanted.'),
  ERR_APPROVAL_DENIED: entry('stale', false, 'The request was denied.', 'A denied request cannot be approved or revoked.'),
  ERR_APPROVAL_STORE_UNAVAILABLE: entry('store', true, 'The approval store cannot be read or written.', 'Check permissions on the approvals directory and try again.'),
  ERR_APPROVAL_STORE_CORRUPT: entry('store', false, 'The approval store failed its integrity check.', 'No approval can be made, changed or published. See "Recovery" in docs/design/optional-approval.md.'),
  ERR_APPROVAL_CREDENTIALS_MISSING: entry('publication', false, 'App credentials are missing.', 'Reserved for the check publisher.'),
  ERR_APPROVAL_PUBLISH_FAILED: entry('publication', true, 'GitHub was not updated.', 'Reserved for the check publisher.'),
  ERR_APPROVAL_PUBLISH_UNCERTAIN: entry('publication', false, 'It is unknown whether GitHub received the update.', 'Reserved for the check publisher; resolve by read-back only.'),
})

/** Error thrown by the approval module. */
export class ApprovalError extends Error {
  /**
   * @param {keyof typeof APPROVAL_ERRORS} code
   * @param {{ changed?: string[] }} [opts]
   */
  constructor(code, { changed = [] } = {}) {
    const info = APPROVAL_ERRORS[code]
    if (!info) throw new TypeError(`unknown approval error code: ${code}`)
    super(info.message)
    this.name = 'ApprovalError'
    this.code = code
    this.category = info.category
    this.retriable = info.retriable
    this.humanHint = info.humanHint
    this.changed = [...changed]
  }
}

/**
 * Build an ApprovalError.
 * @param {keyof typeof APPROVAL_ERRORS} code
 * @param {string[]} [changed]
 */
export function approvalError(code, changed = []) {
  return new ApprovalError(code, { changed })
}
