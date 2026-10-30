/**
 * ci-logs.js — typed READ-ONLY fetch of a failed GitHub Actions job's log
 * (issue #359, "Why is CI red?"). Everything goes through runGh(); args are
 * arrays; nothing here mutates.
 *
 * The log is untrusted text. This module only fetches and classifies the
 * outcome; parsing, redaction and sanitising live in
 * src/features/prs/ci-log.js. The capture is capped (maxBuffer) so a huge log
 * cannot balloon memory (#311): past the cap the state is 'too_large', never a
 * silently truncated or partial log.
 */

import { getRepo, runGh } from './core.js'

/** Hard cap on captured log bytes. */
export const MAX_LOG_BYTES = 8 * 1024 * 1024

/**
 * @typedef {'ok'|'empty'|'pending'|'expired'|'rate_limit'|'too_large'|'unavailable'} LogState
 * @typedef {{state: LogState, text: string, detail: string}} FailedLog
 */

const ID_RE = /^\d+$/

/**
 * Fetch the failed-step log of a workflow job (`gh run view --job N --log-failed`)
 * or of a whole run (`--run`). Never throws for an expected failure: the state
 * says what happened so the view can show it as unknown rather than guess.
 *
 * @param {string} repo
 * @param {{jobId?: string|number, runId?: string|number}} ref  exactly one id
 * @returns {Promise<FailedLog>}
 */
export async function getFailedLog(repo, ref = {}) {
  const jobId = ref.jobId === undefined ? null : String(ref.jobId)
  const runId = ref.runId === undefined ? null : String(ref.runId)
  if ((jobId === null) === (runId === null)) return { state: 'unavailable', text: '', detail: 'Need exactly one of jobId or runId' }
  if (!ID_RE.test(jobId ?? runId)) return { state: 'unavailable', text: '', detail: 'Invalid run or job id' }
  const args = jobId !== null
    ? ['run', 'view', '--job', jobId, '--repo', getRepo(repo), '--log-failed']
    : ['run', 'view', runId, '--repo', getRepo(repo), '--log-failed']
  try {
    const out = await runGh(args, { json: false, maxBuffer: MAX_LOG_BYTES, timeout: 60_000 })
    const text = typeof out === 'string' ? out : ''
    return text.trim() ? { state: 'ok', text, detail: '' } : { state: 'empty', text: '', detail: 'GitHub returned no failed-step log' }
  } catch (err) {
    return classifyLogError(err)
  }
}

/**
 * @param {any} err  GhError (or anything thrown)
 * @returns {FailedLog}
 */
export function classifyLogError(err) {
  const text = `${err?.message || ''}\n${err?.stderr || ''}`
  if (/maxBuffer/i.test(text)) return { state: 'too_large', text: '', detail: `Log is larger than ${MAX_LOG_BYTES / 1024 / 1024} MB` }
  if (/rate limit/i.test(text)) return { state: 'rate_limit', text: '', detail: 'GitHub API rate limit exceeded' }
  if (/still in progress|not complete|will be available when/i.test(text)) return { state: 'pending', text: '', detail: 'Run is still in progress' }
  if (/log not found|logs? (?:have )?expired|HTTP 410|HTTP 404|not found/i.test(text)) return { state: 'expired', text: '', detail: 'Log not found or expired' }
  return { state: 'unavailable', text: '', detail: 'Could not fetch the log' }
}
