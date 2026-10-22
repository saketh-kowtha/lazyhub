import { beforeEach, describe, expect, it, vi } from 'vitest'
import { executeMutatingTool, runAssistantTurn } from './ai-assistant.js'
import * as executor from './executor.js'

vi.mock('./executor.js', () => ({
  listPRs: vi.fn(async () => [{ number: 7 }]),
  getPR: vi.fn(), getPRDiff: vi.fn(), getPRChecks: vi.fn(), listIssues: vi.fn(), getIssue: vi.fn(),
  listBranches: vi.fn(), listRuns: vi.fn(), getRepoInfo: vi.fn(), listNotifications: vi.fn(), listPRComments: vi.fn(),
  mergePR: vi.fn(), closePR: vi.fn(), closeIssue: vi.fn(), addPRComment: vi.fn(),
  addLabels: vi.fn(), reviewPR: vi.fn(), rerunRun: vi.fn(), cancelRun: vi.fn(),
}))

const MUTATORS = ['mergePR', 'closePR', 'closeIssue', 'addPRComment', 'addLabels', 'reviewPR', 'rerunRun', 'cancelRun']
const MUTATING_NAMES = ['merge_pr', 'close_pr', 'close_issue', 'add_pr_comment', 'add_labels', 'review_pr', 'rerun_run', 'cancel_run']
const expectNoWrites = () => { for (const fn of MUTATORS) expect(executor[fn]).not.toHaveBeenCalled() }

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

describe('assistant mutation containment (B-64: model writes disabled, even if human-confirmed)', () => {
  const base = {
    messages: [], userMessage: 'merge PR 1', repo: 'owner/repo',
    ctx: { repo: 'owner/repo', pane: 'prs', selectedItem: null },
  }
  const json = body => ({ ok: true, json: async () => body })

  beforeEach(() => { vi.restoreAllMocks(); vi.clearAllMocks() })

  it.each(MUTATING_NAMES)('executeMutatingTool rejects valid %s with a stable code and no executor call', async name => {
    await expect(executeMutatingTool(name, {
      number: 1, runId: 1, labels: ['bug'], event: 'approve', body: 'x', strategy: 'merge',
    }, 'owner/repo')).rejects.toMatchObject({ code: 'AI_MUTATIONS_DISABLED' })
    expectNoWrites()
  })

  it('executeMutatingTool also rejects unknown tools', async () => {
    await expect(executeMutatingTool('delete_repo', { number: 1 }, 'owner/repo'))
      .rejects.toMatchObject({ code: 'AI_MUTATIONS_DISABLED' })
  })

  it('never offers mutating tools to Anthropic, and denies a mutating tool_use that still arrives', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(json({ content: [{ type: 'tool_use', id: 'tu1', name: 'merge_pr', input: { number: 1 } }] }))
      .mockResolvedValueOnce(json({ content: [{ type: 'text', text: 'cannot do that' }] }))

    const result = await runAssistantTurn({ ...base, aiConfig: { provider: 'anthropic', anthropicApiKey: 'k' } })

    const sent = JSON.parse(fetchMock.mock.calls[0][1].body)
    const offered = sent.tools.map(t => t.name)
    expect(offered).toContain('list_prs')
    for (const name of MUTATING_NAMES) expect(offered).not.toContain(name)
    expect(result).toMatchObject({ type: 'answer', text: 'cannot do that' })
    const second = JSON.parse(fetchMock.mock.calls[1][1].body)
    const toolResult = second.messages.at(-1).content[0]
    expect(toolResult.tool_use_id).toBe('tu1')
    expect(JSON.parse(toolResult.content)).toMatchObject({ code: 'AI_MUTATIONS_DISABLED' })
    expectNoWrites()
  })

  it('never offers mutating tools to OpenAI-compatible providers, and denies a mutating call that still arrives', async () => {
    const call = { id: 'c1', type: 'function', function: { name: 'close_issue', arguments: '{"number":3}' } }
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(json({ choices: [{ message: { role: 'assistant', content: '', tool_calls: [call] } }] }))
      .mockResolvedValueOnce(json({ choices: [{ message: { role: 'assistant', content: 'denied' } }] }))

    const result = await runAssistantTurn({ ...base, aiConfig: { provider: 'openai', openaiApiKey: 'k' } })

    const offered = JSON.parse(fetchMock.mock.calls[0][1].body).tools.map(t => t.function.name)
    expect(offered).toContain('list_prs')
    for (const name of MUTATING_NAMES) expect(offered).not.toContain(name)
    expect(result).toMatchObject({ type: 'answer', text: 'denied' })
    const toolMsg = JSON.parse(fetchMock.mock.calls[1][1].body).messages.at(-1)
    expect(toolMsg).toMatchObject({ role: 'tool', tool_call_id: 'c1' })
    expect(JSON.parse(toolMsg.content)).toMatchObject({ code: 'AI_MUTATIONS_DISABLED' })
    expectNoWrites()
  })

  it('still executes read-only tools', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(json({ content: [{ type: 'tool_use', id: 'tu2', name: 'list_prs', input: {} }] }))
      .mockResolvedValueOnce(json({ content: [{ type: 'text', text: 'one PR' }] }))

    const result = await runAssistantTurn({ ...base, aiConfig: { provider: 'anthropic', anthropicApiKey: 'k' } })

    expect(executor.listPRs).toHaveBeenCalledWith('owner/repo', expect.objectContaining({ state: 'open' }))
    expect(result).toMatchObject({ type: 'answer', text: 'one PR' })
  })
})
