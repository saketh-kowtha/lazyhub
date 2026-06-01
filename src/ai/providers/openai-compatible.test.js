/**
 * ai/providers/openai-compatible.test.js — OpenAI-compatible provider tests.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const DEFAULT_OPENAI_COMPATIBLE = {
  base_url: 'http://localhost:11434/v1',
  api_key: 'test-key',
  model: 'test-model',
  timeout_ms: 1000,
}

const cfg = {
  ai: {
    openai_compatible: { ...DEFAULT_OPENAI_COMPATIBLE },
  },
}

vi.mock('../../config/loader.js', () => ({
  loadConfig: () => cfg,
}))

const provider = await import('./openai-compatible.js')

describe('openai-compatible provider', () => {
  beforeEach(() => {
    cfg.ai.openai_compatible = { ...DEFAULT_OPENAI_COMPATIBLE }
    global.fetch = vi.fn()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('sends OpenAI chat completions shape and parses usage', async () => {
    fetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        model: 'test-model',
        choices: [{ message: { content: '{"summary":"ok","suggestions":[]}' } }],
        usage: { prompt_tokens: 3, completion_tokens: 4 },
      }),
    })

    const result = await provider.complete({ system: 'sys', user: 'hi' })

    expect(fetch).toHaveBeenCalledWith('http://localhost:11434/v1/chat/completions', expect.objectContaining({
      method: 'POST',
      headers: expect.objectContaining({ authorization: 'Bearer test-key' }),
    }))
    const body = JSON.parse(fetch.mock.calls[0][1].body)
    expect(body).toMatchObject({ model: 'test-model', stream: false })
    expect(result).toMatchObject({ text: '{"summary":"ok","suggestions":[]}', tokensIn: 3, tokensOut: 4 })
  })

  it('returns friendly auth errors', async () => {
    fetch.mockResolvedValue({ ok: false, status: 401 })

    const err = await provider.complete({ user: 'hi' }).catch(e => e)

    expect(err.code).toBe('auth-required')
    expect(err.message).toContain('localhost:11434')
  })

  it('omits Authorization when api_key is empty', async () => {
    cfg.ai.openai_compatible.api_key = ''
    fetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: 'ok' } }],
      }),
    })

    await provider.complete({ user: 'hi' })

    expect(fetch.mock.calls[0][1].headers.authorization).toBeUndefined()
  })

  it('reports 5xx as provider-unavailable', async () => {
    fetch.mockResolvedValue({ ok: false, status: 500 })

    const err = await provider.complete({ user: 'hi' }).catch(e => e)

    expect(err.code).toBe('provider-unavailable')
    expect(err.message).toContain('localhost:11434')
  })

  it('reports malformed JSON responses', async () => {
    fetch.mockResolvedValue({
      ok: true,
      json: async () => { throw new Error('bad json') },
    })

    const err = await provider.complete({ user: 'hi' }).catch(e => e)

    expect(err.code).toBe('malformed-response')
  })

  it('reports unexpected empty bodies', async () => {
    fetch.mockResolvedValue({
      ok: true,
      json: async () => ({}),
    })

    const err = await provider.complete({ user: 'hi' }).catch(e => e)

    expect(err.code).toBe('malformed-response')
  })

  it('aborts on timeout', async () => {
    fetch.mockImplementation((_url, opts) => new Promise((_resolve, reject) => {
      opts.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })))
    }))

    const err = await provider.complete({ user: 'hi', timeoutMs: 1 }).catch(e => e)

    expect(err.code).toBe('timeout')
  })

  it('detects missing config', async () => {
    cfg.ai.openai_compatible.base_url = ''

    const result = await provider.detect()

    expect(result.available).toBe(false)
    expect(result.reason).toContain('base_url')
  })
})
