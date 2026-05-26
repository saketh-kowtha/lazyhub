/**
 * src/ai/detect.test.js — Unit tests for provider auto-detection.
 *
 * Mocks provider detect() functions at the module level so tests
 * don't depend on whether `claude` is actually installed.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { AIError } from './error.js'

// ─── Mock the provider modules ────────────────────────────────────────────────

vi.mock('./providers/claude-code.js', () => ({
  id:          'claude-code',
  displayName: 'Claude Code',
  authSource:  '~/.claude',
  capabilities: { systemPrompt: true, jsonMode: false, promptCaching: false },
  detect:      vi.fn(),
  complete:    vi.fn(),
}))

vi.mock('./providers/codex.js', () => ({
  id:          'codex',
  displayName: 'Codex CLI',
  authSource:  '~/.codex',
  capabilities: { systemPrompt: true, jsonMode: false, promptCaching: false },
  detect:      vi.fn(),
  complete:    vi.fn(),
}))

vi.mock('./providers/gemini-cli.js', () => ({
  id:          'gemini-cli',
  displayName: 'Gemini CLI',
  authSource:  '~/.gemini',
  capabilities: { systemPrompt: true, jsonMode: true, promptCaching: false },
  detect:      vi.fn(),
  complete:    vi.fn(),
}))

vi.mock('./providers/anthropic-api.js', () => ({
  id:          'anthropic-api',
  displayName: 'Anthropic API',
  authSource:  'ANTHROPIC_API_KEY',
  capabilities: { systemPrompt: true, jsonMode: false, promptCaching: true },
  detect:      vi.fn(),
  complete:    vi.fn(),
}))

// Import after mocks are registered
const { selectProvider, listProviderStatus, clearDetectionCache } = await import('./detect.js')
const { listProviders } = await import('./index.js')
const claudeCodeMod   = await import('./providers/claude-code.js')
const codexMod        = await import('./providers/codex.js')
const geminiCliMod    = await import('./providers/gemini-cli.js')
const anthropicApiMod = await import('./providers/anthropic-api.js')

// ─── Helpers ─────────────────────────────────────────────────────────────────

beforeEach(() => {
  clearDetectionCache()
  delete process.env.LAZYHUB_AI_PROVIDER
  // Default: all unavailable
  claudeCodeMod.detect.mockResolvedValue({ available: false, reason: 'claude not found' })
  codexMod.detect.mockResolvedValue({ available: false, reason: 'codex not found' })
  geminiCliMod.detect.mockResolvedValue({ available: false, reason: 'gemini not found' })
  anthropicApiMod.detect.mockResolvedValue({ available: false, reason: 'ANTHROPIC_API_KEY is not set' })
})

afterEach(() => {
  clearDetectionCache()
  delete process.env.LAZYHUB_AI_PROVIDER
  vi.clearAllMocks()
  // Reset all provider mocks to default unavailable state
  claudeCodeMod.detect.mockResolvedValue({ available: false, reason: 'claude not found' })
  codexMod.detect.mockResolvedValue({ available: false, reason: 'codex not found' })
  geminiCliMod.detect.mockResolvedValue({ available: false, reason: 'gemini not found' })
  anthropicApiMod.detect.mockResolvedValue({ available: false, reason: 'ANTHROPIC_API_KEY is not set' })
})

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('selectProvider', () => {
  it('throws no-provider when neither provider is available', async () => {
    const err = await selectProvider().catch(e => e)
    expect(err).toBeInstanceOf(AIError)
    expect(err.code).toBe('no-provider')
  })

  it('uses anthropic-api when it is the only available provider', async () => {
    anthropicApiMod.detect.mockResolvedValue({ available: true })
    const provider = await selectProvider()
    expect(provider.id).toBe('anthropic-api')
  })

  it('uses claude-code when multiple are available (priority order)', async () => {
    claudeCodeMod.detect.mockResolvedValue({ available: true, version: '1.0.0' })
    codexMod.detect.mockResolvedValue({ available: true })
    geminiCliMod.detect.mockResolvedValue({ available: true })
    anthropicApiMod.detect.mockResolvedValue({ available: true })
    const provider = await selectProvider()
    expect(provider.id).toBe('claude-code')
  })

  it('LAZYHUB_AI_PROVIDER=anthropic-api forces that provider when available', async () => {
    anthropicApiMod.detect.mockResolvedValue({ available: true })
    process.env.LAZYHUB_AI_PROVIDER = 'anthropic-api'
    const provider = await selectProvider()
    expect(provider.id).toBe('anthropic-api')
  })

  it('LAZYHUB_AI_PROVIDER=codex forces it even if claude-code is available', async () => {
    claudeCodeMod.detect.mockResolvedValue({ available: true, version: '1.0.0' })
    codexMod.detect.mockResolvedValue({ available: true })
    process.env.LAZYHUB_AI_PROVIDER = 'codex'
    const provider = await selectProvider()
    expect(provider.id).toBe('codex')
  })

  it('LAZYHUB_AI_PROVIDER with unknown id throws no-provider', async () => {
    process.env.LAZYHUB_AI_PROVIDER = 'nonexistent-provider'
    const err = await selectProvider().catch(e => e)
    expect(err).toBeInstanceOf(AIError)
    expect(err.code).toBe('no-provider')
  })

  it('LAZYHUB_AI_PROVIDER=anthropic-api throws provider-unavailable when not available', async () => {
    // anthropicApiMod.detect returns unavailable by default (from beforeEach)
    process.env.LAZYHUB_AI_PROVIDER = 'anthropic-api'
    const err = await selectProvider().catch(e => e)
    expect(err).toBeInstanceOf(AIError)
    expect(err.code).toBe('provider-unavailable')
  })
})

describe('listProviderStatus', () => {
  it('returns an array with all provider entries', async () => {
    const list = await listProviderStatus()
    expect(Array.isArray(list)).toBe(true)
    expect(list.length).toBeGreaterThanOrEqual(4)
    const ids = list.map(p => p.id)
    expect(ids).toContain('claude-code')
    expect(ids).toContain('codex')
    expect(ids).toContain('gemini-cli')
    expect(ids).toContain('anthropic-api')
  })

  it('anthropic-api shows available when detect returns true', async () => {
    anthropicApiMod.detect.mockResolvedValue({ available: true })
    const list = await listProviderStatus()
    const api = list.find(p => p.id === 'anthropic-api')
    expect(api.available).toBe(true)
  })

  it('anthropic-api shows unavailable with reason', async () => {
    const list = await listProviderStatus()
    const api = list.find(p => p.id === 'anthropic-api')
    expect(api.available).toBe(false)
    expect(api.reason).toMatch(/ANTHROPIC_API_KEY/)
  })

  it('detection results are cached after first call', async () => {
    const list1 = await listProviderStatus()
    const list2 = await listProviderStatus()
    // detect() should only have been called once per provider (cached)
    expect(claudeCodeMod.detect).toHaveBeenCalledTimes(1)
    expect(codexMod.detect).toHaveBeenCalledTimes(1)
    expect(geminiCliMod.detect).toHaveBeenCalledTimes(1)
    expect(anthropicApiMod.detect).toHaveBeenCalledTimes(1)
    expect(list1).toEqual(list2)
  })

  it('clearDetectionCache forces re-detection on next call', async () => {
    await listProviderStatus()
    clearDetectionCache()
    await listProviderStatus()
    // After clearing, detect() should have been called again for each provider
    expect(claudeCodeMod.detect).toHaveBeenCalledTimes(2)
    expect(codexMod.detect).toHaveBeenCalledTimes(2)
    expect(geminiCliMod.detect).toHaveBeenCalledTimes(2)
    expect(anthropicApiMod.detect).toHaveBeenCalledTimes(2)
  })
})

describe('priority order', () => {
  it('providers are ordered: claude-code, codex, gemini-cli, anthropic-api', async () => {
    const list = await listProviderStatus()
    const ccIdx     = list.findIndex(p => p.id === 'claude-code')
    const codexIdx  = list.findIndex(p => p.id === 'codex')
    const geminiIdx = list.findIndex(p => p.id === 'gemini-cli')
    const apiIdx    = list.findIndex(p => p.id === 'anthropic-api')
    expect(ccIdx).toBeLessThan(codexIdx)
    expect(codexIdx).toBeLessThan(geminiIdx)
    expect(geminiIdx).toBeLessThan(apiIdx)
  })
})

describe('listProviders (index.js re-export)', () => {
  it('returns same shape as listProviderStatus', async () => {
    const list = await listProviders()
    expect(Array.isArray(list)).toBe(true)
    for (const p of list) {
      expect(p).toHaveProperty('id')
      expect(p).toHaveProperty('displayName')
      expect(p).toHaveProperty('available')
    }
  })
})
