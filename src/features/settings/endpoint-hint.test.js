import { describe, expect, it } from 'vitest'
import { endpointHint } from './endpoint-hint.js'

describe('endpointHint', () => {
  it('labels known providers by hostname', () => {
    expect(endpointHint('https://api.groq.com/openai/v1')).toBe('Groq')
    expect(endpointHint('https://api.together.xyz/v1')).toBe('Together')
    expect(endpointHint('https://api.fireworks.ai/inference/v1')).toBe('Fireworks')
    expect(endpointHint('https://res.openai.azure.com/v1')).toBe('Azure OpenAI')
    expect(endpointHint('https://api.openai.com/v1')).toBe('OpenAI')
    expect(endpointHint('https://api.mistral.ai/v1')).toBe('Mistral')
    expect(endpointHint('https://api.deepseek.com')).toBe('DeepSeek')
    expect(endpointHint('https://api.x.ai/v1')).toBe('xAI')
  })

  it('labels local endpoints with their port', () => {
    expect(endpointHint('http://localhost:11434/v1')).toBe('local :11434')
    expect(endpointHint('http://127.0.0.1/v1')).toBe('local')
  })

  it('ignores provider names that appear only in the path, query or a look-alike host', () => {
    expect(endpointHint('https://example.org/groq.com')).toBe('example.org')
    expect(endpointHint('https://example.org/v1?next=localhost')).toBe('example.org')
    expect(endpointHint('https://notgroq.com/v1')).toBe('notgroq.com')
    expect(endpointHint('https://groq.com.evil.test/v1')).toBe('groq.com.evil.test')
  })

  it('falls back to the raw host for an unparseable URL', () => {
    expect(endpointHint('my-host/v1')).toBe('my-host')
  })
})
