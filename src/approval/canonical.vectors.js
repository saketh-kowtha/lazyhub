/**
 * Test vectors for the restricted JCS canonical form and request hash
 * (docs/design/optional-approval.md section 4.3). Data only: no logic.
 */

/** Vector 1: a complete, valid canonical request. */
export const VECTOR_1_REQUEST = {
  schema: 'lazyhub.approval/1',
  host: 'github.com',
  repo: { node_id: 'R_kgDOExample01', name_with_owner: 'octo-org/sandbox' },
  pr: { node_id: 'PR_kwDOExample0001', number: 42 },
  base: { ref: 'main', sha: '1111111111111111111111111111111111111111' },
  head: { ref: 'feature/x', sha: '2222222222222222222222222222222222222222', repo_node_id: 'R_kgDOExample01' },
  operation: 'merge',
  policy_version: 'lazyhub-approval-policy/1',
  evidence: { schema_version: 1, digest: '3333333333333333333333333333333333333333333333333333333333333333', observed_at: '2026-11-07T12:00:00.000Z' },
  coverage_class: 'advisory',
  approver: { host: 'github.com', login: 'octocat', node_id: 'U_kgDOExample', auth_method: 'gh_session_tty' },
  origin: { declared_kind: 'unknown', label: '', verified: false },
  issued_at: '2026-11-07T12:00:00.000Z',
  expires_at: '2026-11-07T20:00:00.000Z',
  nonce: '00112233445566778899aabbccddeeff',
}

export const VECTOR_1_CANONICAL = '{"approver":{"auth_method":"gh_session_tty","host":"github.com","login":"octocat","node_id":"U_kgDOExample"},"base":{"ref":"main","sha":"1111111111111111111111111111111111111111"},"coverage_class":"advisory","evidence":{"digest":"3333333333333333333333333333333333333333333333333333333333333333","observed_at":"2026-11-07T12:00:00.000Z","schema_version":1},"expires_at":"2026-11-07T20:00:00.000Z","head":{"ref":"feature/x","repo_node_id":"R_kgDOExample01","sha":"2222222222222222222222222222222222222222"},"host":"github.com","issued_at":"2026-11-07T12:00:00.000Z","nonce":"00112233445566778899aabbccddeeff","operation":"merge","origin":{"declared_kind":"unknown","label":"","verified":false},"policy_version":"lazyhub-approval-policy/1","pr":{"node_id":"PR_kwDOExample0001","number":42},"repo":{"name_with_owner":"octo-org/sandbox","node_id":"R_kgDOExample01"},"schema":"lazyhub.approval/1"}'

export const VECTOR_1_HASH = 'ec07fe13d7b42bb4f75b98e549154896598cf43c7382b60c66368aa23e82fa70'
export const VECTOR_1_REQUEST_ID = 'lzap1_ec07fe13d7b42bb4f75b98e549154896598cf43c7382b60c66368aa23e82fa70'

/** Key-order vector: UTF-16 code unit order, uppercase before lowercase. */
export const KEY_ORDER_INPUT = { b: '\u00E9', a: 'x', B: 1 }
export const KEY_ORDER_CANONICAL = '{"B":1,"a":"x","b":"\u00E9"}'
