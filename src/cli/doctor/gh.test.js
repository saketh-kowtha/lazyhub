import { describe, expect, it } from 'vitest'
import { checkGh } from './gh.js'
import { checkConfig } from './config.js'

describe('checkGh', () => {
  it('reports installed and logged in', async () => {
    const r = await checkGh({ probe: async () => ({ ok: true, version: '2.40.0' }), auth: async () => ({ ok: true }) })
    expect(r.ok).toBe(true)
    expect(r.checks.map(c => c.label)).toEqual(['gh installed (2.40.0)', 'Logged in to github.com'])
  })
  it('names the install step when gh is missing', async () => {
    const r = await checkGh({ probe: async () => ({ ok: false }) })
    expect(r.ok).toBe(false)
    expect(r.checks[0].label).toMatch(/not installed.*cli\.github\.com/)
  })
  it('says gh did not respond when it hangs', async () => {
    const r = await checkGh({ probe: async () => ({ ok: false, timedOut: true }) })
    expect(r.checks[0].label).toMatch(/did not respond/)
  })
  it('gives cause and command when not logged in', async () => {
    const failure = { cause: 'You are not signed in to GitHub.', fix: 'gh auth login', notes: [] }
    const r = await checkGh({ probe: async () => ({ ok: true }), auth: async () => ({ ok: false, failure }) })
    expect(r.ok).toBe(false)
    expect(r.checks[1].label).toBe('You are not signed in to GitHub.; Run: gh auth login')
  })
})

describe('checkConfig on a fresh install (A6)', () => {
  it('a missing config file is not a failure', () => {
    const r = checkConfig({ configPath: '/nonexistent-lazyhub-dir/lazyhub.toml' })
    expect(r.ok).toBe(true)
    expect(r.checks[0]).toMatchObject({ ok: true })
    expect(r.checks[0].label).toMatch(/defaults are in use/)
  })
})
