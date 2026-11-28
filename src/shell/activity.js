/**
 * activity.js — is the user idle? (#620, zero work while idle)
 *
 * The app is "idle" once no key has arrived for `IDLE_AFTER_MS`. Background timers (view polls,
 * skeleton pulses, spinners) read `useIdle()` and stop; the next key ends the idle state and they
 * resume at once (a poll that came due while paused runs immediately, see `useCoveredInterval`).
 *
 * The detector costs nothing while idle: one timeout is armed only while somebody subscribes and the
 * app is active. A key does not re-arm it; when it fires it re-arms for the time that is left, so a
 * busy session wakes it at most once per `IDLE_AFTER_MS`, and the idle transition is its last wakeup.
 *
 *   const idle = useIdle()          // true after IDLE_AFTER_MS without a key
 *   noteActivity()                  // the root input listener calls this on every key
 */

import { useSyncExternalStore } from 'react'
import { tagTimer } from '../perf/vitals.js'

/** Default time without a key before the app counts as idle. */
export const DEFAULT_IDLE_AFTER_MS = 120_000

/** LAZYHUB_IDLE_MS overrides it (the vitals harness uses a short one to measure the idle state). */
export const IDLE_AFTER_MS = (() => {
  const n = Number(process.env.LAZYHUB_IDLE_MS)
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_IDLE_AFTER_MS
})()

let idleAfterMs = IDLE_AFTER_MS
let lastInput = Date.now()
let idle = false
/** @type {Set<() => void>} */
const listeners = new Set()
/** @type {ReturnType<typeof setTimeout> | undefined} */
let timer

function emit() { for (const l of [...listeners]) l() }

function disarm() {
  if (timer !== undefined) { clearTimeout(timer); timer = undefined }
}

function arm() {
  if (timer !== undefined || idle || listeners.size === 0) return
  const left = Math.max(0, lastInput + idleAfterMs - Date.now())
  timer = setTimeout(tagTimer('idle', check), left)
  if (typeof timer === 'object' && typeof timer.unref === 'function') timer.unref()
}

function check() {
  timer = undefined
  if (Date.now() - lastInput >= idleAfterMs) { idle = true; emit() } else arm()
}

/** Record user input (every key). Ends the idle state at once. */
export function noteActivity() {
  lastInput = Date.now()
  if (idle) { idle = false; emit() }
  arm()
}

/** @returns {boolean} true while no key has arrived for the idle period */
export function isIdle() { return idle }

/**
 * @param {() => void} listener called on every idle <-> active change
 * @returns {() => void} unsubscribe
 */
export function subscribeIdle(listener) {
  listeners.add(listener)
  arm()
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0) disarm()
  }
}

/** Re-render on idle <-> active changes. @returns {boolean} idle */
export function useIdle() {
  return useSyncExternalStore(subscribeIdle, isIdle, isIdle)
}

/**
 * Tests: start active, optionally with a different idle period.
 * @param {number} [ms]
 */
export function resetActivity(ms = IDLE_AFTER_MS) {
  disarm()
  idleAfterMs = ms
  lastInput = Date.now()
  const was = idle
  idle = false
  if (was) emit()
  arm()
}
