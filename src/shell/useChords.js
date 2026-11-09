/**
 * useChords.js — the two timed key windows of the app shell (#488): the `g`-style prefix
 * (which-key popup, #312) and the <Space> leader. The state and timers used to live in app.jsx;
 * the shell owns them here so the global key handler only asks "is a chord armed" and "arm one".
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { armPrefix, disarmPrefix } from '../config/keymap.js'

export const CHORD_WINDOW_MS = 1500

/**
 * @returns {{
 *   leaderActive: boolean,
 *   armLeader: () => void,
 *   clearLeader: () => void,
 *   prefixPopup: {prefix: string, items: Array<{key: string, global?: boolean}>} | null,
 *   armPrefixChord: (prefix: string, items: Array<{key: string, global?: boolean}>) => void,
 *   clearPrefix: () => void,
 * }} chord state and controls; every window closes by itself after CHORD_WINDOW_MS
 */
export function useChords() {
  const [leaderActive, setLeaderActive] = useState(false)
  const [prefixPopup, setPrefixPopup] = useState(null)
  const leaderTimerRef = useRef(null)
  const prefixTimerRef = useRef(null)

  const clearLeader = useCallback(() => {
    clearTimeout(leaderTimerRef.current)
    setLeaderActive(false)
  }, [])
  const armLeader = useCallback(() => {
    setLeaderActive(true)
    clearTimeout(leaderTimerRef.current)
    leaderTimerRef.current = setTimeout(() => setLeaderActive(false), CHORD_WINDOW_MS)
  }, [])

  const clearPrefix = useCallback(() => {
    clearTimeout(prefixTimerRef.current)
    disarmPrefix()
    setPrefixPopup(null)
  }, [])
  const armPrefixChord = useCallback((prefix, items) => {
    armPrefix(prefix, items.filter(c => c.global).map(c => c.key))
    setPrefixPopup({ prefix, items })
    clearTimeout(prefixTimerRef.current)
    prefixTimerRef.current = setTimeout(() => { disarmPrefix(); setPrefixPopup(null) }, CHORD_WINDOW_MS)
  }, [])

  // A repository switch remounts App: no timer of the old instance may fire into the new one (#466).
  useEffect(() => () => {
    clearTimeout(leaderTimerRef.current)
    clearTimeout(prefixTimerRef.current)
    disarmPrefix()
  }, [])

  return { leaderActive, armLeader, clearLeader, prefixPopup, armPrefixChord, clearPrefix }
}
