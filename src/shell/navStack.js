/**
 * navStack.js — which views stay mounted (#597, V3).
 *
 * Pure bookkeeping for the keep-alive navigation stack. The shell shows one view at a time (the
 * "active" layer). When navigation goes deeper (list -> detail -> diff) the view being left stays
 * mounted and covered, so going back is instant and loses no state. At most MAX_MOUNTED layers,
 * the active one included, are mounted: the oldest covered layer is evicted past that, and its
 * view-state is snapshotted so it can be rebuilt from the snapshot and the query cache.
 */

/** Active layer plus covered layers kept mounted. Each is a full view tree, so this caps memory. */
export const MAX_MOUNTED = 3

/**
 * @typedef {{ id: string, base: boolean }} LayerRef a layer's identity; `base` is a list pane (a stack root)
 * @typedef {{ id: string, base: boolean, element: any, meta: any }} CoveredLayer
 */

/**
 * The covered layers after navigating from `from` to `to`.
 *  - back to a layer that is still covered: it becomes active again; it and everything deeper is dropped;
 *  - to a list pane that is not covered: a new root, nothing underneath survives;
 *  - otherwise forward: `from` stays mounted underneath, the oldest covered layer is evicted past the cap.
 * @param {CoveredLayer[]} covered the covered layers, oldest first
 * @param {CoveredLayer | null} from the layer being left (carries its last element), null at first render
 * @param {LayerRef} to the layer now active
 * @returns {{ covered: CoveredLayer[], evicted: CoveredLayer[] }} the new stack and layers pushed out by the cap
 */
export function navigate(covered, from, to) {
  if (!from || from.id === to.id) return { covered, evicted: [] }
  const at = covered.findIndex(layer => layer.id === to.id)
  if (at >= 0) return { covered: covered.slice(0, at), evicted: [] }
  if (to.base) return { covered: [], evicted: [] }
  const next = [...covered, from]
  const over = Math.max(0, next.length - (MAX_MOUNTED - 1))
  return { covered: next.slice(over), evicted: next.slice(0, over) }
}
