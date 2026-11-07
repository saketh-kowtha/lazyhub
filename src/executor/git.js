/**
 * src/executor/git.js — runGit(), the local git chokepoint (#479).
 *
 * The git counterpart of runGh(): every git process lazyhub starts goes through here, with the
 * same discipline.
 *   - the argv is classified first (`classifyGit`, next to `classifyGh`); only allowlisted reads and
 *     known writes run, anything else is refused;
 *   - a write is audited before it runs (intent) and after it settles (result), and a write whose audit
 *     entry cannot be written is blocked, exactly like a gh write;
 *   - the directory is always given by the caller. Nothing here defaults to `process.cwd()`, so a
 *     command can never act on a checkout that was not resolved for the viewed repo (#471).
 *
 * Arguments are always an array; nothing goes through a shell. Callers that need the exit code pass
 * `reject: false` and call `assertGitOk`.
 */

import { randomUUID } from 'node:crypto'
import { execa } from 'execa'
import { classifyGit } from '../daemon/protocol.js'
import { hashArgs, writeAuditEntry } from '../daemon/audit.js'

/** A hung git call must not block every later write in the view (#453). */
export const GIT_OP_TIMEOUT_MS = 60_000

/**
 * Throw for a failed or timed-out git result (reject:false results never throw themselves).
 * @param {{ exitCode?: number, timedOut?: boolean, stderr?: string, stdout?: string }} result
 * @param {string} what  e.g. 'git add'
 * @param {number} [timeoutMs] the timeout the call ran with, for the message
 */
export function assertGitOk(result, what, timeoutMs = GIT_OP_TIMEOUT_MS) {
  if (result.timedOut) throw new Error(`${what} timed out after ${timeoutMs / 1000} s`)
  if (result.exitCode !== 0) {
    throw new Error((result.stderr || result.stdout || `${what} failed`).split('\n')[0].trim())
  }
}

/**
 * Run one git command in `cwd`.
 *
 * @param {string[]} args argv after `git`
 * @param {object} opts
 * @param {string}  opts.cwd      checkout directory (required)
 * @param {number}  [opts.timeout] ms (default GIT_OP_TIMEOUT_MS)
 * @param {boolean} [opts.reject]  false to get the result for a non-zero exit instead of a throw (default true)
 * @param {string}  [opts.repo]    "owner/name" the directory was resolved for, recorded in the audit entry
 * @returns {Promise<any>} the execa result
 */
export async function runGit(args, opts) {
  const { cwd, timeout = GIT_OP_TIMEOUT_MS, reject = true, repo = null } = opts || {}
  if (typeof cwd !== 'string' || !cwd) throw new TypeError('runGit: cwd is required (resolve the checkout with findLocalCheckout)')
  const kind = classifyGit(args)
  if (kind === 'unknown') throw new Error('Operation is not an allowlisted git command')
  const run = () => execa('git', args, { cwd, timeout, reject })
  if (kind === 'read') return run()

  const reqId = randomUUID()
  try {
    writeAuditEntry({ phase: 'intent', reqId, op: `git ${args[0]}`, repo, argsHash: hashArgs(args) })
  } catch {
    throw new Error('Write blocked: audit log unavailable')
  }
  let outcome = 'error'
  try {
    const result = await run()
    outcome = result?.timedOut || result?.exitCode ? 'error' : 'ok'
    return result
  } finally {
    try { writeAuditEntry({ phase: 'result', reqId, outcome }) } catch { /* the write already happened */ }
  }
}
