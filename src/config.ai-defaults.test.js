import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { camelAi } from './config.js'
import { runAssistantTurn } from './ai-assistant.js'
import { DEFAULT_CONFIG } from './config/schema.js'

const OPENAI_URL = 'https://api.openai.com/v1'
const OLLAMA_URL = 'http://localhost:11434/v1'
const ENV_KEYS = ['OPENAI_API_KEY', 'OPENAI_BASE_URL']
let savedEnv

beforeEach(() => {
  savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]))
  for (const k of ENV_KEYS) delete process.env[k]
})

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k]
    else process.env[k] = savedEnv[k]
  }
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

/**
 * Run one assistant turn against a stubbed fetch and return the captured request.
 * @param {Object} ai raw [ai] table
 * @returns {Promise<{url: string, headers: Object}>} captured request
 */
async function captureRequest(ai) {
  const fetchMock = vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) }))
  vi.stubGlobal('fetch', fetchMock)
  await runAssistantTurn({ messages: [], userMessage: 'hi', repo: 'o/r', ctx: {}, aiConfig: camelAi(ai) })
  expect(fetchMock).toHaveBeenCalledTimes(1)
  const [url, init] = fetchMock.mock.calls[0]
  return { url, headers: init.headers }
}

describe('AI default endpoint resolution (privacy)', () => {
  it('ollama with no base URL goes to localhost and sends no key', async () => {
    process.env.OPENAI_API_KEY = 'sk-env-secret'
    const { url, headers } = await captureRequest({ provider: 'ollama', openai_api_key: 'sk-file-secret' })
    expect(url).toBe(`${OLLAMA_URL}/chat/completions`)
    expect(headers.authorization).toBeUndefined()
  })

  it('ollama ignores the legacy pinned OpenAI default URL written by older configs', async () => {
    const { url, headers } = await captureRequest({ provider: 'ollama', openai_base_url: OPENAI_URL, openai_api_key: 'sk-file-secret' })
    expect(url).toBe(`${OLLAMA_URL}/chat/completions`)
    expect(headers.authorization).toBeUndefined()
  })

  it('openai with no base URL uses api.openai.com and sends the key', async () => {
    const { url, headers } = await captureRequest({ provider: 'openai', openai_api_key: 'sk-x' })
    expect(url).toBe(`${OPENAI_URL}/chat/completions`)
    expect(headers.authorization).toBe('Bearer sk-x')
  })

  it('an explicit base URL always wins', async () => {
    const { url } = await captureRequest({ provider: 'ollama', openai_base_url: 'http://gpu-box:8080/v1' })
    expect(url).toBe('http://gpu-box:8080/v1/chat/completions')
    process.env.OPENAI_BASE_URL = 'http://env-host/v1'
    expect((await captureRequest({ provider: 'ollama' })).url).toBe('http://env-host/v1/chat/completions')
  })

  it('no non-openai provider resolves to api.openai.com by default', async () => {
    const ai = DEFAULT_CONFIG.ai
    expect(camelAi(ai).openaiBaseUrl).not.toContain('api.openai.com')
    expect(ai.openai_compatible.base_url).not.toContain('api.openai.com')
    for (const provider of ['ollama', 'openai-compatible']) {
      const { url } = await captureRequest({ ...ai, provider })
      expect(url, provider).not.toContain('api.openai.com')
    }
  })
})
