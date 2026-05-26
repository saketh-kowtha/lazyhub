/**
 * src/ai/providers/claude-code.test.js — Unit tests for the Claude Code CLI provider.
 *
 * Mocks execFile at the node:child_process level (used by _base.js spawnAndPipe).
 */

import { describe, it, expect, vi, afterEach } from 'vitest'
import { detect, complete, id } from './claude-code.js'
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
        // simulate write error
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

  it('returns available:true when claude --version exits 0', async () => {
    makeChild({ stdout: 'Claude CLI 1.0.5\n' })
    const result = await detect()
    expect(result.available).toBe(true)
    expect(result.version).toBe('Claude CLI 1.0.5')
  })

  it('returns available:false with reason when ENOENT', async () => {
    childProcess.execFile.mockImplementation((_cmd, _args, _opts, cb) => {
      const err = new Error('spawn claude ENOENT')
      err.code = 'ENOENT'
      setImmediate(() => cb(err, '', ''))
      return { stdin: { write: vi.fn(), end: vi.fn() } }
    })
    const result = await detect()
    expect(result.available).toBe(false)
    expect(result.reason).toMatch(/not found/i)
  })

  it('returns available:false when claude --version exits non-zero', async () => {
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
    const reviewText = JSON.stringify({
      summary: 'Looks good',
      suggestions: [],
    })
    const { stdinMock } = makeChild({
      stdout: JSON.stringify({ type: 'result', result: reviewText }),
    })

    await complete({ system: 'system prompt', user: 'user message', model: 'claude-test' })

    // Verify stdin was written (not argv)
    expect(stdinMock.write).toHaveBeenCalled()
    const writtenContent = stdinMock.write.mock.calls[0][0]
    expect(writtenContent).toContain('system prompt')
    expect(writtenContent).toContain('user message')
  })

  it('argv contains -p, --output-format json, --max-turns 1, --model', async () => {
    makeChild({
      stdout: JSON.stringify({ type: 'result', result: '{"summary":"ok","suggestions":[]}' }),
    })

    await complete({ system: 'sys', user: 'usr', model: 'claude-model-x' })

    const [_cmd, args] = childProcess.execFile.mock.calls[0]
    expect(args).toContain('-p')
    expect(args).toContain('--output-format')
    expect(args).toContain('json')
    expect(args).toContain('--max-turns')
    expect(args).toContain('1')
    expect(args).toContain('--model')
    expect(args).toContain('claude-model-x')
    // Prompt NOT in argv
    expect(args).not.toContain('system prompt')
    expect(args).not.toContain('user message')
  })

  it('parses result field from JSON output', async () => {
    const assistantText = '{"summary":"Nice work","suggestions":[]}'
    makeChild({
      stdout: JSON.stringify({ type: 'result', result: assistantText }),
    })

    const out = await complete({ system: 'sys', user: 'usr' })
    expect(out.text).toBe(assistantText)
    expect(out.tokensIn).toBeNull()
    expect(out.tokensOut).toBeNull()
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
      const err = new Error('spawn claude ENOENT')
      err.code = 'ENOENT'
      setImmediate(() => cb(err, '', ''))
      return { stdin: { write: vi.fn(), end: vi.fn() } }
    })

    const err = await complete({ system: 'sys', user: 'usr' }).catch(e => e)
    expect(err).toBeInstanceOf(AIError)
    expect(err.code).toBe('spawn-failed')
  })

  it('throws AIError malformed-response on non-JSON output', async () => {
    makeChild({ stdout: 'not valid json at all' })

    const err = await complete({ system: 'sys', user: 'usr' }).catch(e => e)
    expect(err).toBeInstanceOf(AIError)
    expect(err.code).toBe('malformed-response')
  })

  it('throws AIError malformed-response when result field is missing', async () => {
    makeChild({ stdout: JSON.stringify({ type: 'result', noResultField: true }) })

    const err = await complete({ system: 'sys', user: 'usr' }).catch(e => e)
    expect(err).toBeInstanceOf(AIError)
    expect(err.code).toBe('malformed-response')
  })

  it('does not pass ANTHROPIC_API_KEY or GH_TOKEN to subprocess env', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-secret'
    process.env.GH_TOKEN          = 'ghp-secret'

    makeChild({
      stdout: JSON.stringify({ type: 'result', result: '{"summary":"ok","suggestions":[]}' }),
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
      stdout: JSON.stringify({ type: 'result', result: '{"summary":"ok","suggestions":[]}' }),
    })

    await complete({ system: 'sys', user: 'usr', timeoutMs: 30_000 })

    const [_cmd, _args, opts] = childProcess.execFile.mock.calls[0]
    expect(opts.timeout).toBe(30_000)
  })
})
