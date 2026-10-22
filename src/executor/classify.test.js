import { describe, it, expect } from 'vitest'
import { GhError } from './gh-error.js'
import { classifyGhFailure, classifyHostMismatch, classifyPartial, localTime, scrub } from './classify.js'
import { GH_STDERR } from './gh-stderr-fixtures.js'

const NOW = Date.parse('2026-10-22T14:26:00')

/**
 * Build the GhError runGh() would throw for a fixture.
 *
 * @param {string} name
 * @returns {GhError}
 */
function errFor(name) {
  const f = GH_STDERR[name]
  const err = new GhError({
    message: f.message || f.stderr.split('\n')[0],
    stderr: f.stderr,
    exitCode: f.exitCode,
    args: f.args,
  })
  if (f.code) err.code = f.code
  return err
}
const run = (name, ctx = {}) => classifyGhFailure(errFor(name), { now: NOW, ...ctx })

describe('classifyGhFailure: one case per day-one failure', () => {
  it('gh missing', () => {
    const f = run('gh_missing')
    expect(f.kind).toBe('gh_missing')
    expect(f.cause).toMatch(/not installed/)
    expect(f.fixHint).toMatch(/cli\.github\.com/)
  })

  it('gh too old, from unknown flag or JSON field', () => {
    expect(run('gh_too_old').kind).toBe('gh_too_old')
    expect(run('gh_too_old_flag').kind).toBe('gh_too_old')
  })

  it('not signed in names the exact login command', () => {
    for (const name of ['not_signed_in', 'not_signed_in_http401']) {
      const f = run(name, { host: 'github.com' })
      expect(f.kind).toBe('not_signed_in')
      expect(f.fix).toBe('gh auth login')
    }
  })

  it('not signed in to a GHES host carries --hostname for that host', () => {
    const f = run('not_signed_in_ghes')
    expect(f.fix).toBe('gh auth login --hostname ghe.acme.io')
    expect(f.subject.host).toBe('ghe.acme.io')
  })

  it('wrong host reuses the selectGhHost wording', () => {
    const f = classifyHostMismatch({ needed: 'ghe.acme.io', signedIn: ['github.com'] })
    expect(f.kind).toBe('wrong_host')
    expect(f.cause).toBe('The git remote points at ghe.acme.io, but gh is not logged in to it.')
    expect(f.notes[0]).toBe('gh is logged in to: github.com')
    expect(f.fix).toBe('gh auth login --hostname ghe.acme.io')
  })

  it('SAML SSO names the org (from REST path, GraphQL variables, or the SSO header)', () => {
    for (const name of ['sso_rest', 'sso_graphql', 'sso_header_url']) {
      const f = run(name, { host: 'github.com' })
      expect(f.kind).toBe('sso')
      expect(f.subject.org).toBe('acme')
      expect(f.cause).toContain('acme')
      expect(f.fix).toBe('gh auth refresh -h github.com')
      expect(f.fixHint).toContain('Authorize')
    }
  })

  it('never prints the one-time SSO authorization URL or its token', () => {
    const shown = JSON.stringify(run('sso_header_url'))
    expect(shown).not.toContain('authorization_request')
    expect(shown).not.toContain('A1B2C3D4E5F6A7B8C9')
  })

  it('missing scope names the scope', () => {
    const graphql = run('scope_graphql', { host: 'github.com' })
    expect(graphql.kind).toBe('scope')
    expect(graphql.subject.scope).toBe('read:org')
    expect(graphql.fix).toBe('gh auth refresh -h github.com -s read:org')
    expect(run('scope_gh_refresh').subject.scope).toBe('read:org')
  })

  it('missing scope without a named scope still says so and points at gh auth status', () => {
    const f = run('scope_unnamed')
    expect(f.kind).toBe('scope')
    expect(f.subject.scope).toBeUndefined()
    expect(f.fix).toBe('gh auth status')
  })

  it('rate limit names the limit family and the local reset time when already fetched', () => {
    const reset = Math.floor(NOW / 1000) + 6 * 60
    const f = run('rate_search', { rateLimit: { search: { limit: 30, remaining: 0, reset } } })
    expect(f.kind).toBe('rate_limit')
    expect(f.subject.limit).toBe('search')
    expect(f.cause).toContain('search')
    expect(f.notes[0]).toBe(`Resets at ${localTime(reset)} your time (in 6m).`)
  })

  it('rate limit does not invent a reset time it was not given', () => {
    const f = run('rate_core')
    expect(f.subject.limit).toBe('core')
    expect(f.subject.resetAt).toBeNull()
    expect(f.notes[0]).toMatch(/did not report a reset time/)
    expect(run('rate_graphql').subject.limit).toBe('graphql')
  })

  it('secondary rate limit is distinct and asks for no action', () => {
    const f = run('rate_secondary')
    expect(f.kind).toBe('secondary_limit')
    expect(f.tone).toBe('waiting')
  })

  it('repo not found says GitHub gives one answer for not found and no access', () => {
    for (const name of ['repo_not_found_graphql', 'repo_not_found_rest']) {
      const f = run(name)
      expect(f.kind).toBe('repo_not_found')
      expect(f.cause).toBe('acme/legacy was not found, or your account cannot see it.')
      expect(f.notes[0]).toMatch(/same answer for both/)
    }
  })

  it('offline names the host', () => {
    for (const name of ['offline', 'offline_dial']) {
      const f = run(name)
      expect(f.kind).toBe('offline')
      expect(f.tone).toBe('offline')
      expect(f.cause).toContain('api.github.com')
    }
  })

  it('partial data lists which repos failed and why, and how many loaded', () => {
    const p = classifyPartial([
      { repo: 'acme/billing', error: errFor('sso_rest') },
      { repo: 'acme/legacy', error: errFor('repo_not_found_rest') },
    ], 14, { host: 'github.com' })
    expect(p.loaded).toBe(12)
    expect(p.cause).toBe('2 repositories did not load; the rest are complete and usable.')
    expect(p.failed.map(r => [r.repo, r.kind, r.fix])).toEqual([
      ['acme/billing', 'sso', 'gh auth refresh -h github.com'],
      ['acme/legacy', 'repo_not_found', 'gh auth refresh -h github.com'],
    ])
    expect(p.failed[0].reason).toBe('SAML SSO not authorized for acme')
  })

  it('unknown errors fall back to a sanitized first line', () => {
    const f = classifyGhFailure(new Error('boom \u001b[31mred\u001b[0m'))
    expect(f.kind).toBe('unknown')
    expect(f.cause).toBe('GitHub returned an error: boom red')
  })
})

describe('scrub', () => {
  it('removes tokens and credentialed or query-bearing URLs', () => {
    const out = scrub('push https://user:ghp_abcdefghijklmnopqrstuvwxyz0123456789@github.com/a/b?access_token=zzz Authorization: Bearer abc123 ghp_abcdefghijklmnopqrstuvwxyz0123456789')
    expect(out).not.toMatch(/ghp_|user:|access_token|abc123/)
  })

  it('leaves ordinary prose alone', () => {
    expect(scrub('Your gh token lacks the read:org scope.')).toBe('Your gh token lacks the read:org scope.')
  })
})
