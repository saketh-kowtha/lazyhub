import { describe, expect, it } from 'vitest'
import { contextFooterHints, contextHelpRows } from './actions.js'

describe('why-red hint (#359)', () => {
  it('footer shows f only for a PR with failing checks, last so back is never pushed off', () => {
    const none = contextFooterHints('prs', 'detail', { hasChecks: true, hasFailingChecks: false })
    expect(none.some(h => h.id === 'pr.why-red')).toBe(false)
    const failing = contextFooterHints('prs', 'detail', { hasChecks: true, hasFailingChecks: true })
    const ids = failing.map(h => h.id)
    expect(failing.find(h => h.id === 'pr.why-red')).toMatchObject({ key: 'f', label: 'why red' })
    expect(ids.indexOf('app.back')).toBeLessThan(ids.indexOf('pr.why-red'))
  })

  it('help lists f in PR detail when checks are red, and not in the PR list', () => {
    expect(contextHelpRows('prs', 'detail', { hasFailingChecks: true }).some(r => r.id === 'pr.why-red' && r.key === 'f')).toBe(true)
    expect(contextHelpRows('prs', 'list', {}).some(r => r.id === 'pr.why-red')).toBe(false)
  })
})
