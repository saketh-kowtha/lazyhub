// @ts-nocheck
/**
 * schema-compat.js - GraphQL schema fallback for older GitHub Enterprise Server hosts.
 *
 * github.com always gets the full query. On any other host, a GraphQL schema error
 * ("Field 'x' doesn't exist on type 'Y'", via classifyGhFailure kind 'schema') makes the
 * caller retry ONCE with the documented lower-capability variant of that query. The
 * degraded capability is remembered per host for the session, so later calls go straight
 * to the compatible variant and the failing query is never sent twice.
 *
 * A degraded capability is never a silent drop: callers return an explicit unknown /
 * unavailable value for the data it carried (see docs/COMPATIBILITY.md, D16).
 */
import { classifyGhFailure } from './classify.js'

/** The host every call of this session targets (bootstrap sets GH_HOST for non-default hosts). */
export function compatHost() {
  return (process.env.GH_HOST || 'github.com').toLowerCase()
}

/** @type {Map<string, Set<string>>} */
const degradedByHost = new Map()

/**
 * @param {string} capability
 * @param {string} [host]
 * @returns {boolean}
 */
export function isDegraded(capability, host = compatHost()) {
  return degradedByHost.get(host)?.has(capability) === true
}

/**
 * @param {string} capability
 * @param {string} host
 */
function markDegraded(capability, host) {
  if (!degradedByHost.has(host)) degradedByHost.set(host, new Set())
  degradedByHost.get(host).add(capability)
}

/** Forget every degradation (tests, host switch). */
export function resetSchemaCompat() {
  degradedByHost.clear()
}

/** @param {unknown} err @returns {boolean} true when the host's GraphQL schema lacks something we asked for */
export function isSchemaError(err) {
  return classifyGhFailure(err).kind === 'schema'
}

/**
 * Run a GraphQL read with schema fallback.
 *
 * @template T
 * @param {Record<string, RegExp>} capabilities  capability name -> pattern of the field names it covers
 * @param {(degraded: Set<string>) => Promise<T>} run  builds and runs the query for the degraded set
 * @returns {Promise<T>}
 */
export async function withSchemaFallback(capabilities, run) {
  const host = compatHost()
  const names = Object.keys(capabilities)
  const current = () => new Set(names.filter(n => isDegraded(n, host)))
  try {
    return await run(current())
  } catch (err) {
    // github.com keeps the full queries: a schema error there is a real bug, not a version gap.
    if (host === 'github.com' || !isSchemaError(err)) throw err
    const text = `${err?.message || ''}\n${err?.stderr || ''}`
    const hit = names.filter(n => !isDegraded(n, host) && capabilities[n].test(text))
    // The error names a field no remaining capability covers: nothing to fall back to.
    if (hit.length === 0) throw err
    for (const n of hit) markDegraded(n, host)
    return run(current())
  }
}
