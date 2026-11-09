/**
 * structuralShare.js — keep object identity across refetches (V1, #597).
 *
 * `replaceEqualDeep(prev, next)` returns `prev` itself when `next` is deeply equal to it,
 * otherwise a value built from `next` in which every unchanged subtree is the matching
 * subtree of `prev`. Memoised rows then skip re-rendering, and a revalidate that returns
 * identical data produces no state change at all (so no frame).
 *
 * Arrays of objects that carry a unique stable id are matched by id, not by position, so a
 * row that merely moved still keeps its identity. Only plain objects and arrays are compared
 * structurally; anything else (Date, class instances) is compared with `===`.
 */

const ID_FIELDS = ['id', 'node_id', 'nodeId', 'databaseId', 'number']

/** @param {unknown} v */
function isPlain(v) {
  if (v === null || typeof v !== 'object') return false
  const proto = Object.getPrototypeOf(v)
  return proto === Object.prototype || proto === null
}

/**
 * The id field every element has as a unique primitive, with an id -> index map; null when
 * the array has no such field (it is then compared by position).
 * @param {any[]} arr
 * @returns {{ field: string, index: Map<unknown, number> } | null}
 */
function idIndex(arr) {
  if (arr.length < 2 || !arr.every(isPlain)) return null
  for (const field of ID_FIELDS) {
    const index = new Map()
    let ok = true
    for (let i = 0; i < arr.length; i++) {
      const id = arr[i][field]
      if (id == null || typeof id === 'object' || index.has(id)) { ok = false; break }
      index.set(id, i)
    }
    if (ok) return { field, index }
  }
  return null
}

/**
 * @template T
 * @param {any} prev
 * @param {T} next
 * @returns {T}
 */
export function replaceEqualDeep(prev, next) {
  if (prev === next) return next
  if (Array.isArray(prev) && Array.isArray(next)) {
    const byId = idIndex(prev)
    const out = new Array(next.length)
    let same = prev.length === next.length
    for (let i = 0; i < next.length; i++) {
      let old = prev[i]
      if (byId) {
        const at = byId.index.get(next[i]?.[byId.field])
        old = at === undefined ? undefined : prev[at]
      }
      out[i] = replaceEqualDeep(old, next[i])
      if (out[i] !== prev[i]) same = false
    }
    return /** @type {any} */ (same ? prev : out)
  }
  if (isPlain(prev) && isPlain(next)) {
    const nextKeys = Object.keys(next)
    const out = /** @type {Record<string, any>} */ ({})
    let same = Object.keys(prev).length === nextKeys.length
    for (const k of nextKeys) {
      out[k] = replaceEqualDeep(prev[k], next[k])
      if (out[k] !== prev[k] || !(k in prev)) same = false
    }
    return /** @type {any} */ (same ? prev : out)
  }
  return next
}
