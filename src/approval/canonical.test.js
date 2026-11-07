import { describe, expect, it } from 'vitest'
import { canonicalize, hashRequest, requestIdFor, validateRequest } from './canonical.js'
import {
  KEY_ORDER_CANONICAL, KEY_ORDER_INPUT, VECTOR_1_CANONICAL, VECTOR_1_HASH, VECTOR_1_REQUEST, VECTOR_1_REQUEST_ID,
} from './canonical.vectors.js'

const clone = value => JSON.parse(JSON.stringify(value))
const withChange = (path, value) => {
  const req = clone(VECTOR_1_REQUEST)
  const keys = path.split('.')
  let node = req
  for (const key of keys.slice(0, -1)) node = node[key]
  node[keys[keys.length - 1]] = value
  return req
}
const invalid = expect.objectContaining({ code: 'ERR_APPROVAL_INVALID_INPUT' })

describe('canonical form (restricted JCS)', () => {
  it('reproduces vector 1: canonical string, hash and request ID', () => {
    expect(canonicalize(VECTOR_1_REQUEST)).toBe(VECTOR_1_CANONICAL)
    expect(hashRequest(VECTOR_1_REQUEST)).toBe(VECTOR_1_HASH)
    expect(requestIdFor(VECTOR_1_HASH)).toBe(VECTOR_1_REQUEST_ID)
    expect(VECTOR_1_REQUEST_ID).toHaveLength(70)
  })

  it('sorts keys by UTF-16 code unit', () => {
    expect(canonicalize(KEY_ORDER_INPUT)).toBe(KEY_ORDER_CANONICAL)
    expect(canonicalize({ '～': 2, '\u{1F600}': 1 })).toBe('{"\u{1F600}":1,"～":2}')
  })

  it.each([
    ['null', { a: null }],
    ['undefined', { a: undefined }],
    ['float', { a: 1.5 }],
    ['NaN', { a: NaN }],
    ['unsafe integer', { a: 2 ** 53 }],
    ['negative zero', { a: -0 }],
    ['array', { a: [1] }],
    ['non-plain object', { a: new Date(0) }],
    ['function', { a: () => 1 }],
    ['bigint', { a: 1n }],
  ])('rejects %s with ERR_APPROVAL_INVALID_INPUT', (_name, value) => {
    expect(() => canonicalize(value)).toThrow(invalid)
  })

  it('accepts booleans and safe integers', () => {
    expect(canonicalize({ t: true, f: false, n: -7 })).toBe('{"f":false,"n":-7,"t":true}')
  })
})

describe('validateRequest', () => {
  it('accepts vector 1', () => {
    expect(() => validateRequest(VECTOR_1_REQUEST)).not.toThrow()
  })

  it.each([
    ['non-NFC ref', 'head.ref', 'café'],
    ['bidi override in ref', 'head.ref', 'feature/‮doc'],
    ['zero-width in ref', 'base.ref', 'ma​in'],
    ['tag character in ref', 'base.ref', 'main\u{E0041}'],
    ['control character in ref', 'head.ref', 'a\u0007b'],
    ['empty ref', 'head.ref', ''],
    ['refs/heads/ prefix', 'head.ref', 'refs/heads/x'],
    ['uppercase SHA', 'head.sha', 'ABCDEFABCDEFABCDEFABCDEFABCDEFABCDEFABCD'],
    ['short SHA', 'base.sha', 'abc123'],
    ['non-ISO timestamp', 'issued_at', '2026-11-07 12:00:00'],
    ['timestamp without milliseconds', 'expires_at', '2026-11-07T20:00:00Z'],
    ['uppercase host', 'host', 'GitHub.com'],
    ['bad node id', 'pr.node_id', 'has space'],
    ['float pr number', 'pr.number', 1.5],
    ['zero pr number', 'pr.number', 0],
    ['uppercase nonce', 'nonce', '00112233445566778899AABBCCDDEEFF'],
    ['bad coverage class', 'coverage_class', 'protected'],
    ['bad origin kind', 'origin.declared_kind', 'robot'],
    ['verified origin', 'origin.verified', true],
    ['non-ASCII origin label', 'origin.label', 'café'],
    ['long origin label', 'origin.label', 'x'.repeat(65)],
    ['other auth method', 'approver.auth_method', 'token'],
  ])('rejects %s', (_name, path, value) => {
    expect(() => validateRequest(withChange(path, value))).toThrow(invalid)
  })

  it('names the offending field in changed', () => {
    let caught
    try { validateRequest(withChange('head.sha', 'ZZ')) } catch (err) { caught = err }
    expect(caught.code).toBe('ERR_APPROVAL_INVALID_INPUT')
    expect(caught.changed).toEqual(['head.sha'])
  })

  it('rejects unknown and missing fields', () => {
    expect(() => validateRequest({ ...clone(VECTOR_1_REQUEST), extra: 'x' })).toThrow(invalid)
    const missing = clone(VECTOR_1_REQUEST)
    delete missing.nonce
    expect(() => validateRequest(missing)).toThrow(invalid)
  })

  it('refuses non-merge operations and forks as unsupported', () => {
    const unsupported = expect.objectContaining({ code: 'ERR_APPROVAL_UNSUPPORTED' })
    expect(() => validateRequest(withChange('operation', 'close'))).toThrow(unsupported)
    expect(() => validateRequest(withChange('head.repo_node_id', 'R_kgDOFork0002'))).toThrow(unsupported)
  })
})

describe('request hash binds every field', () => {
  const FIELDS = {
    host: 'github.example.com',
    'repo.node_id': 'R_kgDOExample99',
    'repo.name_with_owner': 'octo-org/renamed',
    'pr.node_id': 'PR_kwDOExample9999',
    'pr.number': 43,
    'base.ref': 'release',
    'base.sha': '4444444444444444444444444444444444444444',
    'head.ref': 'feature/y',
    'head.sha': '5555555555555555555555555555555555555555',
    policy_version: 'lazyhub-approval-policy/2',
    'evidence.schema_version': 2,
    'evidence.digest': '6666666666666666666666666666666666666666666666666666666666666666',
    'evidence.observed_at': '2026-11-07T12:00:00.001Z',
    coverage_class: 'managed_gateway',
    'approver.host': 'github.example.com',
    'approver.login': 'other',
    'approver.node_id': 'U_kgDOOther',
    'origin.declared_kind': 'agent',
    'origin.label': 'tool',
    issued_at: '2026-11-07T12:00:00.001Z',
    expires_at: '2026-11-07T20:00:00.001Z',
    nonce: 'ffeeddccbbaa99887766554433221100',
  }
  const CONSTANTS = ['schema', 'operation', 'head.repo_node_id', 'approver.auth_method', 'origin.verified']

  it('covers every leaf of vector 1 except the constants', () => {
    const leaves = []
    const walk = (node, prefix) => {
      for (const [key, value] of Object.entries(node)) {
        const path = prefix ? `${prefix}.${key}` : key
        if (value && typeof value === 'object') walk(value, path)
        else leaves.push(path)
      }
    }
    walk(VECTOR_1_REQUEST, '')
    expect(leaves.filter(p => !CONSTANTS.includes(p) && !(p in FIELDS))).toEqual([])
  })

  it.each(Object.entries(FIELDS))('changing %s changes the hash', (path, value) => {
    const changed = withChange(path, value)
    if (path === 'repo.node_id') changed.head.repo_node_id = value // forks are unsupported, so both move together
    expect(hashRequest(changed)).not.toBe(VECTOR_1_HASH)
    expect(requestIdFor(hashRequest(changed))).not.toBe(VECTOR_1_REQUEST_ID)
  })

  it('does not depend on property insertion order', () => {
    const reversed = Object.fromEntries(Object.entries(clone(VECTOR_1_REQUEST)).reverse())
    expect(hashRequest(reversed)).toBe(VECTOR_1_HASH)
  })
})
