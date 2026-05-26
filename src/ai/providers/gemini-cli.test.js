/**
 * src/ai/providers/gemini-cli.test.js — Unit tests for the Gemini CLI provider.
 *
 * Mocks execFile at the node:child_process level (used by _base.js spawnAndPipe).
 */

import { describe, it, expect, vi, afterEach } from 'vitest'
import { detect, complete, id } from './gemini-cli.js'
import { AIError } from '../error.js'

// ─── Mock child_process.execFile ─────────────────────────────────────────────

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    execFile: vi.fn(),
  }
})

// Import after mock is set up
const childProcess = await import('node:child_process')

// Helper: create a fake child process that resolves with the given output
function makeChild(options = {}) {
  const { exitCode = 0, stdout = '', stderr = '', writeError = null } = options

  const stdinMock = {
    write: vi.fn((data, enc, cb) => {
      if (writeError) {
        cb && cb(writeError)
        return
      }
      cb && cb(null)
    }),
    end: vi.fn(),
  }

  const childMock = {
    stdin: stdinMock,
  }

  // execFile callback form
  childProcess.execFile.mockImplementation((_cmd, _args, _opts, callback) => {
    // Schedule callback asynchronously so stdin writes can happen first
    setImmediate(() => {
      if (exitCode !== 0) {
        const err = new Error(stderr || 'process exited')
        err.code = exitCode
        callback(err, '', stderr)
      } else {
        callback(null, stdout, '')
      }
    })
    return childMock
  })

  return { stdinMock, childMock }
}

// ─── detect() tests ───────────────────────────────────────────────────────────

describe('detect()', () => {
  afterEach(() => vi.resetAllMocks())

  it('returns available:true when gemini --version exits 0', async () => {
    makeChild({ stdout: 'Gemini CLI 2.0.1\n' })
    const result = await detect()
    expect(result.available).toBe(true)
    expect(result.version).toBe('Gemini CLI 2.0.1')
  })

  it('returns available:false with reason when ENOENT', async () => {
    childProcess.execFile.mockImplementation((_cmd, _args, _opts, cb) => {
      const err = new Error('spawn gemini ENOENT')
      err.code = 'ENOENT'
      setImmediate(() => cb(err, '', ''))
      return { stdin: { write: vi.fn(), end: vi.fn() } }
    })
    const result = await detect()
    expect(result.available).toBe(false)
    expect(result.reason).toMatch(/not found/i)
  })

  it('returns available:false when gemini --version exits non-zero', async () => {
    childProcess.execFile.mockImplementation((_cmd, _args, _opts, cb) => {
      const err = new Error('failed')
      err.code = 1
      setImmediate(() => cb(err, '', 'error output'))
      return { stdin: { write: vi.fn(), end: vi.fn() } }
    })
    const result = await detect()
    expect(result.available).toBe(false)
  })
})

// ─── complete() tests ─────────────────────────────────────────────────────────

describe('complete()', () => {
  afterEach(() => vi.resetAllMocks())

  it('sends combined system+user via stdin, not argv', async () => {
    const { stdinMock } = makeChild({
      stdout: JSON.stringify({ response: { text: 'Hello from Gemini' } }),
    })

    await complete({ system: 'system prompt', user: 'user message' })

    // Verify stdin was written (not argv)
    expect(stdinMock.write).toHaveBeenCalled()
    const writtenContent = stdinMock.write.mock.calls[0][0]
    expect(writtenContent).toContain('system prompt')
    expect(writtenContent).toContain('user message')
  })

  it('argv contains -p, -, --output-format json', async () => {
    makeChild({
      stdout: JSON.stringify({ response: { text: 'response' } }),
    })

    await complete({ system: 'sys', user: 'usr' })

    const [_cmd, args] = childProcess.execFile.mock.calls[0]
    expect(args).toContain('-p')
    expect(args).toContain('-')
    expect(args).toContain('--output-format')
    expect(args).toContain('json')
    // Prompt NOT in argv
    expect(args).not.toContain('system prompt')
    expect(args).not.toContain('user message')
  })

  it('parses response.text from JSON output', async () => {
    makeChild({
      stdout: JSON.stringify({ response: { text: 'Hello from Gemini' } }),
    })

    const out = await complete({ system: 'sys', user: 'usr' })
    expect(out.text).toBe('Hello from Gemini')
    expect(out.tokensIn).toBeNull()
    expect(out.tokensOut).toBeNull()
  })

  it('parses candidates[0].content.parts[0].text as fallback', async () => {
    makeChild({
      stdout: JSON.stringify({
        candidates: [
          {
            content: {
              parts: [
                { text: 'Fallback response text' },
              ],
            },
          },
        ],
      }),
    })

    const out = await complete({ system: 'sys', user: 'usr' })
    expect(out.text).toBe('Fallback response text')
  })

  it('prefers response.text over candidates format', async () => {
    makeChild({
      stdout: JSON.stringify({
        response: { text: 'Primary format' },
        candidates: [
          {
            content: {
              parts: [
                { text: 'Fallback format' },
              ],
            },
          },
        ],
      }),
    })

    const out = await complete({ system: 'sys', user: 'usr' })
    expect(out.text).toBe('Primary format')
  })

  it('throws AIError timeout when process is killed', async () => {
    childProcess.execFile.mockImplementation((_cmd, _args, _opts, cb) => {
      const err = new Error('timed out')
      err.killed = true
      setImmediate(() => cb(err, '', ''))
      return { stdin: { write: vi.fn(), end: vi.fn() } }
    })

    const err = await complete({ system: 'sys', user: 'usr' }).catch(e => e)
    expect(err).toBeInstanceOf(AIError)
    expect(err.code).toBe('timeout')
    expect(err.provider).toBe(id)
  })

  it('throws AIError spawn-failed on ENOENT', async () => {
    childProcess.execFile.mockImplementation((_cmd, _args, _opts, cb) => {
      const err = new Error('spawn gemini ENOENT')
      err.code = 'ENOENT'
      setImmediate(() => cb(err, '', ''))
      return { stdin: { write: vi.fn(), end: vi.fn() } }
    })

    const err = await complete({ system: 'sys', user: 'usr' }).catch(e => e)
    expect(err).toBeInstanceOf(AIError)
    expect(err.code).toBe('spawn-failed')
  })

  it('throws AIError auth-required when stderr contains "unauthenticated"', async () => {
    childProcess.execFile.mockImplementation((_cmd, _args, _opts, cb) => {
      const err = new Error('unauthenticated')
      err.code = 1
      setImmediate(() => cb(err, '', 'error: unauthenticated'))
      return { stdin: { write: vi.fn(), end: vi.fn() } }
    })

    const err = await complete({ system: 'sys', user: 'usr' }).catch(e => e)
    expect(err).toBeInstanceOf(AIError)
    expect(err.code).toBe('auth-required')
    expect(err.message).toContain('Gemini CLI not logged in')
  })

  it('throws AIError malformed-response on non-JSON output', async () => {
    makeChild({ stdout: 'not valid json at all' })

    const err = await complete({ system: 'sys', user: 'usr' }).catch(e => e)
    expect(err).toBeInstanceOf(AIError)
    expect(err.code).toBe('malformed-response')
  })

  it('throws AIError malformed-response when no text field found', async () => {
    makeChild({
      stdout: JSON.stringify({ response: {} }),
    })

    const err = await complete({ system: 'sys', user: 'usr' }).catch(e => e)
    expect(err).toBeInstanceOf(AIError)
    expect(err.code).toBe('malformed-response')
    expect(err.message).toContain('assistant text')
  })

  it('throws AIError malformed-response when text is not a string', async () => {
    makeChild({
      stdout: JSON.stringify({ response: { text: 123 } }),
    })

    const err = await complete({ system: 'sys', user: 'usr' }).catch(e => e)
    expect(err).toBeInstanceOf(AIError)
    expect(err.code).toBe('malformed-response')
    expect(err.message).toContain('Unexpected')
  })

  it('does not pass ANTHROPIC_API_KEY or GH_TOKEN to subprocess env', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-secret'
    process.env.GH_TOKEN          = 'ghp-secret'

    makeChild({
      stdout: JSON.stringify({ response: { text: 'response' } }),
    })

    await complete({ system: 'sys', user: 'usr' })

    const [_cmd, _args, opts] = childProcess.execFile.mock.calls[0]
    expect(opts.env).toBeDefined()
    expect(opts.env.ANTHROPIC_API_KEY).toBeUndefined()
    expect(opts.env.GH_TOKEN).toBeUndefined()
    expect(opts.env.PATH).toBeDefined()
    expect(opts.env.HOME).toBeDefined()

    delete process.env.ANTHROPIC_API_KEY
    delete process.env.GH_TOKEN
  })

  it('enforces a timeout option', async () => {
    makeChild({
      stdout: JSON.stringify({ response: { text: 'response' } }),
    })

    await complete({ system: 'sys', user: 'usr', timeoutMs: 30_000 })

    const [_cmd, _args, opts] = childProcess.execFile.mock.calls[0]
    expect(opts.timeout).toBe(30_000)
  })
})
