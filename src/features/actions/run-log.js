// @ts-nocheck
/**
 * src/features/actions/run-log.js — run logs keyed by run id + attempt (V4b, #597).
 *
 * The log of a COMPLETED run attempt never changes, so it is read under a key that names the run,
 * its attempt and its last update (`updatedAt` moves on a re-run even where the run list does not
 * carry `attempt`) and kept for the life of that key (the `immutable` freshness class): reopening
 * the same run's log makes no gh call. A run that is still going keeps a 0 ms window, so it is read
 * again on every open while the earlier text stays on screen until the new one lands.
 *
 * The names of these functions are part of the query keys (`useGh` keys by `fn.name`).
 */

import { getRunLogs } from '../../executor.js'
import { loadFailureExcerpt } from '../prs/ci-log.js'

/** @param {{status?: string, conclusion?: string|null}} run */
export function runIsComplete(run) { return run?.status === 'completed' || Boolean(run?.conclusion) }

/**
 * The key parts that name one attempt of a run: `[runId, updatedAt, attempt]`.
 * @param run
 */
export function runLogKey(run) {
  const attempt = Number.isInteger(run?.attempt) ? run.attempt : undefined
  return [run?.databaseId, run?.updatedAt ?? '', attempt]
}

/**
 * `useGh` options for a run's log reads: immutable once the run is complete, never fresh before.
 * @returns {{ freshness: 'immutable' } | { ttl: number }}
 * @param run
 */
export function runLogFreshness(run) {
  return runIsComplete(run) ? { freshness: 'immutable' } : { ttl: 0 }
}

/**
 * The full log of one run attempt (`version` and `attempt` are key parts).
 * @param repo
 * @param runId
 * @param _version
 * @param attempt
 */
export async function getRunLogsAt(repo, runId, _version, attempt) {
  return attempt ? getRunLogs(repo, runId, attempt) : getRunLogs(repo, runId)
}

/** A failed-step excerpt state that may differ on the next read, so it must not be kept. */
export class ExcerptUnavailable extends Error {
  /**
   *
   * @param result
   */
  constructor(result) {
    super(result.detail || 'Could not fetch the failed-step log')
    this.name = 'ExcerptUnavailable'
    this.result = result
  }
}

const TRANSIENT = new Set(['pending', 'rate_limit', 'unavailable'])

/**
 * The failure excerpt of one run attempt. Permanent outcomes (ok, empty, expired, too large) are
 * returned and kept; transient ones (still running, rate limit, unavailable) throw so they are not
 * cached as if they were final.
 * @param repo
 * @param runId
 * @param _version
 * @param attempt
 */
export async function loadRunFailureExcerpt(repo, runId, _version, attempt) {
  const result = await loadFailureExcerpt(repo, { runId, ...(attempt ? { attempt } : {}) })
  if (TRANSIENT.has(result.state)) throw new ExcerptUnavailable(result)
  return result
}
