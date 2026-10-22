import { describe, expect, it } from 'vitest'
import { parseItemReference } from './input-validation.js'

const GHES = { hosts: ['ghe.example.com'] }
const ok = (input, opts) => {
  const r = parseItemReference(input, opts)
  expect(r.ok, JSON.stringify(r)).toBe(true)
  return r.ref
}

describe('parseItemReference (#315)', () => {
  it('accepts owner/repo#N, #N and N', () => {
    expect(ok('octo/cat#12')).toEqual({ repo: 'octo/cat', number: 12, kind: null, host: null })
    expect(ok('#12')).toEqual({ repo: null, number: 12, kind: null, host: null })
    expect(ok('12')).toEqual({ repo: null, number: 12, kind: null, host: null })
    expect(ok('my.org/some_repo-x.js#1').repo).toBe('my.org/some_repo-x.js')
  })

  it('accepts github.com and configured-host PR and issue URLs, with the kind they name', () => {
    expect(ok('https://github.com/octo/cat/pull/5')).toEqual({ repo: 'octo/cat', number: 5, kind: 'pr', host: 'github.com' })
    expect(ok('https://github.com/octo/cat/issues/6/')).toMatchObject({ kind: 'issue', number: 6 })
    expect(ok('https://github.com/octo/cat/pull/5/files#diff-1?x=1')).toMatchObject({ kind: 'pr', number: 5 })
    expect(ok('https://GHE.example.com/octo/cat/pull/9', GHES)).toMatchObject({ host: 'ghe.example.com', number: 9 })
  })

  it.each([
    ['empty', ''],
    ['zero', '0'],
    ['leading zero', '007'],
    ['negative', '-3'],
    ['huge number', '99999999999999999999'],
    ['missing number', 'octo/cat#'],
    ['extra path', 'a/b/c#1'],
    ['no owner', '/cat#1'],
    ['dot-only repo', 'octo/..#1'],
    ['word', 'docter'],
    ['not a number', '12abc'],
    ['url with wrong kind', 'https://github.com/octo/cat/actions/runs/1'],
    ['url without number', 'https://github.com/octo/cat/pull/'],
    ['url with extra tail', 'https://github.com/octo/cat/pull/5/../../x'],
    ['http scheme', 'http://github.com/octo/cat/pull/5'],
    ['ssh scheme', 'ssh://git@github.com/octo/cat/pull/5'],
    ['credentials in url', 'https://user:pw@github.com/octo/cat/pull/5'],
    ['port in url', 'https://github.com:8443/octo/cat/pull/5'],
  ])('rejects malformed input: %s', (_label, input) => {
    expect(parseItemReference(input, GHES).ok).toBe(false)
  })

  it('refuses foreign hosts, including lookalikes of allowed ones', () => {
    for (const url of [
      'https://evil.example/octo/cat/pull/5',
      'https://github.com.evil.example/octo/cat/pull/5',
      'https://evilgithub.com/octo/cat/pull/5',
      'https://ghe.example.com.evil.example/octo/cat/pull/5',
      'https://github.com@evil.example/octo/cat/pull/5',
    ]) expect(parseItemReference(url, GHES).ok, url).toBe(false)
    // A configured host is only honoured when the caller passes it.
    expect(parseItemReference('https://ghe.example.com/octo/cat/pull/9').ok).toBe(false)
  })

  it.each([
    'octo/cat#1; rm -rf ~',
    'octo/cat#1 --repo evil/x',
    '$(touch pwned)',
    '`id`',
    'octo/cat#1\n2',
    '--repo=evil/x',
    '../../etc/passwd',
    'octo/cat#1|cat',
    'https://github.com/octo/cat/pull/5;id',
    'https://github.com/octo/cat/pull/5\nhttps://evil.example/',
    'javascript:alert(1)',
    'file:///etc/passwd',
  ])('rejects injection-shaped input: %j', input => {
    expect(parseItemReference(input, GHES).ok).toBe(false)
  })

  it('rejects non-strings', () => {
    for (const v of [undefined, null, 5, {}, ['5']]) expect(parseItemReference(v).ok).toBe(false)
  })
})
