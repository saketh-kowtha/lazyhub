/**
 * usePendingWrite.js — shared pending/double-submit guard for write actions (#453).
 * run(label, fn) shows "label…" through `announce`, ignores any further run()
 * until fn settles, and returns fn's result (rethrowing its error so callers keep
 * their own success/failure messages). Not a mutation framework: no retries,
 * no optimistic state.
 */

import { useCallback, useRef, useState } from 'react'

/**
 * @param {(msg: string) => void} [announce]  status sink; called with "label…" when a write starts
 * @returns {{ run: <T>(label: string, fn: () => Promise<T>) => Promise<T | undefined>, pending: string | null }}
 */
export function usePendingWrite(announce) {
  const busy = useRef(false)
  const announceRef = useRef(announce)
  announceRef.current = announce
  const [pending, setPending] = useState(/** @type {string | null} */ (null))

  const run = useCallback(async (label, fn) => {
    if (busy.current) return undefined
    busy.current = true
    setPending(label)
    announceRef.current?.(`⟳ ${label}…`)
    try {
      return await fn()
    } finally {
      busy.current = false
      setPending(null)
    }
  }, [])

  return { run, pending }
}
