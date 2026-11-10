/**
 * src/ui/clock.js — one shared minute-granularity clock for relative times (#597, V5).
 *
 * Relative-time text ("3m ago") changes at most once a minute, so nothing needs its own
 * interval. Components that display a relative time call `useMinuteClock()`; they re-render
 * once per minute boundary and never in between. One timer serves every subscriber, runs only
 * while somebody is subscribed, and does not keep the process alive.
 *
 *   function Age({ ts }) { useMinuteClock(); return <Text>{format(ts)}</Text> }
 */

import { useSyncExternalStore } from 'react'

const MINUTE_MS = 60_000
/** Land just after the boundary so Date.now() is already in the new minute when we fire. */
const SLACK_MS = 20

/** @type {Set<() => void>} */
const listeners = new Set()
/** @type {ReturnType<typeof setTimeout> | undefined} */
let timer

/** The current minute number (epoch minutes). */
export function currentMinute() { return Math.floor(Date.now() / MINUTE_MS) }

function schedule() {
  const delay = MINUTE_MS - (Date.now() % MINUTE_MS) + SLACK_MS
  timer = setTimeout(() => {
    timer = undefined
    for (const l of [...listeners]) l()
    if (listeners.size > 0) schedule()
  }, delay)
  if (typeof timer === 'object' && typeof timer.unref === 'function') timer.unref()
}

/**
 * Subscribe to minute boundaries.
 * @param {() => void} listener
 * @returns {() => void} unsubscribe
 */
export function subscribeMinuteClock(listener) {
  listeners.add(listener)
  if (timer === undefined) schedule()
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0 && timer !== undefined) { clearTimeout(timer); timer = undefined }
  }
}

/** Number of live subscribers (tests). */
export function minuteClockSubscribers() { return listeners.size }

/**
 * Re-render the calling component once per minute. Returns the minute number so a caller can
 * use it as a memo dependency.
 * @returns {number}
 */
export function useMinuteClock() {
  return useSyncExternalStore(subscribeMinuteClock, currentMinute, currentMinute)
}
