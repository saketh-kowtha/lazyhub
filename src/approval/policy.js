/**
 * approval/policy.js - the fixed approval policy constant (docs/design/optional-approval.md 1.5).
 *
 * Replaces the general policy engine for the optional-approval stage. Changing
 * any value here must bump APPROVAL_POLICY_VERSION, which invalidates existing
 * records. No config key can change these values; a future config may only
 * lower the maximum lifetime.
 */

import { EVIDENCE_SCHEMA_VERSION } from '../executor/evidence.js'

export const APPROVAL_POLICY_VERSION = 'lazyhub-approval-policy/1'
/** The only operation a human may approve. */
export const APPROVABLE_OPERATIONS = Object.freeze(['merge'])
export const TTL_DEFAULT_MIN = 240
export const TTL_MIN_MIN = 5
export const TTL_MAX_MIN = 1440
/** Facts may be read at most this long before the decision. */
export const FRESHNESS_MAX_MS = 300_000
/** A timestamp may be at most this far ahead of the local clock. */
export const CLOCK_SKEW_MAX_MS = 300_000

/**
 * The versions a record is verified against. Always read from code, never from
 * the caller.
 * @returns {{ policy: string, evidence: number }}
 */
export function getPolicyVersions() {
  return { policy: APPROVAL_POLICY_VERSION, evidence: EVIDENCE_SCHEMA_VERSION }
}
