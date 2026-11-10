/**
 * src/ui/animation.js — the single animation slot (#597, V5).
 *
 * At most one element on screen animates. Spinners and the activity indicator claim the slot;
 * the first claimant animates and every other one renders a static frame, so a screen full
 * of "loading" leaves still costs one tick stream, not one per leaf. The tick is >= 120 ms and
 * only the owning leaf re-renders on it, never its parents (the state lives in this store).
 *
 *   const frame = useAnimationFrame(FRAMES.length, active)   // -1 when not the animated one
 */

import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react'

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

function sync() {
  if (claimants.length > 0 && timer === undefined) {
    timer = setInterval(() => { frame += 1; emit() }, TICK_MS)
    if (typeof timer === 'object' && typeof timer.unref === 'function') timer.unref()
  } else if (claimants.length === 0 && timer !== undefined) {
    clearInterval(timer)
    timer = undefined
    frame = 0
  }
}

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

/**
 * @param {number} frames number of frames in the cycle
 * @param {boolean} [active] false releases the claim (the leaf is idle)
 * @returns {number} frame index when this leaf owns the animation, else -1 (draw a static frame)
 */
export function useAnimationFrame(frames, active = true) {
  const token = useRef({}).current
  useEffect(() => (active ? claim(token) : undefined), [active, token])
  const getSnapshot = useCallback(
    () => (active && claimants[0] === token ? frame % frames : -1),
    [active, token, frames],
  )
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}
