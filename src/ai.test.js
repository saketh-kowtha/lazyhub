/**
 * src/ai.test.js — Unit tests for the Anthropic API client
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { getAICodeReview, AIError } from './ai.js'

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeResponse(status, body) {
  return {
    ok:     status >= 200 && status < 300,
    status,
    json:   async () => body,
  }
}

function makeSuccessResponse(summary = 'Looks good.', suggestions = []) {
  return makeResponse(200, {
    content: [{ text: JSON.stringify({ summary, suggestions }) }],
  })
}

const BASE_OPTS = {
  diff:     '--- a/foo.js\n+++ b/foo.js\n@@ -1 +1 @@\n-old\n+new',
  prTitle:  'Fix bug',
  prBody:   'This fixes a critical bug.',
  apiKey:   'sk-ant-test-key',
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('getAICodeReview', () => {
  let fetchMock

  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('happy path — returns summary and suggestions', async () => {
    const suggestions = [
      { file: 'foo.js', line: 1, severity: 'bug', comment: 'Use const here' },
    ]
    fetchMock.mockResolvedValue(makeSuccessResponse('Changes look reasonable.', suggestions))

    const result = await getAICodeReview(BASE_OPTS)

    expect(result.summary).toBe('Changes look reasonable.')
    expect(result.suggestions).toHaveLength(1)
    expect(result.suggestions[0]).toEqual({
      file: 'foo.js', line: 1, severity: 'bug', comment: 'Use const here',
    })
  })

  it('strips unknown fields from suggestions', async () => {
    const suggestions = [
      { file: 'foo.js', line: 2, severity: 'warning', comment: 'Risky', unknownField: 'ignored' },
    ]
    fetchMock.mockResolvedValue(makeSuccessResponse('ok', suggestions))

    const result = await getAICodeReview(BASE_OPTS)
    const s = result.suggestions[0]

    expect(s).not.toHaveProperty('unknownField')
    expect(Object.keys(s)).toEqual(['file', 'line', 'severity', 'comment'])
  })

  it('unwraps markdown fenced JSON', async () => {
    const raw = '```json\n{"summary":"wrapped","suggestions":[]}\n```'
    fetchMock.mockResolvedValue(makeResponse(200, { content: [{ text: raw }] }))

    const result = await getAICodeReview(BASE_OPTS)
    expect(result.summary).toBe('wrapped')
    expect(result.suggestions).toEqual([])
  })

  it('HTTP 401 → AIError with "Invalid API key"', async () => {
    fetchMock.mockResolvedValue(makeResponse(401, {}))

    await expect(getAICodeReview(BASE_OPTS)).rejects.toThrow(AIError)
    await expect(getAICodeReview(BASE_OPTS)).rejects.toThrow('Invalid API key')
  })

  it('HTTP 429 → AIError containing "Rate limit"', async () => {
    fetchMock.mockResolvedValue(makeResponse(429, {}))

    const err = await getAICodeReview(BASE_OPTS).catch(e => e)
    expect(err).toBeInstanceOf(AIError)
    expect(err.message).toMatch(/Rate limit/)
    expect(err.status).toBe(429)
  })

  it('HTTP 500 → AIError containing "service error"', async () => {
    fetchMock.mockResolvedValue(makeResponse(500, {}))

    const err = await getAICodeReview(BASE_OPTS).catch(e => e)
    expect(err).toBeInstanceOf(AIError)
    expect(err.message).toMatch(/service error/)
    expect(err.status).toBe(500)
  })

  it('malformed JSON response → AIError "Could not parse"', async () => {
    fetchMock.mockResolvedValue(makeResponse(200, { content: [{ text: 'not json {{' }] }))

    const err = await getAICodeReview(BASE_OPTS).catch(e => e)
    expect(err).toBeInstanceOf(AIError)
    expect(err.message).toMatch(/Could not parse/)
  })

  it('missing suggestions field → AIError "unexpected"', async () => {
    fetchMock.mockResolvedValue(makeResponse(200, { content: [{ text: '{"summary":"ok"}' }] }))

    const err = await getAICodeReview(BASE_OPTS).catch(e => e)
    expect(err).toBeInstanceOf(AIError)
    expect(err.message).toMatch(/unexpected/)
  })

  it('unknown severity values are coerced to "suggestion"', async () => {
    const suggestions = [{ file: 'x.js', line: 1, severity: 'critical', comment: 'Bad' }]
    fetchMock.mockResolvedValue(makeSuccessResponse('ok', suggestions))

    const result = await getAICodeReview(BASE_OPTS)
    expect(result.suggestions[0].severity).toBe('suggestion')
  })

  it('diff > 8000 chars is truncated before sending', async () => {
    const longDiff = 'x'.repeat(10_000)
    fetchMock.mockResolvedValue(makeSuccessResponse('ok', []))

    await getAICodeReview({ ...BASE_OPTS, diff: longDiff })

    expect(fetchMock).toHaveBeenCalledOnce()
    const callBody = JSON.parse(fetchMock.mock.calls[0][1].body)
    const sentContent = callBody.messages[0].content
    // The user message should contain at most 8000 chars of diff content
    expect(sentContent.length).toBeLessThanOrEqual(
      // message includes title + body + labels + the 8000 char diff
      longDiff.length - 2000 + 8000 + 200  // rough upper bound
    )
    // Specifically, the diff portion should be truncated
    expect(sentContent).not.toContain('x'.repeat(8001))
  })

  it('null line values are preserved as null in suggestions', async () => {
    const suggestions = [{ file: 'readme.md', line: null, severity: 'suggestion', comment: 'Update docs' }]
    fetchMock.mockResolvedValue(makeSuccessResponse('ok', suggestions))

    const result = await getAICodeReview(BASE_OPTS)
    expect(result.suggestions[0].line).toBeNull()
  })
})
