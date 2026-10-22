import { describe, it, expect, vi, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { redactText, buildReport, buildIssueUrl, runFeedback, MAX_URL_LENGTH } from './feedback.js'

const sink = (tty = false) => {
  const chunks = []
  return { isTTY: tty, write: s => { chunks.push(s) }, text: () => chunks.join('') }
}

describe('redactText', () => {
  const opts = { hosts: ['ghe.corp.example'], users: ['alice'], home: '/Users/alice' }
  it.each([
    ['token ghp_abcdefghijklmnopqrstuvwxyz0123456789', 'ghp_'],
    ['Authorization: Bearer abcdefgh12345678', 'abcdefgh12345678'],
    ['failed at /Users/alice/work/secret-proj/lazyhub.toml', 'secret-proj'],
    ['repo acme-corp/payments-api#12 broke', 'payments-api'],
    ['user alice logged in', 'alice'],
    ['host ghe.corp.example refused', 'ghe.corp.example'],
  ])('removes sensitive data from %j', (input, secret) => {
    expect(redactText(input, opts)).not.toContain(secret)
  })

  it('keeps the GHES host only with includeHost', () => {
    expect(redactText('host ghe.corp.example', { ...opts, includeHost: true })).toContain('ghe.corp.example')
  })
})

describe('buildReport', () => {
  it('has version, OS, Node, terminal and doctor summary, with no paths or host', () => {
    const dir = mkdtempSync(join(tmpdir(), 'lazyhub-fb-'))
    const configPath = join(dir, 'lazyhub.toml')
    writeFileSync(configPath, 'theme = "x"\n')
    const text = buildReport({ configPath, hosts: ['ghe.corp.example'], env: { TERM: 'xterm', GH_HOST: 'ghe.corp.example' }, stdout: { columns: 80, rows: 24 } })
    expect(text).toMatch(/lazyhub: \S+/)
    expect(text).toContain(`Node: ${process.version}`)
    expect(text).toContain('80x24')
    expect(text).toContain('### Doctor (config)')
    expect(text).not.toContain(dir)
    expect(text).not.toContain('ghe.corp.example')
  })
})

describe('buildIssueUrl', () => {
  it('encodes the body and targets the lazyhub repo', () => {
    const { url, truncated } = buildIssueUrl('a b&c=d\n#1')
    expect(truncated).toBe(false)
    expect(url).toMatch(/^https:\/\/github\.com\/saketh-kowtha\/lazyhub\/issues\/new\?title=/)
    expect(new URL(url).searchParams.get('body')).toBe('a b&c=d\n#1')
  })

  it('truncates long bodies to fit, on a character boundary, and says so', () => {
    const { url, truncated } = buildIssueUrl('é😀&'.repeat(5000))
    expect(truncated).toBe(true)
    expect(url.length).toBeLessThanOrEqual(MAX_URL_LENGTH)
    expect(new URL(url).searchParams.get('body')).toContain('truncated')
    expect(() => decodeURIComponent(url)).not.toThrow()
  })
})

describe('runFeedback', () => {
  afterEach(() => vi.restoreAllMocks())
  const buildOpts = { env: { TERM: 'xterm' }, stdout: { columns: 80, rows: 24 } }

  it('non-TTY behaves like --print: prints, never asks or opens', async () => {
    const out = sink(false)
    const open = vi.fn()
    const ask = vi.fn()
    expect(await runFeedback([], { out, err: sink(), input: { isTTY: false }, open, ask, buildOpts })).toBe(0)
    expect(out.text()).toContain('### Environment')
    expect(open).not.toHaveBeenCalled()
    expect(ask).not.toHaveBeenCalled()
  })

  it('--print never opens even on a TTY', async () => {
    const open = vi.fn()
    await runFeedback(['--print'], { out: sink(true), err: sink(), input: { isTTY: true }, open, ask: vi.fn(), buildOpts })
    expect(open).not.toHaveBeenCalled()
  })

  it('opens the pre-filled URL only after confirmation', async () => {
    const open = vi.fn()
    const io = { out: sink(true), err: sink(), input: { isTTY: true }, open, buildOpts }
    await runFeedback([], { ...io, ask: async () => false })
    expect(open).not.toHaveBeenCalled()
    await runFeedback([], { ...io, ask: async () => true })
    expect(open).toHaveBeenCalledTimes(1)
    expect(open.mock.calls[0][0]).toMatch(/^https:\/\/github\.com\/saketh-kowtha\/lazyhub\/issues\/new\?/)
  })

  it('rejects unknown options with exit 2', async () => {
    const err = sink()
    expect(await runFeedback(['--bogus'], { out: sink(), err })).toBe(2)
    expect(err.text()).toContain('unknown option')
  })

  it('makes no network or gh call', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(() => { throw new Error('network') })
    const executor = await import('../executor.js')
    const ghSpy = vi.spyOn(executor, 'runGh')
    await runFeedback(['--print'], { out: sink(), err: sink(), buildOpts })
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(ghSpy).not.toHaveBeenCalled()
  })
})
