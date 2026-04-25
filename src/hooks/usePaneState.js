/**
 * usePaneState — preserve list/pane view state across navigation.
 *
 * State is stored in a Map on AppContext (via paneStateRef).
 * Survives PRList unmount (back-nav from detail/diff).
 * Cleared on explicit pane-switch (Tab, number key) by the App.
 *
 * Usage:
 *   const [state, setState] = usePaneState('prs', { cursor: 0, scrollOffset: 0, filterState: 'open', ... })
 */

import { useContext, useRef, useCallback } from 'react'
import { AppContext } from '../context.js'

export function usePaneState(paneId, defaults) {
  const ctx = useContext(AppContext)
  const mapRef = ctx.paneStateMap  // Map<string, object> on AppContext

  // Read once on mount — stable initial value for useState
  const initialRef = useRef(null)
  if (initialRef.current === null) {
    initialRef.current = mapRef ? { ...defaults, ...(mapRef.get(paneId) || {}) } : defaults
  }

  const setState = useCallback((partial) => {
    if (!mapRef) return
    const prev = mapRef.get(paneId) || defaults
    mapRef.set(paneId, { ...prev, ...partial })
  }, [paneId, mapRef]) // eslint-disable-line react-hooks/exhaustive-deps

  return [initialRef.current, setState]
}
