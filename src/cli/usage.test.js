import { describe, expect, it } from 'vitest'
import { parseCliArgs, USAGE } from './usage.js'

describe('parseCliArgs', () => {
  it('opens the plain TUI with no arguments and tolerates --mouse', () => {
    expect(parseCliArgs([])).toEqual({ ref: null })
    expect(parseCliArgs(['--mouse'])).toEqual({ ref: null })
  })

  it('returns help for --help/-h even beside other bad input', () => {
    expect(parseCliArgs(['--bogus', '-h'])).toEqual({ help: true })
    expect(USAGE).toMatch(/^Usage:/m)
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
