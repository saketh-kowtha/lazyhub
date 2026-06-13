import { beforeEach, describe, expect, it, vi } from 'vitest'
import { runAssistantTurn } from './ai-assistant.js'

describe('runAssistantTurn provider routing', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('routes openai-compatible config through its configured chat completions endpoint', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: 'hello from local model' } }],
      }),
    })

    const result = await runAssistantTurn({
      messages: [],
      userMessage: 'hello',
      repo: 'owner/repo',
      ctx: { repo: 'owner/repo', pane: 'prs', selectedItem: null },
      aiConfig: {
        provider: 'openai-compatible',
        openai_compatible: {
          base_url: 'http://localhost:1234/v1',
          api_key: 'local-key',
          model: 'qwen2.5-coder:32b',
          timeout_ms: 60000,
        },
      },
    })

    expect(result).toMatchObject({ type: 'answer', text: 'hello from local model' })
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:1234/v1/chat/completions',
      expect.objectContaining({
        headers: expect.objectContaining({ authorization: 'Bearer local-key' }),
      })
    )
    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body.model).toBe('qwen2.5-coder:32b')
  })
})
