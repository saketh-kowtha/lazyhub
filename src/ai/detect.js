/**
 * src/ai/detect.js — Provider auto-detection and selection.
 *
 * Phase 1 priority: claude-code → anthropic-api
 * (codex → gemini-cli added in Phase 2)
 *
 * Override mechanisms (in order of precedence):
 *  1. LAZYHUB_AI_PROVIDER env var — hardest override, useful for CI
 *  2. Default priority list below
 *
 * Detection results are cached in-module for the session lifetime.
 * Call clearDetectionCache() in tests to reset.
 */

import * as claudeCode   from './providers/claude-code.js'
import * as codex        from './providers/codex.js'
import * as geminiCli    from './providers/gemini-cli.js'
import * as anthropicApi from './providers/anthropic-api.js'
import * as openaiCompatible from './providers/openai-compatible.js'
import { AIError } from './error.js'
import { loadConfig } from '../config/loader.js'

// ── Phase 2 priority list ─────────────────────────────────────────────────────
// Ordered: first available wins. CLI providers beat key-based so users with the
// CLI logged in get zero-config behaviour.

const PROVIDERS = [claudeCode, codex, geminiCli, anthropicApi, openaiCompatible]
const PROVIDER_FAMILY = {
  'claude-code': 'claude',
  'anthropic-api': 'claude',
  codex: 'codex',
  'gemini-cli': 'gemini',
  'openai-compatible': 'openai',
}

/**
 * @type {Array<{provider: object, result: {available: boolean, version?: string, reason?: string}}>|null}
 */
let _detectionCache = null

/**
 * Clear the in-memory detection cache (primarily for tests).
 */
export function clearDetectionCache() {
  _detectionCache = null
}

/**
 * Infer an AI/coding-agent family from a PR author hint.
 *
 * @param {object|string} authorHint
 * @returns {string|null}
 */
export function detectAuthorFamily(authorHint) {
  const login = String(authorHint?.login || authorHint || '').toLowerCase()
  if (!login) return null
  if (login.includes('copilot')) return 'copilot'
  if (login.startsWith('claude') || login.includes('anthropic')) return 'claude'
  if (login.startsWith('codex') || login.includes('openai')) return 'codex'
  if (login.startsWith('gemini') || login.includes('google-labs')) return 'gemini'
  return null
}

/**
 * Return the model family for a provider module.
 *
 * @param {object} provider
 * @returns {string|null}
 */
function familyForProvider(provider) {
  return PROVIDER_FAMILY[provider?.id] || provider?.id || null
}

async function selectMappedSecondOpinion(config, authorFamily, fallbackProvider) {
  const secondOpinion = config.ai?.second_opinion || {}
  if (secondOpinion.enabled === false || !authorFamily) return { provider: fallbackProvider, secondOpinion: null }
  const mappedId = secondOpinion.map?.[authorFamily]
  const allResults = await detectAll()
  const mapped = mappedId ? allResults.find(({ provider }) => provider.id === mappedId) : null
  const differentAvailable = allResults.find(({ provider, result }) =>
    result.available &&
    provider.id !== 'openai-compatible' &&
    familyForProvider(provider) !== authorFamily
  )
  const picked = mapped?.result?.available ? mapped : differentAvailable
  if (!picked) {
    return {
      provider: fallbackProvider,
      secondOpinion: {
        authorFamily,
        selected: fallbackProvider.id,
        fallback: true,
        note: 'second opinion fallback: no different configured provider available',
      },
    }
  }
  return {
    provider: picked.provider,
    secondOpinion: {
      authorFamily,
      selected: picked.provider.id,
      fallback: false,
    },
  }
}

/**
 * Run detection on all providers and return results.
 * Results are cached for the session after the first call.
 *
 * @returns {Promise<Array<{provider: object, result: object}>>}
 */
async function detectAll() {
  if (_detectionCache) return _detectionCache

  const results = await Promise.all(
    PROVIDERS.map(async p => {
      const result = await p.detect()
      return { provider: p, result }
    })
  )

  _detectionCache = results
  return results
}

/**
 * Select the best available provider.
 *
 * Honour LAZYHUB_AI_PROVIDER env override first.
 * Otherwise iterate the priority list and return the first available.
 *
 * @param {object} [root0]
 * @param {object|string} [root0.authorHint]
 * @returns {Promise<object>} The selected provider module
 */
export async function selectProvider({ authorHint } = {}) {
  const envOverride = process.env.LAZYHUB_AI_PROVIDER
  const config = loadConfig()
  const configOverride = config.defaults?.ai_provider === 'openai-compatible' ? 'openai-compatible' : null
  const forced = envOverride || configOverride
  if (forced) {
    const p = PROVIDERS.find(p => p.id === forced)
    if (!p) {
      throw new AIError(
        `AI provider "${forced}" is not known (supported: ${PROVIDERS.map(p => p.id).join(', ')})`,
        { code: 'no-provider' }
      )
    }
    const detection = await p.detect()
    if (!detection.available) {
      throw new AIError(
        `Provider "${forced}" is not available: ${detection.reason || 'unknown reason'}`,
        { code: 'provider-unavailable', provider: forced }
      )
    }
    return { provider: p, secondOpinion: null }
  }

  const allResults = await detectAll()
  const winner = allResults.find(({ provider, result }) => provider.id !== 'openai-compatible' && result.available)
  if (!winner) {
    throw new AIError(
      'No AI provider available. Install Claude Code, Codex, or Gemini CLI — or set ANTHROPIC_API_KEY.',
      { code: 'no-provider' }
    )
  }

  return selectMappedSecondOpinion(config, detectAuthorFamily(authorHint), winner.provider)
}

/**
 * Return a summary of all providers and their detection status.
 * Useful for the settings UI and `listProviders()` in index.js.
 *
 * @returns {Promise<Array<{id: string, displayName: string, available: boolean, version?: string, reason?: string}>>}
 */
export async function listProviderStatus() {
  const allResults = await detectAll()
  return allResults.map(({ provider, result }) => ({
    id:          provider.id,
    displayName: provider.displayName,
    available:   result.available,
    version:     result.version,
    reason:      result.reason,
  }))
}
