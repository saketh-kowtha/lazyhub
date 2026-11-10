/**
 * viewState.js — small store of view-state snapshots for layers evicted from the keep-alive stack
 * (#597, V3). A snapshot is plain data (selection id, the pane's saved cursor/scroll/filter state),
 * never GitHub text; restoring one rebuilds the view from it and the query cache, which makes no gh
 * call inside the freshness window. One store per App instance, so a repository switch drops it.
 */

/** Snapshots kept; the oldest is dropped past this (a dropped one just means a fresh mount). */
const MAX_SNAPSHOTS = 20

/**
 * @typedef {{ pane: string, view: string, itemNumber: number | null, paneState: object | null }} ViewSnapshot
 */

/**
 * @returns {{ save: (id: string, snapshot: ViewSnapshot) => void, take: (id: string) => ViewSnapshot | undefined, has: (id: string) => boolean, readonly size: number }} the store
 */
export function createViewStateStore() {
  /** @type {Map<string, ViewSnapshot>} */
  const snapshots = new Map()
  return {
    save(id, snapshot) {
      snapshots.delete(id)
      snapshots.set(id, snapshot)
      if (snapshots.size > MAX_SNAPSHOTS) snapshots.delete(snapshots.keys().next().value)
    },
    take(id) { const snapshot = snapshots.get(id); snapshots.delete(id); return snapshot },
    has: id => snapshots.has(id),
    get size() { return snapshots.size },
  }
}
