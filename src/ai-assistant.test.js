import { beforeEach, describe, expect, it, vi } from 'vitest'
import { executeMutatingTool, runAssistantTurn } from './ai-assistant.js'
import * as executor from './executor.js'
import { logAiUsage } from './ai/usage.js'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

vi.mock('./ai/usage.js', () => ({ logAiUsage: vi.fn() }))

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

describe('assistant provider boundary (B-65: every round goes through src/ai/index.js + logAiUsage)', () => {
  const base = {
    messages: [], userMessage: 'hi', repo: 'owner/repo',
    ctx: { repo: 'owner/repo', pane: 'prs', selectedItem: null },
  }
  const json = (body, status = 200) => ({ ok: status < 300, status, json: async () => body })

  beforeEach(() => { vi.restoreAllMocks(); vi.clearAllMocks() })

  it('records one usage entry per Anthropic round, with null tokens when the provider reports none, and no prompt/tool payload', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(json({
        model: 'claude-x', usage: { input_tokens: 11, output_tokens: 3 },
        content: [{ type: 'tool_use', id: 'tu1', name: 'list_prs', input: { author: 'SECRET-PAYLOAD' } }],
      }))
      .mockResolvedValueOnce(json({ content: [{ type: 'text', text: 'ok' }] }))

    await runAssistantTurn({ ...base, userMessage: 'SECRET-PROMPT', aiConfig: { provider: 'anthropic', anthropicApiKey: 'sk-secret' } })

    expect(logAiUsage).toHaveBeenCalledTimes(2)
    expect(logAiUsage.mock.calls[0][0]).toMatchObject({ provider: 'anthropic-api', model: 'claude-x', tokensIn: 11, tokensOut: 3, success: true })
    expect(logAiUsage.mock.calls[1][0]).toMatchObject({ provider: 'anthropic-api', tokensIn: null, tokensOut: null, success: true })
    const logged = JSON.stringify(logAiUsage.mock.calls)
    for (const secret of ['SECRET-PROMPT', 'SECRET-PAYLOAD', 'sk-secret']) expect(logged).not.toContain(secret)
  })

  it('records OpenAI-compatible usage and a failed round as success:false', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(json({ model: 'm', usage: { prompt_tokens: 5, completion_tokens: 2 }, choices: [{ message: { role: 'assistant', content: 'a' } }] }))
      .mockResolvedValueOnce(json({}, 500))
    const cfg = { provider: 'ollama', openaiBaseUrl: 'http://localhost:11434/v1' }

    await runAssistantTurn({ ...base, aiConfig: cfg })
    const failed = await runAssistantTurn({ ...base, aiConfig: cfg })

    expect(logAiUsage.mock.calls[0][0]).toMatchObject({ provider: 'openai-compatible', tokensIn: 5, tokensOut: 2, success: true })
    expect(logAiUsage.mock.calls[1][0]).toMatchObject({ provider: 'openai-compatible', success: false })
    expect(failed.type).toBe('error')
  })

  it('surfaces provider errors, malformed responses and cancellation as error results', async () => {
    const cfg = { provider: 'anthropic', anthropicApiKey: 'k' }
    const fetchMock = vi.spyOn(globalThis, 'fetch')
    fetchMock.mockResolvedValueOnce(json({}, 401))
    expect(await runAssistantTurn({ ...base, aiConfig: cfg })).toMatchObject({ type: 'error', text: expect.stringMatching(/key/i) })
    fetchMock.mockResolvedValueOnce(json({ nope: true }))
    expect(await runAssistantTurn({ ...base, aiConfig: cfg })).toMatchObject({ type: 'error' })
    fetchMock.mockRejectedValueOnce(Object.assign(new Error('aborted'), { name: 'AbortError' }))
    expect(await runAssistantTurn({ ...base, aiConfig: cfg })).toMatchObject({ type: 'error', text: expect.stringMatching(/cancel/i) })
  })

  it('answers EVERY parallel tool call: one Anthropic user message holding all tool_results, mutating ones denied', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(json({ content: [
        { type: 'tool_use', id: 'a', name: 'list_prs', input: {} },
        { type: 'tool_use', id: 'b', name: 'merge_pr', input: { number: 1 } },
      ] }))
      .mockResolvedValueOnce(json({ content: [{ type: 'text', text: 'done' }] }))

    const result = await runAssistantTurn({ ...base, aiConfig: { provider: 'anthropic', anthropicApiKey: 'k' } })

    const last = JSON.parse(fetchMock.mock.calls[1][1].body).messages.at(-1)
    expect(last.role).toBe('user')
    expect(last.content.map(b => b.tool_use_id)).toEqual(['a', 'b'])
    expect(JSON.parse(last.content[1].content)).toMatchObject({ code: 'AI_MUTATIONS_DISABLED' })
    expect(result).toMatchObject({ type: 'answer', text: 'done' })
    expect(executor.mergePR).not.toHaveBeenCalled()
  })

  it('answers EVERY parallel tool call on OpenAI-compatible providers (one tool message per id)', async () => {
    const calls = ['x', 'y'].map(id => ({ id, type: 'function', function: { name: 'list_prs', arguments: '{}' } }))
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(json({ choices: [{ message: { role: 'assistant', content: '', tool_calls: calls } }] }))
      .mockResolvedValueOnce(json({ choices: [{ message: { role: 'assistant', content: 'done' } }] }))

    await runAssistantTurn({ ...base, aiConfig: { provider: 'openai', openaiApiKey: 'k' } })

    const sent = JSON.parse(fetchMock.mock.calls[1][1].body).messages
    expect(sent.slice(-2).map(m => [m.role, m.tool_call_id])).toEqual([['tool', 'x'], ['tool', 'y']])
  })

  it('aborts the in-flight request when the caller aborts', async () => {
    const ctl = new AbortController()
    vi.spyOn(globalThis, 'fetch').mockImplementationOnce((_u, init) => new Promise((_res, rej) => {
      init.signal.addEventListener('abort', () => rej(init.signal.reason))
    }))
    const pending = runAssistantTurn({ ...base, signal: ctl.signal, aiConfig: { provider: 'anthropic', anthropicApiKey: 'k' } })
    ctl.abort()
    expect(await pending).toMatchObject({ type: 'error', text: expect.stringMatching(/cancel/i) })
  })

  it('answers without an Anthropic key before making any request', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
    expect(await runAssistantTurn({ ...base, aiConfig: { provider: 'anthropic' } })).toMatchObject({ type: 'error', text: expect.stringMatching(/API key/) })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('keeps Anthropic HTTP in src/ai/providers/anthropic-api.js only', () => {
    const root = new URL('.', import.meta.url).pathname
    const offenders = []
    const walk = dir => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, e.name)
        if (e.isDirectory()) walk(p)
        else if (/\.jsx?$/.test(e.name) && !/\.test\./.test(e.name) && readFileSync(p, 'utf8').includes('api.anthropic.com')) offenders.push(p)
      }
    }
    walk(root)
    expect(offenders.map(p => p.replace(root, ''))).toEqual(['ai/providers/anthropic-api.js'])
  })
})
