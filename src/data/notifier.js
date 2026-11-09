/**
 * notifier.js — coalesced cache notifications (V1, #597).
 *
 * Ink 4 renders through a legacy React root: a `setState` made outside a React event handler
 * commits at once, so N cache updates in one tick would be N renders and up to N painted frames.
 * The query client therefore never calls a watcher or a revalidation straight away; it queues it
 * here and one microtask flush calls each watcher (per key) and each revalidation (per query) once,
 * however many writes or invalidations happened in the meantime.
 */

/**
 * @param {Map<string, Set<() => void>>} watchers data watchers by key string
 * @param {Set<{ keyStr: string, run: () => void }>} subscribers revalidation subscribers
 */
export function createNotifier(watchers, subscribers) {
  /** @type {Set<string>} */
  const pendingData = new Set()
  /** @type {Set<{ keyStr: string, run: () => void }>} */
  const pendingRuns = new Set()
  let queued = false

  function flush() {
    queued = false
    const keys = [...pendingData]
    const runs = [...pendingRuns]
    pendingData.clear()
    pendingRuns.clear()
    for (const keyStr of keys) for (const fn of [...(watchers.get(keyStr) || [])]) fn()
    for (const sub of runs) if (subscribers.has(sub)) sub.run()
  }
  function schedule() {
    if (queued) return
    queued = true
    queueMicrotask(flush)
  }
  return {
    /**
     * The data under `keyStr` changed.
     * @param {string} keyStr
     */
    data(keyStr) {
      if (!watchers.get(keyStr)?.size) return
      pendingData.add(keyStr)
      schedule()
    },
    /**
     * Revalidate this subscriber.
     * @param {{ keyStr: string, run: () => void }} sub
     */
    run(sub) {
      pendingRuns.add(sub)
      schedule()
    },
    clear() { pendingData.clear(); pendingRuns.clear() },
  }
}
