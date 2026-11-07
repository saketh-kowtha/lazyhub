/**
 * src/contain.js — error containment for input handlers (#490).
 *
 * Key handlers run from stdin events, outside React's render, so an ErrorBoundary never
 * sees what they throw and the process-level crash handler would end the session. Every
 * handler passes through containHandler(): a throw (or a rejected promise) is logged with
 * its scope, recorded as a short-lived toast for the status bar, and the app keeps running.
 *
 * Pure state, no React and no Ink, so the status-bar health snapshot can subscribe.
 */

import { logger } from './utils-core.js'

/** How long the toast stays up. */
export const TOAST_MS = 6000

let toast = null
let timer = null
const listeners = new Set()

/** The toast text for the status bar, or null. */
export function getContainedToast() {
  return toast
}

/**
 * Subscribe to toast changes.
 * @param {(toast: string|null) => void} listener
 * @returns {() => void} unsubscribe
 */
export function onContained(listener) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function setToast(next) {
  toast = next
  for (const listener of listeners) listener(next)
}

/** Clear the toast (tests). */
export function resetContained() {
  if (timer) clearTimeout(timer)
  timer = null
  if (toast !== null) setToast(null)
}

/**
 * Log a contained failure and raise the toast.
 * @param {string} scope where it happened, e.g. 'key' or an action id
 * @param {unknown} err
 */
export function reportContained(scope, err) {
  const message = err instanceof Error ? err.message : String(err)
  try { logger.error(`contained error in ${scope}`, err instanceof Error ? err : new Error(message)) } catch { /* logging must not rethrow */ }
  if (timer) clearTimeout(timer)
  setToast(`Something went wrong in ${scope} (see the log): ${message.split('\n')[0].slice(0, 120)}`)
  timer = setTimeout(() => { timer = null; setToast(null) }, TOAST_MS)
  timer.unref?.()
}

/**
 * Wrap an input handler so nothing it throws, synchronously or through a returned
 * promise, escapes to the process.
 * @template {(...args: any[]) => any} F
 * @param {F} handler
 * @param {string} [scope]
 * @returns {F}
 */
export function containHandler(handler, scope = 'a key handler') {
  const wrapped = (...args) => {
    try {
      const result = handler(...args)
      if (result && typeof result.then === 'function') result.then(undefined, err => reportContained(scope, err))
      return result
    } catch (err) {
      reportContained(scope, err)
      return undefined
    }
  }
  return /** @type {F} */ (wrapped)
}

// ─── Errors that are deliberately absorbed (#490 R12) ──────────────────────

const SWALLOW_LIMIT = 50
const SWALLOW_REPEAT_MS = 5000
const swallowed = []
const lastSeen = new Map()

/** Recent absorbed errors, recorded only when LAZYHUB_DEBUG is set. For the debug-state snapshot. */
export function getSwallowed() {
  return swallowed.slice()
}

/** Forget absorbed errors (tests). */
export function resetSwallowed() {
  swallowed.length = 0
  lastSeen.clear()
}

/**
 * Record an error a UI path chose to absorb, instead of an empty `catch {}`.
 * Always logs at debug level; with LAZYHUB_DEBUG set it is also kept for the debug-state
 * snapshot. The same scope and message repeats at most once per five seconds so a hot
 * path cannot flood the log. Never throws.
 * @param {string} scope where it happened, e.g. 'issues.list.optimistic-insert'
 * @param {unknown} err
 */
export function logSwallowed(scope, err) {
  try {
    const message = err instanceof Error ? err.message : String(err)
    const key = `${scope}\u0000${message}`
    const now = Date.now()
    if (now - (lastSeen.get(key) ?? 0) < SWALLOW_REPEAT_MS) return
    lastSeen.set(key, now)
    if (lastSeen.size > 200) lastSeen.clear()
    logger.debug(`swallowed error in ${scope}`, { error: message })
    if (process.env.LAZYHUB_DEBUG) {
      swallowed.push({ scope, message: message.split('\n')[0].slice(0, 200), at: new Date(now).toISOString() })
      if (swallowed.length > SWALLOW_LIMIT) swallowed.shift()
    }
  } catch { /* absorbing an error must not raise one */ }
}
