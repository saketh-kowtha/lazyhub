import { describe, it, expect, afterEach } from 'vitest'
import { resolveUrl, defaultBase } from './url.js'

const BASE = 'https://github.com/o/r/'

describe('resolveUrl', () => {
  it('accepts https, http and mailto', () => {
    expect(resolveUrl('https://example.com/a?b=1', { base: BASE })).toMatchObject({ ok: true, host: 'example.com', display: 'example.com/a?b=1' })
    expect(resolveUrl('http://example.com/a', { base: BASE })).toMatchObject({ ok: true, display: 'http://example.com/a' })
    expect(resolveUrl('mailto:a@b.com', { base: BASE })).toMatchObject({ ok: true, display: 'mailto:a@b.com' })
  })

  it.each([
    'javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'java&#x09;script:alert(1)', '&#106;avascript:alert(1)',
    ' data:text/html,x', 'vbscript:x', 'file:///etc/passwd', 'ftp://x.com/', 'blob:https://x.com/1', 'about:blank',
    'custom:thing', 'java\tscript:alert(1)', 'java\nscript:alert(1)', 'javascript&colon;alert(1)', 'java&Tab;script:x',
    '', '   ', 'https://', 'https://x.com/a b',
  ])('rejects %j', value => {
    expect(resolveUrl(value, { base: BASE }).ok).toBe(false)
  })

  it('rejects control, bidi and zero-width characters anywhere', () => {
    expect(resolveUrl('https://x.com/&#27;[2J', { base: BASE }).ok).toBe(false)
    expect(resolveUrl('https://github.com&#x202E;moc.live', { base: BASE }).ok).toBe(false)
    expect(resolveUrl('https://git\u200bhub.com/', { base: BASE }).ok).toBe(false)
  })

  it('resolves relative references against the base', () => {
    expect(resolveUrl('x', { base: BASE })).toMatchObject({ ok: true, display: 'github.com/o/r/x' })
    expect(resolveUrl('/y', { base: BASE })).toMatchObject({ display: 'github.com/y' })
    expect(resolveUrl('#frag', { base: BASE })).toMatchObject({ display: 'github.com/o/r/' })
    expect(resolveUrl('?q=1', { base: BASE })).toMatchObject({ display: 'github.com/o/r/?q=1' })
  })

  it('shows the real host and flags credentials without showing them', () => {
    const r = resolveUrl('https://github.com@evil.com/x', { base: BASE })
    expect(r).toMatchObject({ ok: true, host: 'evil.com', credentials: true })
    expect(r.display).not.toContain('github.com')
  })

  it('shows international hosts as punycode', () => {
    expect(resolveUrl('https://g\u0456thub.com/x', { base: BASE }).host).toMatch(/^xn--/)
  })

  it('treats a scheme-relative reference as its own host', () => {
    expect(resolveUrl('//evil.com/p', { base: BASE })).toMatchObject({ host: 'evil.com' })
  })

  it('truncates long paths but never the host', () => {
    const r = resolveUrl(`https://example.com/${'a'.repeat(300)}`, { base: BASE })
    expect(r.display.startsWith('example.com/')).toBe(true)
    expect(r.display.length).toBeLessThanOrEqual('example.com'.length + 48)
    expect(r.display.endsWith('\u2026')).toBe(true)
  })

  it('rejects values as long as the attribute limit (they were truncated)', () => {
    expect(resolveUrl(`https://example.com/${'a'.repeat(2100)}`, { base: BASE }).ok).toBe(false)
  })
})

describe('defaultBase', () => {
  const saved = process.env.GH_HOST
  afterEach(() => {
    if (saved === undefined) delete process.env.GH_HOST
    else process.env.GH_HOST = saved
  })
  it('follows GH_HOST', () => {
    process.env.GH_HOST = 'ghe.example.com'
    expect(defaultBase()).toBe('https://ghe.example.com/')
    expect(resolveUrl('/x').display).toBe('ghe.example.com/x')
  })
  it('falls back to github.com for an unusable host', () => {
    process.env.GH_HOST = 'bad host'
    expect(defaultBase()).toBe('https://github.com/')
  })
})
