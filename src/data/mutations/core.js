/**
 * src/data/mutations/core.js — declared writes (V2a, #597, decision doc section 2.4).
 *
 * A write is DECLARED once, in this directory, with `defineMutation`:
 *   - `run(...args)`: the executor call (the only place a view's write reaches the executor);
 *   - `optimistic(...args)`: a pure cache patch, `[{ key, update(prev) => next }]`, applied before the
 *     call and rolled back if it fails;
 *   - `invalidates(result, args)`: structured key prefixes marked stale; only mounted queries on
 *     them refetch now, the rest refetch when next shown.
 * While `run` executes, the repo-wide invalidation `runGh` would otherwise announce is suppressed
 * (see `runDeclared` in ../invalidation.js), so a write touches exactly what it declares.
 * A write that is not declared keeps the old repo-wide fallback and logs a dev warning.
 */

import { queryClient } from '../queryClient.js'
import { runDeclared } from '../invalidation.js'
import { logSwallowed } from '../../contain.js'

/**
 * @typedef {{ key: unknown[], update: (prev: any) => any }} CachePatch
 * @typedef {object} MutationSpec
 * @property {string} name  stable id, e.g. `notifications.markRead`
 * @property {(...args: any[]) => Promise<any>} run
 * @property {string | ((...args: any[]) => string)} [label]  pending text without the ellipsis
 * @property {string | ((result: any, ...args: any[]) => string)} [success]
 * @property {(...args: any[]) => CachePatch[]} [optimistic]
 * @property {(result: any, args: any[]) => unknown[][]} [invalidates]
 */

/** @type {Map<string, MutationSpec>} every declaration, by name (the enumeration test reads it) */
const registry = new Map()

/**
 * Declare a write. Call at module load or from a factory; the returned spec is what `useMutation` takes.
 * @param {MutationSpec} spec
 * @returns {MutationSpec & { declared: true }}
 */
export function defineMutation(spec) {
  if (!spec?.name || typeof spec.run !== 'function') throw new TypeError('defineMutation: a name and a run function are required')
  const declared = Object.freeze({ ...spec, declared: /** @type {const} */ (true) })
  registry.set(spec.name, declared)
  return declared
}

/** @param {unknown} x @returns {x is MutationSpec & { declared: true }} */
export function isDeclared(x) { return !!x && typeof x === 'object' && /** @type {any} */ (x).declared === true }

/** Names of every declared write seen so far. */
export function declaredMutationNames() { return [...registry.keys()] }

/**
 * Apply cache patches; returns how many landed and an undo that restores each patched entry
 * unless something newer (a refetch) replaced it meanwhile.
 * @param {CachePatch[]} patches
 */
function applyPatches(patches) {
  /** @type {Array<{ key: unknown[], prev: any, patched: any }>} */
  const applied = []
  for (const { key, update } of patches) {
    const prev = queryClient.getQueryData(key)
    if (prev === undefined) continue
    try {
      if (!queryClient.updateQueryData(key, update)) continue
      applied.push({ key, prev, patched: queryClient.getQueryData(key) })
    } catch (e) { logSwallowed('mutations.optimistic', e) }
  }
  return {
    count: applied.length,
    undo() {
      for (const { key, prev, patched } of applied.reverse()) {
        if (queryClient.getQueryData(key) === patched) queryClient.updateQueryData(key, () => prev)
      }
    },
  }
}

/**
 * Run a declared write: patch, call, reconcile. Throws the write's error after rolling the patch back
 * (the error gets `rolledBack: true` when a patch was undone). Resolves the write's result.
 * @param {MutationSpec} spec
 * @param {any[]} args
 */
export async function runMutation(spec, args) {
  const patch = applyPatches(spec.optimistic?.(...args) ?? [])
  let result
  try {
    result = await runDeclared(spec.name, () => spec.run(...args))
  } catch (err) {
    patch.undo()
    if (patch.count && err && typeof err === 'object') /** @type {any} */ (err).rolledBack = true
    throw err
  }
  for (const key of spec.invalidates?.(result, args) ?? []) {
    try { queryClient.invalidate(key) } catch (e) { logSwallowed('mutations.invalidate', e) }
  }
  return result
}
