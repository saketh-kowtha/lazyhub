import { describe, expect, it } from 'vitest'
import { PUBLICATION_KINDS, PUBLICATION_RESULT_STATES, assertPublisher, assertPublisherResult } from './publisher.js'

const invalid = expect.objectContaining({ code: 'ERR_APPROVAL_INVALID_INPUT' })

describe('publisher contract (#203 codes against it, #244 implements it)', () => {
  it('names the kinds and result states from the design doc', () => {
    expect(PUBLICATION_KINDS).toEqual(['success', 'failure'])
    expect(PUBLICATION_RESULT_STATES).toEqual(['confirmed', 'failed', 'uncertain'])
  })

  it.each([
    [{ state: 'confirmed', checkRunUrl: 'https://github.com/o/r/runs/1' }],
    [{ state: 'confirmed' }],
    [{ state: 'failed', code: 'ERR_APPROVAL_PUBLISH_FAILED' }],
    [{ state: 'failed', code: 'ERR_APPROVAL_CREDENTIALS_MISSING' }],
    [{ state: 'uncertain', code: 'ERR_APPROVAL_PUBLISH_UNCERTAIN' }],
    [{ state: 'uncertain' }],
  ])('accepts %j', result => {
    expect(assertPublisherResult(result)).toBe(result)
  })

  it.each([
    ['null', null],
    ['unknown state', { state: 'attempted' }],
    ['missing state', {}],
    ['unknown field', { state: 'confirmed', token: 'x' }],
    ['non-https url', { state: 'confirmed', checkRunUrl: 'http://example.test/x' }],
    ['url on a failure', { state: 'failed', checkRunUrl: 'https://github.com/o/r/runs/1' }],
    ['long url', { state: 'confirmed', checkRunUrl: `https://github.com/${'a'.repeat(600)}` }],
    ['unknown code', { state: 'failed', code: 'ERR_SOMETHING' }],
    ['non-publication code', { state: 'failed', code: 'ERR_APPROVAL_EXPIRED' }],
    ['code on a confirmation', { state: 'confirmed', code: 'ERR_APPROVAL_PUBLISH_FAILED' }],
    ['mismatched code', { state: 'uncertain', code: 'ERR_APPROVAL_PUBLISH_FAILED' }],
  ])('rejects %s', (_name, result) => {
    expect(() => assertPublisherResult(result)).toThrow(invalid)
  })

  it('requires both functions on a publisher and builds no default one', () => {
    const fake = { publishApprovalCheck: async () => ({ state: 'confirmed' }), readBackApprovalCheck: async () => ({ state: 'failed' }) }
    expect(assertPublisher(fake)).toBe(fake)
    expect(() => assertPublisher({ publishApprovalCheck: async () => ({}) })).toThrow(invalid)
    expect(() => assertPublisher(null)).toThrow(invalid)
  })
})
