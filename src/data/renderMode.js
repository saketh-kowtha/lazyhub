/**
 * renderMode.js — a view body's mode is derived, never hand-coded from `loading` (V1, #597).
 *
 *   skeleton  no data and no seed, and the request has been pending >= SKELETON_DELAY_MS
 *   pending   no data yet but still inside the delay: draw nothing new, keep the previous frame
 *   data      data (or a seed) exists, whatever isFetching / isStale / error say
 *   empty     a settled, successful, empty result
 *   error     a failure and no data to keep showing
 *
 * `isLoading` means "no data yet and a request is in flight"; `isFetching` means "any request
 * is in flight" (a background revalidate included). Background activity belongs in a
 * fixed-width indicator cell, never in the body.
 */

export const SKELETON_DELAY_MS = 150

/** @typedef {'skeleton' | 'pending' | 'data' | 'empty' | 'error'} RenderMode */

/** @param {any} data */
export function defaultIsEmpty(data) { return Array.isArray(data) && data.length === 0 }

/**
 * @param {object} q
 * @param {any} q.data
 * @param {any} [q.error]
 * @param {boolean} q.isLoading
 * @param {boolean} [q.skeletonDue]  the delay has elapsed (omitted: show the skeleton at once)
 * @param {(data: any) => boolean} [isEmpty]
 * @returns {RenderMode}
 */
export function deriveRenderMode({ data, error, isLoading, skeletonDue = true }, isEmpty = defaultIsEmpty) {
  if (data != null) return isEmpty(data) ? (error ? 'error' : 'empty') : 'data'
  if (error) return 'error'
  if (isLoading) return skeletonDue ? 'skeleton' : 'pending'
  return 'empty'
}
