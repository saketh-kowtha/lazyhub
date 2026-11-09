// @ts-nocheck
/**
 * features/queue/useReviewQueue.js - loads the account-wide review queue (#177).
 *
 * One GraphQL round trip per page (fetchReviewQueueEvidence, #175): two aliased searches,
 * review-requested and authored, no per-PR calls. Pages are loaded on demand with `loadMore`
 * and the hook reports what is not loaded yet (`hasMore`, `truncation`), so a long queue is
 * paged with a visible "more", never silently cut (D16).
 *
 * The last result is kept in module memory so opening a PR and coming back shows the same rows
 * at once; it is revalidated in the background once it is older than QUEUE_TTL_MS. A failed
 * refresh keeps the rows on screen and reports the error next to them.
 *
 * Observation only: nothing loaded here is an approval input (ARCHITECT_DECISIONS D1).
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { fetchReviewQueueEvidence } from '../../executor.js'
import { logSwallowed } from '../../contain.js'
import { mergeItems } from './model.js'

export const QUEUE_TTL_MS = 60_000
/** PRs per search per page; "load more" fetches the next page of each search that has one. */
export const QUEUE_PAGE = 30

const hostKey = () => process.env.GH_HOST || 'github.com'

/** @type {{host: string, state: any} | null} */
let memory = null

/** Forget the remembered queue (tests). */
export function resetQueueMemory() { memory = null }

const EMPTY = { items: [], cursors: { reviewRequested: null, authored: null }, truncation: null, meta: null, fetchedAtMs: 0 }

/**
 * Fold one fetch result into the loaded state. A search that was not advanced (it had no
 * cursor, so its first page came back again) must not overwrite what we know about it.
 * @param {any} prev loaded state
 * @param {any} result fetchReviewQueueEvidence() result
 * @param {{reset: boolean, advance: Record<string, string|null|undefined>}} how
 * @returns {any} the new loaded state
 */
function fold(prev, result, { reset, advance }) {
  const base = reset ? EMPTY : prev
  const truncation = { ...(base.truncation || {}) }
  const cursors = { ...base.cursors }
  for (const [search, cursorKey] of [['review_requested', 'reviewRequested'], ['authored', 'authored']]) {
    if (reset || advance[cursorKey]) {
      truncation[search] = result.truncation[search]
      cursors[cursorKey] = result.truncation[search].next_cursor
    }
  }
  return {
    items: reset ? mergeItems([], result.items) : mergeItems(base.items, result.items),
    cursors,
    truncation,
    meta: { host: result.host, account: result.account, rate_limit: result.rate_limit },
    fetchedAtMs: Date.parse(result.fetched_at) || Date.now(),
  }
}

/**
 * @param {object} [opts]
 * @param {typeof fetchReviewQueueEvidence} [opts.fetcher] replaced in tests
 * @param {number} [opts.ttlMs]
 * @param {() => number} [opts.now]
 * @returns {{
 *   items: any[], truncation: any, meta: any, fetchedAtMs: number,
 *   loading: boolean, loadingMore: boolean, error: Error|null, hasMore: boolean,
 *   refresh: () => void, loadMore: () => void,
 * }}
 */
export function useReviewQueue({ fetcher = fetchReviewQueueEvidence, ttlMs = QUEUE_TTL_MS, now = Date.now } = {}) {
  const seeded = memory && memory.host === hostKey() ? memory.state : null
  const [state, setState] = useState(seeded || EMPTY)
  const [phase, setPhase] = useState({ loading: !seeded, loadingMore: false, error: null })
  const mounted = useRef(true)
  const busy = useRef(false)
  const latest = useRef(state)
  latest.current = state

  const run = useCallback(async ({ reset }) => {
    if (busy.current) return
    busy.current = true
    const before = latest.current
    const advance = reset ? {} : { reviewRequested: before.cursors.reviewRequested, authored: before.cursors.authored }
    if (mounted.current) setPhase(p => ({ ...p, error: null, loading: reset && before.items.length === 0, loadingMore: !reset }))
    try {
      const result = await fetcher({ limit: QUEUE_PAGE, after: reset ? {} : Object.fromEntries(Object.entries(advance).filter(([, v]) => v)), now })
      const next = fold(latest.current, result, { reset, advance })
      memory = { host: hostKey(), state: next }
      if (mounted.current) { setState(next); setPhase({ loading: false, loadingMore: false, error: null }) }
    } catch (error) {
      logSwallowed('queue.load', error)
      if (mounted.current) setPhase({ loading: false, loadingMore: false, error })
    } finally {
      busy.current = false
    }
  }, [fetcher, now])

  useEffect(() => {
    mounted.current = true
    const fresh = seeded && now() - seeded.fetchedAtMs < ttlMs
    if (!fresh) run({ reset: true })
    return () => { mounted.current = false }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const hasMore = Boolean(state.cursors.reviewRequested || state.cursors.authored)
  return {
    items: state.items,
    truncation: state.truncation,
    meta: state.meta,
    fetchedAtMs: state.fetchedAtMs,
    loading: phase.loading,
    loadingMore: phase.loadingMore,
    error: phase.error,
    hasMore,
    refresh: useCallback(() => { run({ reset: true }) }, [run]),
    loadMore: useCallback(() => { if (hasMore) run({ reset: false }) }, [run, hasMore]),
  }
}
