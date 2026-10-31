/**
 * usePendingWrite.js — shared pending/double-submit guard for write actions (#453).
 * run(label, fn) shows "label…" through `announce`, ignores any further run()
 * until fn settles, and returns fn's result (rethrowing its error so callers keep
 * their own success/failure messages). An ignored run() is never silent: it
 * announces that the earlier write is still in progress. fn is expected to
 * settle; gh calls do, because runGh() times out. Not a mutation framework: no
 * retries, no optimistic state.
 */

import { useCallback, useRef, useState } from 'react'

/**
 * @param {(msg: string) => void} [announce]  status sink; called with "label…" when a write starts
 * @returns {{ run: <T>(label: string, fn: () => Promise<T>) => Promise<T | undefined>, pending: string | null }}
 */
export function usePendingWrite(announce) {
  const busy = useRef(/** @type {string | null} */ (null))
  const announceRef = useRef(announce)
  announceRef.current = announce
  const [pending, setPending] = useState(/** @type {string | null} */ (null))

  const run = useCallback(async (label, fn) => {
    if (busy.current) {
      announceRef.current?.(`⟳ ${busy.current} still in progress`)
      return undefined
    }
    busy.current = label
    setPending(label)
    announceRef.current?.(`⟳ ${label}…`)
    try {
      return await fn()
    } finally {
      busy.current = null
      setPending(null)
    }
  }, [])

  return { run, pending }
}
