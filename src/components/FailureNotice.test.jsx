import { describe, it, expect, afterEach } from 'vitest'
import React from 'react'
import { Box } from 'ink'
import { cleanup } from 'ink-testing-library'
import { renderWithProviders } from '../test/test-helpers.jsx'
import { FailureNotice } from './FailureNotice.jsx'
import { EmptyState } from './EmptyState.jsx'
import { classifyGhFailure, classifyHostMismatch, classifyPartial } from '../executor/classify.js'
import { GhError } from '../executor/gh-error.js'
import { GH_STDERR } from '../executor/gh-stderr-fixtures.js'

afterEach(cleanup)

const errFor = name => {
  const f = GH_STDERR[name]
  const err = new GhError({ message: f.message || f.stderr.split('\n')[0], stderr: f.stderr, exitCode: f.exitCode, args: f.args })
  if (f.code) err.code = f.code
  return err
}
const frameOf = ui => {
  const { lastFrame } = renderWithProviders(<Box width={80}>{ui}</Box>)
  return lastFrame()
}
const notice = (name, ctx = {}) => frameOf(<FailureNotice failure={classifyGhFailure(errFor(name), { host: 'github.com', ...ctx })} />)
const fitsEighty = frame => frame.split('\n').every(line => line.length <= 80)

describe('FailureNotice at 80 columns', () => {
  const cases = [
    ['gh_missing', '✗', 'not installed'],
    ['gh_too_old', '✗', 'too old'],
    ['not_signed_in', '✗', 'gh auth login'],
    ['sso_rest', '⚠', 'organization acme has not authorized your gh token (SAML SSO)'],
    ['scope_graphql', '⚠', 'gh auth refresh -h github.com -s read:org'],
    ['rate_core', '◷', 'GitHub API rate limit reached: REST API'],
    ['rate_secondary', '◷', 'slow down'],
    ['repo_not_found_graphql', '✗', 'acme/legacy was not found, or your account cannot see it.'],
    ['offline', '⊘', 'Cannot reach api.github.com'],
  ]
  for (const [name, glyph, text] of cases) {
    it(`renders ${name}: glyph, cause and next step, no overflow`, () => {
      const frame = notice(name)
      expect(frame).toContain(glyph)
      expect(frame).toContain(text)
      expect(fitsEighty(frame)).toBe(true)
    })
  }

  it('wrong host shows both hosts and the login command', () => {
    const frame = frameOf(<FailureNotice failure={classifyHostMismatch({ needed: 'ghe.acme.io', signedIn: ['github.com'] })} />)
    expect(frame).toContain('gh is logged in to: github.com')
    expect(frame).toContain('gh auth login --hostname ghe.acme.io')
    expect(fitsEighty(frame)).toBe(true)
  })

  it('partial data lists each failed repository with its reason', () => {
    const p = classifyPartial([
      { repo: 'acme/billing', error: errFor('sso_rest') },
      { repo: 'acme/legacy', error: errFor('repo_not_found_rest') },
    ], 14, { host: 'github.com' })
    const failure = { ...classifyGhFailure(errFor('sso_rest')), tone: 'degraded', cause: p.cause, notes: [], fix: null, fixHint: null }
    const frame = frameOf(<FailureNotice failure={failure} failedRepos={p.failed} />)
    expect(frame).toContain('2 repositories did not load')
    expect(frame).toContain('acme/billing  SAML SSO not authorized for acme')
    expect(frame).toContain('acme/legacy  not found, or you have no access')
    expect(fitsEighty(frame)).toBe(true)
  })

  it('never renders a one-time SSO URL', () => {
    expect(notice('sso_header_url')).not.toContain('authorization_request')
  })
})

describe('EmptyState at 80 columns', () => {
  it('teaches the next action as a key', () => {
    const frame = frameOf(<EmptyState title="No review requests · nothing needs you right now." checked="Checked 14 repositories on github.com." actions={[{ key: '/', label: 'search every PR in scope' }, { key: 's', label: 'change scope' }]} />)
    expect(frame).toContain('No review requests')
    expect(frame).toMatch(/\/\s+search every PR in scope/)
    expect(frame).toMatch(/s\s+change scope/)
    expect(fitsEighty(frame)).toBe(true)
  })

  it('sanitizes the title', () => {
    expect(frameOf(<EmptyState title={'No \u001b[31mPRs\u001b[0m match'} />)).toContain('No PRs match')
  })
})
