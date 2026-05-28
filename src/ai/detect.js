/** detect.js — AI provider auto-detection and selection logic. */
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
import { AIError } from './error.js'

// ── Phase 2 priority list ─────────────────────────────────────────────────────
// Ordered: first available wins. CLI providers beat key-based so users with the
// CLI logged in get zero-config behaviour.

const PROVIDERS = [claudeCode, codex, geminiCli, anthropicApi]

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
 * @returns {Promise<object>} The selected provider module
 */
export async function selectProvider() {
  const envOverride = process.env.LAZYHUB_AI_PROVIDER
  if (envOverride) {
    const p = PROVIDERS.find(p => p.id === envOverride)
    if (!p) {
      throw new AIError(
        `LAZYHUB_AI_PROVIDER="${envOverride}" is not a known provider (supported: ${PROVIDERS.map(p => p.id).join(', ')})`,
        { code: 'no-provider' }
      )
    }
    const detection = await p.detect()
    if (!detection.available) {
      throw new AIError(
        `Provider "${envOverride}" is not available: ${detection.reason || 'unknown reason'}`,
        { code: 'provider-unavailable', provider: envOverride }
      )
    }
    return p
  }

  const allResults = await detectAll()
  const winner = allResults.find(({ result }) => result.available)
  if (!winner) {
    throw new AIError(
      'No AI provider available. Install Claude Code, Codex, or Gemini CLI — or set ANTHROPIC_API_KEY.',
      { code: 'no-provider' }
    )
  }

  return winner.provider
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
