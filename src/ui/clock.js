/**
 * src/ui/clock.js — one shared minute-granularity clock for relative times (#597, V5).
 *
 * Relative-time text ("3m ago") changes at most once a minute, so nothing needs its own
 * interval. Components that display a relative time call `useMinuteClock()`; they re-render
 * once per minute boundary and never in between. One timer serves every subscriber (also the status
 * bar's 10 s age tick, `useClock(10_000)`), runs only while somebody is subscribed, and does not keep
 * the process alive.
 *
 *   function Age({ ts }) { useMinuteClock(); return <Text>{format(ts)}</Text> }
 */

import { useCallback, useSyncExternalStore } from 'react'
import { tagTimer } from '../perf/vitals.js'
import { useCovered } from '../shell/covered.js'

const MINUTE_MS = 60_000
/** Land just after the boundary so Date.now() is already in the new period when we fire. */
const SLACK_MS = 20

/**
 * Subscribers and their period. One timer serves all of them and fires on the next boundary of
 * the finest period asked for (boundaries are epoch-aligned, so a minute boundary is also a 10 s
 * one); a listener is only called when its own period rolled over. This is the "shared clock"
 * of #620: the one timer allowed to wake an idle app.
 * @type {Map<() => void, { period: number, bucket: number }>}
 */
const subs = new Map()
/** @type {ReturnType<typeof setTimeout> | undefined} */
let timer
let scheduledPeriod = Infinity

/** The current minute number (epoch minutes). */
export function currentMinute() { return Math.floor(Date.now() / MINUTE_MS) }

function finest() {
  let p = Infinity
  for (const s of subs.values()) p = Math.min(p, s.period)
  return p
}

function schedule() {
  if (timer !== undefined) { clearTimeout(timer); timer = undefined }
  scheduledPeriod = finest()
  if (!Number.isFinite(scheduledPeriod)) return
  const delay = scheduledPeriod - (Date.now() % scheduledPeriod) + SLACK_MS
  timer = setTimeout(fire, delay)
  if (typeof timer === 'object' && typeof timer.unref === 'function') timer.unref()
}

const fire = tagTimer('clock', () => {
  timer = undefined
  const now = Date.now()
  for (const [listener, s] of [...subs]) {
    const bucket = Math.floor(now / s.period)
    if (bucket !== s.bucket && subs.has(listener)) { s.bucket = bucket; listener() }
  }
  schedule()
})

/**
 * Subscribe to boundaries of `periodMs` (epoch-aligned).
 * @param {number} periodMs
 * @param {() => void} listener
 * @returns {() => void} unsubscribe
 */
export function subscribeClock(periodMs, listener) {
  subs.set(listener, { period: periodMs, bucket: Math.floor(Date.now() / periodMs) })
  if (timer === undefined || periodMs < scheduledPeriod) schedule()
  return () => {
    subs.delete(listener)
    if (subs.size === 0) { if (timer !== undefined) clearTimeout(timer); timer = undefined; scheduledPeriod = Infinity }
    else if (finest() > scheduledPeriod) schedule()
  }
}

/**
 * Subscribe to minute boundaries.
 * @param {() => void} listener
 * @returns {() => void} unsubscribe
 */
export function subscribeMinuteClock(listener) {
  return subscribeClock(MINUTE_MS, listener)
}

/** Number of live subscribers (tests). */
export function minuteClockSubscribers() { return subs.size }

const noSubscription = () => () => {}

/**
 * Re-render the calling component once per `periodMs` boundary (0 or less: never; not while the
 * calling view is covered). Returns the
 * period number so a caller can use it as a memo dependency.
 * @param {number} periodMs
 * @returns {number}
 */
export function useClock(periodMs) {
  // A covered view does not subscribe; on uncover it subscribes again and React re-renders it at
  // once if the period rolled over meanwhile, so the text is never stale on screen (#620).
  const covered = useCovered()
  const on = periodMs > 0
  const subscribe = useCallback(listener => subscribeClock(periodMs, listener), [periodMs])
  const snapshot = useCallback(() => (on ? Math.floor(Date.now() / periodMs) : 0), [on, periodMs])
  return useSyncExternalStore(on && !covered ? subscribe : noSubscription, snapshot, snapshot)
}

/**
 * Re-render the calling component once per minute. Returns the minute number so a caller can
 * use it as a memo dependency.
 * @returns {number}
 */
export function useMinuteClock() {
  return useClock(MINUTE_MS)
}
