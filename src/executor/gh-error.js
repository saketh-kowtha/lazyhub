/**
 * gh-error.js — the error type thrown by `runGh()` in executor.js.
 *
 * Carries the sanitized stderr, exit code, and args so callers can render an
 * actionable message without re-parsing gh output. Lives in its own module so
 * the executor and its tests (and future contract tests) share one definition.
 */

/**
 * Error thrown on a non-zero `gh` exit, a timeout, or a spawn failure.
 */
export class GhError extends Error {
  /**
   * @param {object} root0          - error fields
   * @param {string} root0.message  - short, sanitized, human-readable summary
   * @param {string} root0.stderr   - sanitized stderr from the gh process
   * @param {number} root0.exitCode - process exit code (1 when unknown)
   * @param {string[]} root0.args   - sanitized argv passed to gh
   */
  constructor({ message, stderr, exitCode, args }) {
    super(message)
    this.name = 'GhError'
    this.stderr = stderr
    this.exitCode = exitCode
    this.args = args
  }
}
