/**
 * ghKeys.js — the structured query keys behind `useGh`, and seeding them (R3, #481).
 * Lives apart from the hook so a list can seed a detail without importing React state.
 */

import { queryClient, identityKey } from './queryClient.js'

/**
 * The repository a gh read belongs to: its first string dep, else the session default.
 * @param {any[]} deps
 */
export function repoOf(deps) {
  return typeof deps[0] === 'string' ? deps[0] : process.env.GHUI_REPO
}

/**
 * The structured query key `useGh(fetchFn, deps)` reads under: `[host, account, repo, fn, ...deps]`,
 * so a write can invalidate everything for a repository by prefix (#481).
 * @param {Function} fetchFn
 * @param {Array} deps
 */
export function ghQueryKey(fetchFn, deps = []) {
  return identityKey(repoOf(deps) ?? null, fetchFn.name, ...deps)
}

/**
 * Seed what `useGh(fetchFn, deps)` will read, without fetching. The entry renders at once
 * and counts as stale, so the owning view revalidates it; an entry already cached (fuller
 * or fresher) is kept.
 * @param {Function} fetchFn
 * @param {Array} deps
 * @param {any} data
 */
export function seedGh(fetchFn, deps, data) {
  return queryClient.setQueryData(ghQueryKey(fetchFn, deps), data, { timestamp: 0, ifAbsent: true })
}
