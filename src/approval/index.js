/**
 * approval/index.js — barrel for the approval record module (groundwork).
 *
 * Nothing outside src/approval imports this barrel; src/approval/isolation.test.js
 * enforces that. See docs/design/optional-approval.md.
 */

export { canonicalize, hashRequest, requestIdFor, validateRequest } from './canonical.js'
export { APPROVAL_ERRORS, ApprovalError } from './errors.js'
export {
  APPROVABLE_OPERATIONS, APPROVAL_POLICY_VERSION, CLOCK_SKEW_MAX_MS, FRESHNESS_MAX_MS, TTL_DEFAULT_MIN, TTL_MAX_MIN, TTL_MIN_MIN,
} from './policy.js'
export { openApprovalStore } from './store.js'
