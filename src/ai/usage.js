/**
 * src/ai/usage.js — AI usage logging wrapper.
 *
 * Centralizes usage recording for all AI providers.
 * Mirrors the project's existing logAiUsage() pattern.
 * tokens{In,Out} may be null for CLI providers — that is expected.
 */

/**
 * Log AI usage for telemetry / debugging.
 * Every provider call must go through this.
 *
 * @param {object} opts
 * @param {string}      opts.provider   - Provider id (e.g. 'claude-code', 'anthropic-api')
 * @param {string}      opts.model      - Model identifier actually used
 * @param {number|null} opts.tokensIn   - Input tokens used (null for CLI providers)
 * @param {number|null} opts.tokensOut  - Output tokens used (null for CLI providers)
 * @param {number}      opts.latencyMs  - Wall-clock latency in milliseconds
 * @param {boolean}     opts.success    - Whether the call succeeded
 */
export function logAiUsage({ provider, model, tokensIn, tokensOut, latencyMs, success }) {
  // Currently a structured console.debug; future: could write to ~/.config/lazyhub/usage.log
  // Keep the call signature stable so consumers need not change when telemetry is added.
  if (process.env.LAZYHUB_DEBUG_AI) {
    // eslint-disable-next-line no-console
    console.debug('[ai:usage]', { provider, model, tokensIn, tokensOut, latencyMs, success })
  }
}
