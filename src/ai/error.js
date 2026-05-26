/**
 * src/ai/error.js — AIError class definition.
 *
 * Standalone module to avoid circular imports between index.js, parse.js,
 * detect.js, and the provider modules.
 */

/**
 * Error thrown when any AI provider call fails.
 *
 * @property {string}  code     - Stable error code (see list below)
 * @property {string}  provider - Provider id that threw
 * @property {number}  [status] - HTTP status code (anthropic-api only)
 *
 * Error codes:
 *   'no-provider'          — no provider available
 *   'provider-unavailable' — chosen provider stopped working
 *   'auth-required'        — CLI exists but not logged in / no API key
 *   'timeout'              — subprocess or HTTP call timed out
 *   'rate-limited'         — provider returned 429-equivalent
 *   'malformed-response'   — response parse failed
 *   'spawn-failed'         — execFile error (ENOENT, EACCES)
 */
export class AIError extends Error {
  /**
   * @param {string} message
   * @param {object} [opts]
   * @param {string} [opts.code]      - Stable error code
   * @param {string} [opts.provider]  - Provider id
   * @param {number} [opts.status]    - HTTP status (API provider only)
   * @param {Error}  [opts.cause]     - Underlying error
   */
  constructor(message, { code, provider, status, cause } = {}) {
    super(message)
    this.name     = 'AIError'
    this.code     = code     || null
    this.provider = provider || null
    this.status   = status   || null
    if (cause) this.cause = cause
  }
}
