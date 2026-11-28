/**
 * src/ui/animation.js — the single animation slot (#597, V5).
 *
 * At most one element on screen animates. Spinners and the activity indicator claim the slot;
 * the first claimant animates and every other one renders a static frame, so a screen full
 * of "loading" leaves still costs one tick stream, not one per leaf. The tick is >= 120 ms and
 * only the owning leaf re-renders on it, never its parents (the state lives in this store).
 * A leaf in a covered view does not claim the slot, and the tick stops while the app is idle and
 * restarts on the next key (#620), so a still screen costs no wakeups.
 *
 *   const frame = useAnimationFrame(FRAMES.length, active)   // -1 when not the animated one
 */

import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react'
import { useCovered } from '../shell/covered.js'
import { isIdle, subscribeIdle } from '../shell/activity.js'
import { tagTimer } from '../perf/vitals.js'

/** Minimum time between animation frames. */
export const TICK_MS = 120

/** @type {object[]} claim tokens, in claim order; the first one animates */
const claimants = []
/** @type {Set<() => void>} */
const listeners = new Set()
let frame = 0
/** @type {ReturnType<typeof setInterval> | undefined} */
let timer

function emit() { for (const l of [...listeners]) l() }
function subscribe(l) { listeners.add(l); return () => { listeners.delete(l) } }

/** @type {(() => void) | undefined} idle subscription, held only while somebody claims the slot */
let offIdle

function sync() {
  if (claimants.length > 0 && !offIdle) offIdle = subscribeIdle(sync)
  else if (claimants.length === 0 && offIdle) { offIdle(); offIdle = undefined }
  const run = claimants.length > 0 && !isIdle()
  if (run && timer === undefined) {
    timer = setInterval(tick, TICK_MS)
    if (typeof timer === 'object' && typeof timer.unref === 'function') timer.unref()
  } else if (!run && timer !== undefined) {
    clearInterval(timer)
    timer = undefined
    if (claimants.length === 0) frame = 0
  }
}

const tick = tagTimer('anim', () => { frame += 1; emit() })

function claim(token) {
  claimants.push(token)
  sync()
  emit()
  return () => {
    const i = claimants.indexOf(token)
    if (i !== -1) claimants.splice(i, 1)
    sync()
    emit()
  }
}

/** Whether something currently animates (tests). */
export function animationActive() { return claimants.length > 0 && timer !== undefined }

/** Whether any leaf holds the slot, ticking or paused for idle (tests). */
export function animationClaimed() { return claimants.length > 0 }

/**
 * @param {number} frames number of frames in the cycle
 * @param {boolean} [active] false releases the claim (the leaf is idle)
 * @returns {number} frame index when this leaf owns the animation, else -1 (draw a static frame)
 */
export function useAnimationFrame(frames, active = true) {
  const token = useRef({}).current
  const covered = useCovered()
  const on = active && !covered
  useEffect(() => (on ? claim(token) : undefined), [on, token])
  const getSnapshot = useCallback(
    () => (on && claimants[0] === token ? frame % frames : -1),
    [on, token, frames],
  )
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}
