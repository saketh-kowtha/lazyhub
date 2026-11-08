import { describe, it, expect } from 'vitest'
import { smartEnterTarget } from './smart-enter.js'

const open = { state: 'OPEN', mergeable: 'MERGEABLE', checkSummary: { total: 2, failing: 0, pending: 0 } }

describe('smartEnterTarget (#314)', () => {
  it('goes to the failed check log when CI fails, before anything else', () => {
    const r = smartEnterTarget({ ...open, checkSummary: { total: 2, failing: 1 }, mergeable: 'CONFLICTING' }, { scope: 'reviewing' })
    expect(r.target).toBe('checks-log')
    expect(r.reason).toMatch(/CI failing/)
  })
  it('reads failures from a full check list when the row has no summary', () => {
    expect(smartEnterTarget({ state: 'OPEN', statusCheckRollup: [{ conclusion: 'FAILURE' }] }).target).toBe('checks-log')
  })
  it('goes to Files changed when a review is requested of you (reviewing scope)', () => {
    expect(smartEnterTarget(open, { scope: 'reviewing' })).toEqual({ target: 'files', reason: expect.stringMatching(/review requested/) })
  })
  it('does not claim a review request in other scopes', () => {
    expect(smartEnterTarget({ ...open, reviewRequests: [{ login: 'someone' }] }, { scope: 'all' }).target).toBe('conversation')
  })
  it('goes to the conflict summary for conflicts', () => {
    expect(smartEnterTarget({ ...open, mergeable: 'CONFLICTING' }, { scope: 'own' }).target).toBe('conflict')
  })
  it('opens Conversation otherwise, with no reason', () => {
    expect(smartEnterTarget(open, { scope: 'own' })).toEqual({ target: 'conversation', reason: '' })
  })
  it('never redirects closed, merged or draft-review rows, or when turned off', () => {
    expect(smartEnterTarget({ ...open, state: 'MERGED', checkSummary: { failing: 3 } }).target).toBe('conversation')
    expect(smartEnterTarget({ ...open, isDraft: true }, { scope: 'reviewing' }).target).toBe('conversation')
    expect(smartEnterTarget({ ...open, checkSummary: { failing: 1 } }, { enabled: false }).target).toBe('conversation')
  })
})
