/**
 * invalidation.js — the write-to-read channel (R3, #481).
 *
 * `runGh()` announces every finished write here with the repository it touched; the
 * query client listens and marks every cached read for that repository stale, then
 * revalidates the ones a mounted view is showing. Kept free of React and of the query
 * client so the executor can import it without pulling the UI layer in.
 */

import { AsyncLocalStorage } from 'node:async_hooks'
import { logSwallowed } from '../contain.js'
import { logger } from '../utils-core.js'

/**
 * The declared-write scope (V2a, #597). A write that runs inside `runDeclared(name, fn)` has said which
 * cache entries it patches and invalidates (see src/data/mutations), so its finish does NOT
 * fall back to marking the whole repository stale. Any other write still does, and logs a warning.
 * @type {AsyncLocalStorage<{ name: string }>}
 */
const declaredScope = new AsyncLocalStorage()

/** Undeclared writes seen this session, newest last (bounded). Tests and the dev warning read it. */
/** @type {Array<{ repo: string | null }>} */
const undeclared = []

/**
 * Run `fn` as a declared write: its `runGh` writes announce `{ declared: true }`.
 * @template T
 * @param {string} name
 * @param {() => Promise<T>} fn
 * @returns {Promise<T>}
 */
export function runDeclared(name, fn) {
  return declaredScope.run({ name }, fn)
}

/** Writes that fell back to repo-wide invalidation since the last reset. */
export function undeclaredWrites() { return undeclared.map(e => ({ ...e })) }

/** Forget the recorded undeclared writes (tests). */
export function resetUndeclaredWrites() { undeclared.length = 0 }

/** @type {Set<(event: { repo: string | null, declared: boolean }) => void>} */
const listeners = new Set()

/**
 * Listen for finished writes.
 * @param {(event: { repo: string | null, declared: boolean }) => void} listener
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
  const declared = declaredScope.getStore() !== undefined
  if (!declared) {
    undeclared.push({ repo: repo || null })
    if (undeclared.length > 100) undeclared.shift()
    // Dev aid only (NODE_ENV=development or LAZYHUB_DEV=1; goes to the debug log, never the UI): the fallback is correct but repo-wide, so say which write skipped its declaration.
    if (process.env.NODE_ENV === 'development' || process.env.LAZYHUB_DEV === '1') logger.warn(`write to ${repo || 'an unattributed repo'} was not declared (useMutation + defineMutation); invalidating the whole repository`)
  }
  for (const listener of [...listeners]) {
    try { listener({ repo: repo || null, declared }) } catch (err) { logSwallowed('data.invalidation.listener', err) }
  }
}
