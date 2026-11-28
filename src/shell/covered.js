/**
 * covered.js — the `covered` contract of the layered shell (#597, V3).
 *
 * A view that is mounted but not the one on screen (an overlay is open over it, or a deeper view
 * of the navigation stack was opened on top of it) is "covered". The shell keeps it mounted so its
 * state, cursor and scroll survive, and tells it so through this context:
 *
 *   - input: every listener registered through the focus manager (useInput, useKeyScope,
 *     useFocusEntry) is released while covered and re-claimed on uncover (src/focus/FocusProvider.js);
 *   - polling: a view's timers read `useCovered()`, or use `useCoveredInterval`, and pause (also
 *     while the app is idle, src/shell/activity.js);
 *   - output: the shell hides the layer with Ink's `display="none"`, so it costs no stdout bytes.
 */

import { createContext, useContext, useEffect, useRef } from 'react'
import { useIdle } from './activity.js'
import { tagTimer } from '../perf/vitals.js'

const CoveredContext = createContext(false)
export { CoveredContext }

/**
 * Whether the calling view is covered right now.
 * @returns {boolean} true while an overlay or a deeper view is on screen instead of this one
 */
export function useCovered() {
  return useContext(CoveredContext)
}

/**
 * setInterval that stops while the calling view is covered or the app is idle (#620) and resumes the
 * moment it is on screen and active again. A tick that came due while paused runs at once on resume
 * (so no stale data is shown after it); otherwise the rest of the period is waited out, so a short
 * overlay open/close costs nothing. The latest `fn` is always the one called.
 * @param {() => void} fn tick
 * @param {number} ms period in milliseconds; falsy or non-positive disables the timer
 * @param {string} [tag] code name of the timer for the vitals `wake` events
 */
export function useCoveredInterval(fn, ms, tag = 'poll') {
  const covered = useCovered()
  const idle = useIdle()
  const latest = useRef(fn)
  latest.current = fn
  const lastRun = useRef(/** @type {number | null} */ (null))
  const paused = covered || idle || !(ms > 0)
  useEffect(() => {
    if (paused) return undefined
    const now = Date.now()
    if (lastRun.current === null) lastRun.current = now
    const tick = tagTimer(tag, () => { lastRun.current = Date.now(); latest.current() })
    /** @type {ReturnType<typeof setInterval> | undefined} */
    let id
    const start = tagTimer(tag, () => { tick(); id = setInterval(tick, ms) })
    const due = lastRun.current + ms - now
    /** @type {ReturnType<typeof setTimeout> | undefined} */
    let first
    if (due <= 0) start()
    else if (due >= ms) id = setInterval(tick, ms) // a fresh start: a plain interval
    else first = setTimeout(start, due)
    return () => { clearTimeout(first); clearInterval(id) }
  }, [paused, ms, tag])
}
