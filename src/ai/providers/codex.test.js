/**
 * src/ai/providers/codex.test.js — Unit tests for the Codex CLI provider.
 *
 * Mocks execFile at the node:child_process level (used by _base.js spawnAndPipe).
 */

import { describe, it, expect, vi, afterEach } from 'vitest'
import { detect, complete, id } from './codex.js'
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

  it('returns available:true when codex --version exits 0', async () => {
    makeChild({ stdout: 'Codex CLI 1.2.3\n' })
    const result = await detect()
    expect(result.available).toBe(true)
    expect(result.version).toBe('Codex CLI 1.2.3')
  })

  it('returns available:false with reason when ENOENT', async () => {
    childProcess.execFile.mockImplementation((_cmd, _args, _opts, cb) => {
      const err = new Error('spawn codex ENOENT')
      err.code = 'ENOENT'
      setImmediate(() => cb(err, '', ''))
      return { stdin: { write: vi.fn(), end: vi.fn() } }
    })
    const result = await detect()
    expect(result.available).toBe(false)
    expect(result.reason).toMatch(/not found/i)
  })

  it('returns available:false when codex --version exits non-zero', async () => {
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
      stdout: JSON.stringify({ type: 'agent_message', message: 'Hello from Codex' }),
    })

    await complete({ system: 'system prompt', user: 'user message' })

    // Verify stdin was written (not argv)
    expect(stdinMock.write).toHaveBeenCalled()
    const writtenContent = stdinMock.write.mock.calls[0][0]
    expect(writtenContent).toContain('system prompt')
    expect(writtenContent).toContain('user message')
  })

  it('argv contains exec, --json, --skip-git-repo-check', async () => {
    makeChild({
      stdout: JSON.stringify({ type: 'agent_message', message: 'response' }),
    })

    await complete({ system: 'sys', user: 'usr' })

    const [_cmd, args] = childProcess.execFile.mock.calls[0]
    expect(args).toContain('exec')
    expect(args).toContain('--json')
    expect(args).toContain('--skip-git-repo-check')
    // Prompt NOT in argv
    expect(args).not.toContain('system prompt')
    expect(args).not.toContain('user message')
  })

  it('parses agent_message events from NDJSON output', async () => {
    const ndjson = [
      JSON.stringify({ type: 'log', message: 'Starting...' }),
      JSON.stringify({ type: 'agent_message', message: 'Hello' }),
      JSON.stringify({ type: 'log', message: 'Processing...' }),
      JSON.stringify({ type: 'agent_message', message: ' World' }),
    ].join('\n')

    makeChild({ stdout: ndjson })

    const out = await complete({ system: 'sys', user: 'usr' })
    expect(out.text).toBe('Hello World')
    expect(out.tokensIn).toBeNull()
    expect(out.tokensOut).toBeNull()
  })

  it('ignores non-agent_message events in NDJSON output', async () => {
    const ndjson = [
      JSON.stringify({ type: 'tool_call', name: 'grep' }),
      JSON.stringify({ type: 'agent_message', message: 'Result:' }),
      JSON.stringify({ type: 'tool_result', output: 'data' }),
    ].join('\n')

    makeChild({ stdout: ndjson })

    const out = await complete({ system: 'sys', user: 'usr' })
    expect(out.text).toBe('Result:')
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
      const err = new Error('spawn codex ENOENT')
      err.code = 'ENOENT'
      setImmediate(() => cb(err, '', ''))
      return { stdin: { write: vi.fn(), end: vi.fn() } }
    })

    const err = await complete({ system: 'sys', user: 'usr' }).catch(e => e)
    expect(err).toBeInstanceOf(AIError)
    expect(err.code).toBe('spawn-failed')
  })

  it('throws AIError auth-required when stderr contains "not logged in"', async () => {
    childProcess.execFile.mockImplementation((_cmd, _args, _opts, cb) => {
      const err = new Error('not logged in')
      err.code = 1
      setImmediate(() => cb(err, '', 'error: not logged in'))
      return { stdin: { write: vi.fn(), end: vi.fn() } }
    })

    const err = await complete({ system: 'sys', user: 'usr' }).catch(e => e)
    expect(err).toBeInstanceOf(AIError)
    expect(err.code).toBe('auth-required')
    expect(err.message).toContain('Codex not logged in')
  })

  it('throws AIError malformed-response when no agent_message events found', async () => {
    const ndjson = [
      JSON.stringify({ type: 'log', message: 'Starting...' }),
      JSON.stringify({ type: 'tool_call', name: 'grep' }),
    ].join('\n')

    makeChild({ stdout: ndjson })

    const err = await complete({ system: 'sys', user: 'usr' }).catch(e => e)
    expect(err).toBeInstanceOf(AIError)
    expect(err.code).toBe('malformed-response')
    expect(err.message).toContain('No assistant message')
  })

  it('tolerates unparseable NDJSON lines if there are valid agent_message events', async () => {
    const ndjson = [
      JSON.stringify({ type: 'agent_message', message: 'Hello' }),
      'not valid json at all',
      JSON.stringify({ type: 'agent_message', message: ' World' }),
    ].join('\n')

    makeChild({ stdout: ndjson })

    const out = await complete({ system: 'sys', user: 'usr' })
    expect(out.text).toBe('Hello World')
  })

  it('does not pass ANTHROPIC_API_KEY or GH_TOKEN to subprocess env', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-secret'
    process.env.GH_TOKEN          = 'ghp-secret'

    makeChild({
      stdout: JSON.stringify({ type: 'agent_message', message: 'response' }),
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
      stdout: JSON.stringify({ type: 'agent_message', message: 'response' }),
    })

    await complete({ system: 'sys', user: 'usr', timeoutMs: 30_000 })

    const [_cmd, _args, opts] = childProcess.execFile.mock.calls[0]
    expect(opts.timeout).toBe(30_000)
  })
})
