/**
 * src/hooks/useMutation.js — one write lifecycle for every pane (R8, #486; #453).
 *
 * `mutate(...args)` runs `fn(...args)` with:
 *  - a pending status ("⟳ Marking as read…") and a double-submit guard: a second
 *    `mutate` while one is in flight is ignored, and says so (usePendingWrite);
 *  - a success status, then `invalidates`;
 *  - a failure status that sticks until dismissed ("[any key]"), never a silent error.
 *
 * INVALIDATION SEAM (R3, #481): `invalidates` is a list. A function entry is called as
 * `entry(result, args)` (pass a query's `refetch`). Any other entry is a structured query key,
 * handed to `queryClient.invalidate(key)` when the client has one; until R3 adds that, a
 * key entry is a no-op and panes pass `refetch` functions. Nothing here reaches into
 * queryClient internals, so R3 only has to add `invalidate(key)`.
 *
 * DECLARED WRITES (V2a, #597): `useMutation(spec, { onSuccess })` takes a spec from
 * `defineMutation` (src/data/mutations). The spec's `optimistic` patch is applied before the call and
 * rolled back, with a "reverted" status, if it fails; its `invalidates` are key prefixes; and the
 * repo-wide invalidation `runGh` announces is suppressed while it runs. A bare function is an
 * undeclared write: it keeps the repo-wide fallback and logs a dev warning.
 *
 * Returns `{ mutate, pending, status, dismiss }`; render `status` with <MutationStatus>.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { usePendingWrite } from './usePendingWrite.js'
import { queryClient } from '../data/queryClient.js'
import { logSwallowed } from '../contain.js'
import { isDeclared, runMutation } from '../data/mutations/core.js'

const STATUS_MS = 3000

/**
 * @param {((...args: any[]) => Promise<any>) | import('../data/mutations/core.js').MutationSpec} fn  a function, or a declared spec
 * @param {object} [opts]
 * @param {(result: any, args: any[]) => void} [opts.onSuccess]  view-local follow-up after a declared write succeeds
 * @param {string | ((...args: any[]) => string)} [opts.label] pending text without the ellipsis
 * @param {string | ((result: any, ...args: any[]) => string)} [opts.success]
 * @param {Array<unknown[] | ((result: any, args: any[]) => void)>} [opts.invalidates]
 * @param {(error: any, args: any[]) => void} [opts.onError]
 */
export function useMutation(fn, opts = {}) {
  const spec = isDeclared(fn) ? fn : null
  const { onSuccess } = opts
  const label = opts.label ?? spec?.label ?? 'Working'
  const success = opts.success ?? spec?.success
  const invalidates = opts.invalidates ?? []
  const onError = opts.onError
  const run0 = spec ? (/** @type {any[]} */ ...args) => runMutation(spec, args) : /** @type {any} */ (fn)

  const [status, setStatus] = useState(/** @type {{ msg: string, isError: boolean, persist: boolean } | null} */ (null))
  const timer = useRef(/** @type {ReturnType<typeof setTimeout> | undefined} */ (undefined))
  useEffect(() => () => clearTimeout(timer.current), [])

  const show = useCallback((msg, isError = false, sticky = false) => {
    clearTimeout(timer.current)
    setStatus({ msg, isError, persist: isError })
    if (!isError && !sticky) timer.current = setTimeout(() => setStatus(null), STATUS_MS)
  }, [])
  const dismiss = useCallback(() => { setStatus(null) }, [])

  const { run, pending } = usePendingWrite(msg => show(msg, false, true))
  const latest = useRef({ fn: run0, label, success, invalidates, onError, onSuccess })
  latest.current = { fn: run0, label, success, invalidates, onError, onSuccess }

  /** Resolves true when the write ran and succeeded; false when ignored or failed. */
  const mutate = useCallback(async (...args) => {
    const o = latest.current
    let ran = false
    let result
    try {
      await run(typeof o.label === 'function' ? o.label(...args) : o.label, async () => {
        ran = true
        result = await o.fn(...args)
      })
    } catch (err) {
      show(`Failed: ${err?.message ?? err}${err?.rolledBack ? ' (change reverted)' : ''}`, true)
      try { o.onError?.(err, args) } catch (e) { logSwallowed('useMutation.onError', e) }
      return false
    }
    if (!ran) return false
    show(typeof o.success === 'function' ? o.success(result, ...args) : (o.success ?? 'Done'))
    const client = /** @type {any} */ (queryClient)
    try { o.onSuccess?.(result, args) } catch (e) { logSwallowed('useMutation.onSuccess', e) }
    for (const entry of o.invalidates) {
      try {
        if (typeof entry === 'function') entry(result, args)
        else if (typeof client.invalidate === 'function') client.invalidate(entry)
      } catch (e) { logSwallowed('useMutation.invalidate', e) }
    }
    return true
  }, [run, show])

  return { mutate, pending, status, dismiss }
}
