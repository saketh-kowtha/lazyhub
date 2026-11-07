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
