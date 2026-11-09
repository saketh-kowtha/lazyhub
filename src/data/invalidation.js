/**
 * invalidation.js — the write-to-read channel (R3, #481).
 *
 * `runGh()` announces every finished write here with the repository it touched; the
 * query client listens and marks every cached read for that repository stale, then
 * revalidates the ones a mounted view is showing. Kept free of React and of the query
 * client so the executor can import it without pulling the UI layer in.
 */

import { logSwallowed } from '../contain.js'

/** @type {Set<(event: { repo: string | null }) => void>} */
const listeners = new Set()

/**
 * Listen for finished writes.
 * @param {(event: { repo: string | null }) => void} listener
 * @returns {() => void} unsubscribe
 */
export function onWrite(listener) {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/**
 * Announce a finished write (success or ambiguous failure). `repo` is `owner/name`, or
 * null when the write cannot be attributed, which invalidates every repository.
 * Never throws.
 * @param {string | null} repo
 */
export function notifyWrite(repo) {
  for (const listener of [...listeners]) {
    try { listener({ repo: repo || null }) } catch (err) { logSwallowed('data.invalidation.listener', err) }
  }
}
