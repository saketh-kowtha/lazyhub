import { describe, expect, it } from 'vitest'
import { parseCliArgs, USAGE } from './usage.js'

describe('parseCliArgs', () => {
  it('opens the plain TUI with no arguments and tolerates --mouse and --onboarding', () => {
    expect(parseCliArgs([])).toEqual({ ref: null })
    expect(parseCliArgs(['--mouse'])).toEqual({ ref: null })
    expect(parseCliArgs(['--onboarding'])).toEqual({ ref: null })
    expect(USAGE).toContain('--onboarding')
  })

  it('returns help for --help/-h even beside other bad input', () => {
    expect(parseCliArgs(['--bogus', '-h'])).toEqual({ help: true })
    expect(USAGE).toMatch(/^Usage:/m)
  })

  it('accepts --repo owner/name and --repo=owner/name (#466)', () => {
    expect(parseCliArgs(['--repo', 'octo/cat'])).toEqual({ ref: null, repo: 'octo/cat' })
    expect(parseCliArgs(['--repo=octo/cat'])).toEqual({ ref: null, repo: 'octo/cat' })
    expect(parseCliArgs(['--repo', 'octo/cat', '--mouse', 'octo/cat#4']).repo).toBe('octo/cat')
    expect(USAGE).toContain('--repo owner/name')
  })

  it('rejects a missing or malformed --repo value before anything starts (#466)', () => {
    expect(parseCliArgs(['--repo']).error).toMatch(/--repo needs owner\/name/)
    expect(parseCliArgs(['--repo', '--mouse']).error).toMatch(/--repo needs owner\/name/)
    expect(parseCliArgs(['--repo', 'not a repo']).error).toMatch(/invalid repository/)
    expect(parseCliArgs(['--repo', 'a/b/c']).error).toMatch(/invalid repository/)
    expect(parseCliArgs(['--repo', 'a/b', '--repo', 'c/d']).error).toMatch(/only once/)
  })

  it('rejects unknown options and multiple references', () => {
    expect(parseCliArgs(['--nope']).error).toBe('unknown option: --nope')
    expect(parseCliArgs(['o/r#1', 'o/r#2']).error).toMatch(/at most one/)
  })

  it('reports a malformed reference with a truncated, JSON-quoted echo', () => {
    const { error, ref } = parseCliArgs(['x'.repeat(200)])
    expect(ref).toBeUndefined()
    expect(error).toContain('"')
    expect(error.length).toBeLessThan(200)
  })

  it('parses a valid owner/repo#n reference', () => {
    expect(parseCliArgs(['octo/cat#12']).ref).toBeTruthy()
  })
})
