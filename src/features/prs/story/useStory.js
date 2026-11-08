// @ts-nocheck
/**
 * src/features/prs/story/useStory.js -- data for the review story (#362). Read-only.
 *
 * Reads the PR's changed-file list through the same cursor-paged call the diff view uses
 * (`listPRFilesPage`, no patch text) and walks every page, so the story covers the whole PR and
 * a 3,000-file PR costs 30 light calls, not 3,000 patch fetches. While pages are still arriving
 * the story is built from what is known and says so. The "since your last review" answer is a
 * separate, independent query: its failure never hides the story.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { useGh } from '../../../hooks/useGh.js'
import { listPRFilesPage, getReviewDelta } from '../../../executor.js'
import { logSwallowed } from '../../../contain.js'
import { buildStory, markSinceReview } from './build.js'

/** Hard ceiling on file-list pages walked (100 files each): 100 pages = 10,000 files, and we say so. */
export const MAX_PAGES = 100

/**
 * @param {{ repo: string, prNumber: number }} args
 */
export function useStory({ repo, prNumber }) {
  const { data: first, loading, error, refetch: refetchFirst } = useGh(listPRFilesPage, [repo, prNumber])
  const { data: delta, loading: deltaLoading, error: deltaError, refetch: refetchDelta } = useGh(getReviewDelta, [repo, prNumber], { ttl: 60_000 })

  const scope = first ? `${repo}#${prNumber}|${first.endCursor}|${first.totalCount}` : null
  const [more, setMore] = useState({ scope: null, files: [], done: false, error: null, pages: 1 })
  const live = more.scope === scope ? more : { scope, files: [], done: !first?.hasNextPage, error: null, pages: 1 }
  const scopeRef = useRef(scope)
  scopeRef.current = scope

  useEffect(() => {
    if (!first || !scope) return undefined
    if (!first.hasNextPage) { setMore({ scope, files: [], done: true, error: null, pages: 1 }); return undefined }
    let cancelled = false
    ;(async () => {
      let after = first.endCursor
      let files = []
      let pages = 1
      setMore({ scope, files, done: false, error: null, pages })
      try {
        while (after && pages < MAX_PAGES) {
          const page = await listPRFilesPage(repo, prNumber, { after })
          if (cancelled || scopeRef.current !== scope) return
          files = files.concat(page.files)
          pages += 1
          after = page.hasNextPage ? page.endCursor : null
          setMore({ scope, files, done: !after, error: null, pages })
        }
        if (after && !cancelled) setMore({ scope, files, done: true, error: null, pages, capped: true })
      } catch (err) {
        logSwallowed('prs.story.files', err)
        if (!cancelled) setMore({ scope, files, done: false, error: err, pages })
      }
    })()
    return () => { cancelled = true }
  }, [scope]) // eslint-disable-line react-hooks/exhaustive-deps

  const metas = useMemo(() => {
    const seen = new Set()
    return [...(first?.files || []), ...live.files].filter(f => !seen.has(f.path) && seen.add(f.path))
  }, [first, live.files])

  const base = useMemo(() => buildStory(metas), [metas])
  const sincePaths = useMemo(
    () => (delta?.status === 'files' ? new Set(delta.paths) : delta?.status === 'same' ? new Set() : null),
    [delta],
  )
  const marked = useMemo(() => markSinceReview(base, sincePaths), [base, sincePaths])
  // Files changed since the review that the PR no longer lists (reverted, or renamed away): counted, not hidden.
  const sinceOutside = useMemo(() => {
    if (!sincePaths) return 0
    const inPr = new Set(metas.map(m => m.path))
    let n = 0
    for (const p of sincePaths) if (!inPr.has(p)) n += 1
    return n
  }, [sincePaths, metas])

  const total = live.total ?? first?.totalCount ?? metas.length
  return {
    story: { ...base, steps: marked.steps },
    sinceCount: marked.sinceCount,
    sinceOutside,
    delta, deltaLoading, deltaError,
    total,
    loadedFiles: metas.length,
    complete: Boolean(first) && live.done && !live.error && !live.capped,
    capped: Boolean(live.capped),
    listError: live.error,
    loading: loading && !first,
    error: first ? null : error,
    refetch: () => { refetchFirst(); refetchDelta() },
  }
}
