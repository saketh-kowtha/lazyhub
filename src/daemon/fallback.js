/**
 * src/daemon/fallback.js — visible record of "running without the background helper" (#491).
 *
 * Pure state, no React and no I/O, so the executor and the launcher can set it and the
 * status bar can show it. A missing helper never blocks anything (reads go straight to
 * gh); this only makes the degraded mode visible instead of silent.
 */

/** Wording shown to the user. Deliberately plain: what happened and what it costs. */
export const DAEMON_FALLBACK_NOTICE = 'running without the background helper (reads are uncached)'

/** After a failed daemon read, skip the daemon for this long so a hung helper cannot add its timeout to every read. */
export const DAEMON_RETRY_AFTER_MS = 30_000

let reason = null
let suspendedUntil = 0
const listeners = new Set()

/** The notice to display, or null when the helper is in use or was never wanted. */
export function getDaemonFallback() {
  return reason ? DAEMON_FALLBACK_NOTICE : null
}

/**
 * Record that the helper is unavailable.
 * @param {string} why short machine-readable reason (not shown)
 * @param {{ retryAfterMs?: number }} [opts] also stop trying the helper for this long
 */
export function noteDaemonFallback(why, { retryAfterMs = 0 } = {}) {
  if (retryAfterMs > 0) suspendedUntil = Date.now() + retryAfterMs
  if (reason === why) return
  reason = why
  for (const listener of listeners) listener(getDaemonFallback())
}

/** Record that the helper is usable again. */
export function clearDaemonFallback() {
  suspendedUntil = 0
  if (reason === null) return
  reason = null
  for (const listener of listeners) listener(null)
}

/** True while a recent failure says not to try the helper yet. */
export function daemonReadsSuspended() {
  return Date.now() < suspendedUntil
}

/**
 * Subscribe to changes of the notice.
 * @param {(notice: string|null) => void} listener
 * @returns {() => void} unsubscribe
 */
export function onDaemonFallback(listener) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
