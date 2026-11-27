import { describe, expect, it } from 'vitest'
import { nonInteractiveMessage, parseCliArgs, USAGE } from './usage.js'

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

  it('rejects --repo that disagrees with a reference, or is combined with --onboarding (#466)', () => {
    expect(parseCliArgs(['--repo', 'a/b', 'c/d#4']).error).toMatch(/conflicts with the reference's repository c\/d/)
    expect(parseCliArgs(['--repo', 'A/B', 'a/b#4']).error).toBeUndefined()
    expect(parseCliArgs(['--repo', 'a/b', '#4']).repo).toBe('a/b')
    expect(parseCliArgs(['--onboarding', '--repo', 'a/b']).error).toMatch(/cannot be combined/)
    expect(USAGE).toContain('GH_HOST=host lazyhub --repo owner/name')
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

describe('USAGE agent section (#626)', () => {
  it('lists --mcp and the JSON commands under a non-interactive heading', () => {
    const section = USAGE.slice(USAGE.indexOf('For agents and scripts'), USAGE.indexOf('Options:'))
    expect(section).toMatch(/^For agents and scripts \(non-interactive, read-only/)
    expect(section).toMatch(/^ {2}--mcp {2,}MCP server on stdio/m)
    expect(section).toContain('{"command": "lazyhub", "args": ["--mcp"]}')
    expect(section).toContain('doctor --json')
  })

  it('keeps the agent section within 100 columns', () => {
    const section = USAGE.slice(USAGE.indexOf('For agents and scripts'), USAGE.indexOf('Options:'))
    for (const line of section.split('\n')) expect(line.length, line).toBeLessThanOrEqual(100)
  })
})

describe('nonInteractiveMessage (E3: no TUI without a terminal)', () => {
  it('is null when both stdin and stdout are terminals', () => {
    expect(nonInteractiveMessage({ stdin: { isTTY: true }, stdout: { isTTY: true } })).toBeNull()
  })

  it('names the missing stream and the next step when stdout is piped', () => {
    const msg = nonInteractiveMessage({ stdin: { isTTY: true }, stdout: { isTTY: false } })
    expect(msg).toMatch(/standard output is not a terminal/)
    expect(msg).toMatch(/lazyhub status|doctor|--help/)
  })

  it('names stdin when it is not a terminal (CI, cron, < /dev/null)', () => {
    expect(nonInteractiveMessage({ stdin: { isTTY: undefined }, stdout: { isTTY: true } })).toMatch(/standard input is not a terminal/)
  })

  it('names both when neither is a terminal', () => {
    expect(nonInteractiveMessage({ stdin: {}, stdout: {} })).toMatch(/standard input and standard output are not terminals/)
  })
})
