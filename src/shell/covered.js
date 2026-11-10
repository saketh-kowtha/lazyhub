/**
 * covered.js — the `covered` contract of the layered shell (#597, V3).
 *
 * A view that is mounted but not the one on screen (an overlay is open over it, or a deeper view
 * of the navigation stack was opened on top of it) is "covered". The shell keeps it mounted so its
 * state, cursor and scroll survive, and tells it so through this context:
 *
 *   - input: every listener registered through the focus manager (useInput, useKeyScope,
 *     useFocusEntry) is released while covered and re-claimed on uncover (src/focus/FocusProvider.js);
 *   - polling: a view's timers read `useCovered()`, or use `useCoveredInterval`, and pause;
 *   - output: the shell hides the layer with Ink's `display="none"`, so it costs no stdout bytes.
 */

import { createContext, useContext, useEffect, useRef } from 'react'

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
 * setInterval that stops while the calling view is covered and starts again (a full period later)
 * once it is on screen again. The latest `fn` is always the one called.
 * @param {() => void} fn tick
 * @param {number} ms period in milliseconds; falsy or non-positive disables the timer
 */
export function useCoveredInterval(fn, ms) {
  const covered = useCovered()
  const latest = useRef(fn)
  latest.current = fn
  useEffect(() => {
    if (covered || !(ms > 0)) return undefined
    const id = setInterval(() => latest.current(), ms)
    return () => clearInterval(id)
  }, [covered, ms])
}
