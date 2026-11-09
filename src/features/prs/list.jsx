// @ts-check

/**
 * src/features/prs/list.jsx — PR list state, persistence and key dispatch.
 * Rendering lives in list-view.jsx; list-dialog-view.jsx routes active dialogs.
 *
 * Props:
 *   repo         string
 *   listHeight   number   — visible row count from App
 *   innerWidth   number   — available list width
 *   onSelectPR   fn(pr)   — called on Enter → full detail
 *   onOpenDiff   fn(pr)   — called on 'd'
 *   onPaneState  fn({loading, error, count})
 */

import React, { useState, useCallback, useEffect, useContext, useRef } from 'react'
import { openUrl, copyToClipboard } from '../../services/platform.js'
import { useStdout } from 'ink'
import { useKeymapInput } from '../../config/keymap.js'
import { useKeyScope } from '../../keyscope.js'
import { useGh } from '../../hooks/useGh.js'
import { seedGh } from '../../data/ghKeys.js'
import { usePrefetchPRDiff } from './diff/prefetch.js'
import { listPRsPage, getPR, getPRRow, getPRPreview, getRepoInfo, searchOwnsState } from '../../executor.js'
import { AppContext } from '../../context.js'
import { usePaneState } from '../../hooks/usePaneState.js'
import { loadConfig, loadState, saveState } from '../../config.js'
import { firstActionKey, matchesAction } from '../../config/actions.js'
import { useTheme } from '../../theme.js'
import { sanitize } from '../../utils.js'
import {
  canToggleAutoMergeFromList,
  previewPanelLayout,
} from './list-row.jsx'
import { usePendingWrite } from '../../hooks/usePendingWrite.js'
import { renderPRListDialog } from './list-dialog-view.jsx'
import { PRListView } from './list-view.jsx'
import { smartEnterTarget } from './smart-enter.js'
import { rememberedPRFilter, rememberPRFilter } from './remembered-filter.js'

const _appConfig = loadConfig()
const _cfg = _appConfig.pr
const _actions = _appConfig.toml
const STATE_CYCLE = ['open', 'closed', 'merged']
const FILTER_BINDINGS = [['filterOpen', 'open'], ['filterClosed', 'closed'], ['filterMerged', 'merged']]
// GitHub search never returns more than 1,000 results.
const SEARCH_CAP = 1000
const PAGE_SIZE = Math.max(1, Math.min(Number(_cfg.pageSize) || 50, 100))
const PREVIEW_DELAY_MS = 150
const emptyMore = (key) => ({ key, items: [], endCursor: null, hasNextPage: null, totalCount: null, loading: false, error: null })

export { canToggleAutoMergeFromList } from './list-row.jsx'

/**
 * The detail view renders from the row the list already has while getPR, checks and
 * branch protection load in parallel (#481, #452). The seed is marked `partial` (no
 * body, reviews or files yet) and stale, so the detail shows the gap and revalidates.
 */
export function seedPRDetail(repo, row) {
  if (repo && row?.number != null) seedGh(getPR, [repo, row.number], { ...row, partial: true })
}

export function PRList({ repo, listHeight = 10, innerWidth, onSelectPR, onOpenDiff, onPaneState }) {
  useKeyScope('pane')
  const { t } = useTheme()
  const { notifyDialog } = useContext(AppContext)
  const { stdout } = useStdout()
  const termRows = stdout?.rows || 24
  const termCols = stdout?.columns || 80
  const height = listHeight || Math.max(3, termRows - 5)
  // Reserve rows for the expanded detail block; disable on tiny terminals
  const EXPAND_ROWS = 5
  const expansionEnabled = termRows >= 20
  const effectiveHeight = expansionEnabled ? Math.max(3, height - EXPAND_ROWS) : height

  // Preserve filter/cursor/scroll across back-navigation from detail/diff.
  // Seed scope from persisted [state] so it survives across sessions;
  // fall back to config default (typically 'own') for first-ever launch.
  // Read once per mount: loadState() is a synchronous file read, not for every render (#455).
  const persistedScopeRef = useRef(undefined)
  if (persistedScopeRef.current === undefined) persistedScopeRef.current = loadState().prScope ?? null
  const _persistedScope = persistedScopeRef.current
  const [savedState, setSavedState] = usePaneState('prs', {
    filterStates: rememberedPRFilter(repo) || [_cfg.defaultFilter],
    scope: _persistedScope || _cfg.defaultScope,
    sortMode: 'default',
    authorFilter: '',
    searchText: '',
    cursor: 0,
    scrollOffset: 0,
  })

  // Hydrate filterStates — migrate legacy single-string filterState
  const initFilterStates = (() => {
    if (Array.isArray(savedState.filterStates) && savedState.filterStates.length > 0) return savedState.filterStates
    if (typeof savedState.filterState === 'string') return [savedState.filterState]
    return [_cfg.defaultFilter]
  })()

  const [filterStatesArr, setFilterStatesArr] = useState(initFilterStates)
  const filterStates = new Set(filterStatesArr)

  const [scope, setScopeRaw] = useState(savedState.scope)
  const [sortMode, setSortModeRaw] = useState(savedState.sortMode)
  const [authorFilter, setAuthorFilterRaw] = useState(savedState.authorFilter)
  // `/` runs a GitHub search with this text (#508); cursor pages come from the same query.
  const [searchText, setSearchTextRaw] = useState(savedState.searchText || '')

  // First page through the query cache; later pages are fetched by cursor and appended, and
  // earlier pages are never refetched (D16). Open+merged is the one state set GitHub search
  // cannot express, so that set is filtered client-side and shows no total (exactTotal false).
  const statesList = [...filterStates].sort()
  const pageFilter = { states: statesList, scope, author: authorFilter || undefined, search: searchText || undefined, sort: sortMode, limit: PAGE_SIZE }
  const pageKey = JSON.stringify([repo, pageFilter])
  const { data: firstPage, loading, error, refetch: refetchFirst, isStale } = useGh(listPRsPage, [repo, pageFilter])
  const { data: repoInfo } = useGh(getRepoInfo, [repo], { ttl: 300_000 })
  const [more, setMore] = useState(() => emptyMore(pageKey))
  const extra = more.key === pageKey ? more : emptyMore(pageKey)
  // Writes patch rows in place (number -> fresh row) so an approve or label edit keeps every loaded page.
  // `removed` lists rows a write moved out of this filter (merge, close), so the total stays honest.
  const emptyOverlay = (key) => ({ key, rows: {}, removed: [] })
  const [overlay, setOverlay] = useState(() => emptyOverlay(pageKey))
  const patches = overlay.key === pageKey ? overlay : emptyOverlay(pageKey)
  const inFlight = useRef(false)
  // Every start-over bumps the token; a response only applies if its token is still current.
  // (A key check alone would let a stale A response land after A -> B -> A.)
  const pageToken = useRef(0)
  const resetPaging = useCallback((key, { keepOverlay = false } = {}) => {
    pageToken.current += 1
    inFlight.current = false
    setMore(emptyMore(key))
    if (!keepOverlay) setOverlay(emptyOverlay(key))
  }, [])
  // A new filter, scope, author or sort starts clean: no pages, cursor or in-flight request carried over.
  useEffect(() => { resetPaging(pageKey) }, [pageKey, resetPaging])
  // Explicit `r`: start over from page 1.
  const refetch = useCallback(() => {
    resetPaging(pageKey)
    refetchFirst()
  }, [pageKey, refetchFirst, resetPaging])
  // The first page was revalidated into a different page 1 (new rows, new endCursor): the cursor
  // pages already appended hang off the old one and could leave gaps, so drop them and re-page.
  const firstAnchor = firstPage ? `${firstPage.endCursor}|${firstPage.items[0]?.number}|${firstPage.items.at(-1)?.number}|${firstPage.totalCount}` : null
  const lastAnchor = useRef(firstAnchor)
  useEffect(() => {
    if (lastAnchor.current === firstAnchor) return
    lastAnchor.current = firstAnchor
    resetPaging(pageKey, { keepOverlay: true })
  }, [firstAnchor, pageKey, resetPaging])

  const [cursor, setCursorRaw] = useState(savedState.cursor)
  const [scrollOffset, setScrollOffsetRaw] = useState(savedState.scrollOffset)

  // Wrap setters to also persist to pane state map
  const setFilterStates = (updater) => {
    const next = typeof updater === 'function' ? updater(filterStates) : updater
    const arr = Array.from(next)
    setFilterStatesArr(arr)
    setSavedState({ filterStates: arr })
    rememberPRFilter(repo, arr)
  }
  const setScope = (v) => { setScopeRaw(v); setSavedState({ scope: v }); saveState({ prScope: v }) }
  const setSortMode = (v) => { setSortModeRaw(v); setSavedState({ sortMode: v }) }
  const setAuthorFilter = (v) => { setAuthorFilterRaw(v); setSavedState({ authorFilter: v }) }
  const setSearchText = (v) => { setSearchTextRaw(v); setSavedState({ searchText: v }) }
  const setCursor = (v) => { setCursorRaw(v); setSavedState({ cursor: typeof v === 'function' ? v(cursor) : v }) }
  const setScrollOffset = (v) => { setScrollOffsetRaw(v); setSavedState({ scrollOffset: typeof v === 'function' ? v(scrollOffset) : v }) }
  const [dialog, setDialog] = useState(null)
  const [mergeOptions, setMergeOptions] = useState(null)
  const [statusMsg, setStatusMsg] = useState(null)
  // Preview panel: shown beside the list for the focused row when the terminal is wide
  // enough (and [layout].preview_panel is on). Esc dismisses it and it stays dismissed
  // while the cursor moves; `p` toggles it again.
  const [popoverDismissed, setPopoverDismissed] = useState(_appConfig.layout?.previewPanel === false)
  const lastKeyRef   = useRef(null)
  const lastKeyTimer = useRef(null)

  const hasNextPage = extra.hasNextPage ?? firstPage?.hasNextPage ?? false
  const endCursor = extra.endCursor ?? firstPage?.endCursor ?? null
  const baseTotal = firstPage?.exactTotal === false ? null : (extra.totalCount ?? firstPage?.totalCount ?? null)
  const totalCount = baseTotal == null ? null : Math.max(0, baseTotal - patches.removed.length)
  const rawLoaded = (firstPage?.items.length || 0) + extra.items.length
  // GitHub search stops at 1,000 results without saying more exist: "no next page" is the end of
  // the list only when fewer than that were loaded and the total agrees.
  const capped = !hasNextPage && rawLoaded > 0 && (rawLoaded >= SEARCH_CAP || (baseTotal != null && baseTotal > rawLoaded))
  const items = React.useMemo(() => {
    const seen = new Set()
    return [...(firstPage?.items || []), ...extra.items]
      .filter(pr => pr && pr.number && !seen.has(pr.number) && seen.add(pr.number))
      .map(pr => patches.rows[pr.number] || pr)
      // A search that names its own state decides what is listed; otherwise the state filter applies.
      .filter(pr => searchOwnsState(searchText) || filterStates.has((pr.state || '').toLowerCase()))
  }, [firstPage, extra.items, patches, filterStatesArr, searchText]) // eslint-disable-line react-hooks/exhaustive-deps
  const itemsRef = useRef(items)
  itemsRef.current = items

  const loadMore = useCallback(async () => {
    if (inFlight.current || !endCursor) return
    const token = pageToken.current
    const requestKey = pageKey
    inFlight.current = true
    setMore(prev => ({ ...(prev.key === requestKey ? prev : emptyMore(requestKey)), loading: true, error: null }))
    try {
      const page = await listPRsPage(repo, { ...pageFilter, after: endCursor })
      if (pageToken.current !== token) return // started over meanwhile: drop the stale page
      setMore(prev => ({
        key: requestKey,
        items: [...(prev.key === requestKey ? prev.items : []), ...page.items],
        endCursor: page.endCursor, hasNextPage: page.hasNextPage, totalCount: page.totalCount,
        loading: false, error: null,
      }))
    } catch (err) {
      if (pageToken.current !== token) return
      setMore(prev => ({ ...(prev.key === requestKey ? prev : emptyMore(requestKey)), loading: false, error: err }))
    } finally {
      if (pageToken.current === token) inFlight.current = false
    }
  }, [repo, pageKey, endCursor]) // eslint-disable-line react-hooks/exhaustive-deps

  // Retry only the page that failed; the pages already loaded stay.
  const retryPage = useCallback(() => {
    setMore(prev => (prev.key === pageKey ? { ...prev, error: null } : prev))
  }, [pageKey])

  // After a write, re-read just that PR and patch its row (approve, merge, labels...).
  // If the re-read fails the old row stays and a status line says so; it never resets the pages.
  const statusRef = useRef(null)
  const refreshPR = useCallback(async (number) => {
    const key = pageKey
    const token = pageToken.current
    try {
      const row = await getPRRow(repo, number)
      if (pageToken.current !== token) return
      const leaves = !filterStates.has((row.state || '').toLowerCase())
      const wasListed = itemsRef.current.some(pr => pr.number === number)
      setOverlay(prev => {
        const base = prev.key === key ? prev : emptyOverlay(key)
        return {
          key,
          rows: { ...base.rows, [number]: row },
          removed: leaves && wasListed && !base.removed.includes(number) ? [...base.removed, number] : base.removed,
        }
      })
    } catch (err) {
      statusRef.current?.(`✗ Could not refresh #${number}: ${err?.message || err}`, true)
    }
  }, [repo, pageKey, filterStatesArr]) // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch the next cursor page when the cursor nears the end of what is loaded.
  useEffect(() => {
    if (hasNextPage && !loading && !error && !extra.loading && !extra.error && cursor >= items.length - 10) loadMore()
  }, [cursor, items.length, hasNextPage, loading, error, extra.loading, extra.error, loadMore])

  // Filter keys from config (defaults: O=open, C=closed, M=merged)
  const FK = _cfg.keys

  // Notify parent of loading/error/count — cursor/scrollOffset stay local
  useEffect(() => {
    if (onPaneState) onPaneState({ loading, error, count: items.length, isStale })
  }, [loading, error, items.length, isStale]) // eslint-disable-line react-hooks/exhaustive-deps

  // A refetch can shrink the list (merged/closed PR); keep the cursor on a real row.
  useEffect(() => {
    if (items.length > 0 && cursor > items.length - 1) {
      const last = items.length - 1
      setCursor(last)
      setScrollOffset(Math.max(0, last - effectiveHeight + 1))
    }
  }, [items.length]) // eslint-disable-line react-hooks/exhaustive-deps

  // Notify App when dialog opens/closes so global keys are suppressed + footer updates
  useEffect(() => {
    notifyDialog(!!dialog)
    if (onPaneState) onPaneState({ dialogHint: dialog || null })
    return () => { notifyDialog(false); if (onPaneState) onPaneState({ dialogHint: null }) }
  }, [dialog, notifyDialog]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => () => { clearTimeout(lastKeyTimer.current) }, [])

  const showStatus = (msg, isError = false, sticky = false) => {
    setStatusMsg({ msg: sanitize(msg), isError, persist: isError })
    if (!isError && !sticky) setTimeout(() => setStatusMsg(null), 3000)
  }
  statusRef.current = showStatus
  const { run: runWrite } = usePendingWrite((msg) => showStatus(msg, false, true))

  const moveCursor = useCallback((delta) => {
    const next = Math.max(0, Math.min(items.length - 1, cursor + delta))
    setCursor(next)
    if (next < scrollOffset) setScrollOffset(next)
    if (next >= scrollOffset + effectiveHeight) setScrollOffset(next - effectiveHeight + 1)
  }, [cursor, items.length, scrollOffset, effectiveHeight])

  const openDialog = useCallback((name) => { setDialog(name) }, [])
  const closeDialog = useCallback(() => setDialog(null), [])

  useKeymapInput((input, key) => {
    if (statusMsg?.persist) { setStatusMsg(null) }
    if (dialog) return

    // gg → top
    const topSequenceKey = firstActionKey('cursor.top', 'gg', _actions)[0]
    if (input === topSequenceKey) {
      if (lastKeyRef.current === topSequenceKey) {
        clearTimeout(lastKeyTimer.current)
        lastKeyRef.current = null
        setCursor(0); setScrollOffset(0)
        return
      }
      lastKeyRef.current = topSequenceKey
      lastKeyTimer.current = setTimeout(() => { lastKeyRef.current = null }, 400)
      return
    }
    lastKeyRef.current = null

    // G → bottom
    if (matchesAction('cursor.bottom', input, key, _actions)) {
      if (items.length > 0) {
        const last = items.length - 1
        setCursor(last); setScrollOffset(Math.max(0, last - effectiveHeight + 1))
      }
      return
    }

    if (matchesAction('cursor.down', input, key, _actions)) { moveCursor(1);  return }
    if (matchesAction('cursor.up', input, key, _actions))   { moveCursor(-1); return }
    if (matchesAction('list.refresh', input, key, _actions)) { if (extra.error) retryPage(); else refetch(); return }
    if (matchesAction('list.search', input, key, _actions)) { openDialog('search'); return }
    if (matchesAction('pr.preview', input, key, _actions)) { setPopoverDismissed(d => !d); return }

    const focusedPR = !loading && items.length > 0 ? items[cursor] : null
    if (matchesAction('pr.auto-merge', input, key, _actions) && canToggleAutoMergeFromList(focusedPR)) { openDialog('auto-merge'); return }

    // Filter state toggles (defaults: O/C/M) — press to toggle state in/out of active set
    const toggledState = FILTER_BINDINGS.find(([keyName]) => FK[keyName] && input === FK[keyName])?.[1]
    if (toggledState) {
      setFilterStates(prev => {
        const next = new Set(prev)
        if (next.has(toggledState)) {
          if (next.size > 1) next.delete(toggledState)
        } else {
          next.add(toggledState)
        }
        return next
      })
      setCursor(0); setScrollOffset(0); return
    }
    // f cycles single-state sets: open → closed → merged → open
    if (matchesAction('pr.filter-cycle', input, key, _actions)) {
      setFilterStates(prev => {
        const current = prev.size === 1 ? [...prev][0] : 'open'
        const next = STATE_CYCLE[(STATE_CYCLE.indexOf(current) + 1) % STATE_CYCLE.length]
        showStatus(`▸ ${next}`)
        return new Set([next])
      })
      setCursor(0); setScrollOffset(0)
      return
    }

    // s — cycle scope then age sort
    if (matchesAction('pr.scope-cycle', input, key, _actions)) {
      const CYCLE = ['all', 'own', 'reviewing', 'oldest']
      const current = sortMode === 'oldest' ? 'oldest' : scope
      const next = CYCLE[(CYCLE.indexOf(current) + 1) % CYCLE.length]
      if (next === 'oldest') {
        setScope('all')
        setSortMode('oldest')
        showStatus('sort: oldest first')
      } else {
        setSortMode('default')
        setScope(next)
        showStatus(`scope: ${next}`)
      }
      setCursor(0); setScrollOffset(0)
      return
    }

    // @ — search PRs by author username
    if (matchesAction('pr.author-filter', input, key, _actions)) { openDialog('author-search'); return }

    // N — new PR
    if (matchesAction('pr.new', input, key, _actions)) { openDialog('new-pr'); return }

    if (loading || items.length === 0) return
    const pr = items[cursor]
    if (!pr) return

    if (matchesAction('pr.open-selected', input, key, _actions)) { seedPRDetail(repo, pr); onSelectPR(pr, smartEnterTarget(pr, { scope, enabled: loadState().smartEnter !== false })); return }
    if (matchesAction('pr.diff', input, key, _actions)) { onOpenDiff(pr); return }
    if (matchesAction('pr.merge', input, key, _actions)) { openDialog('merge'); return }
    if (matchesAction('pr.labels', input, key, _actions)) { openDialog('labels'); return }
    if (matchesAction('pr.assignees', input, key, _actions)) { openDialog('assignees'); return }
    if (matchesAction('pr.reviewers', input, key, _actions)) { openDialog('reviewers'); return }
    if (matchesAction('pr.approve', input, key, _actions)) { openDialog('approve-body'); return }
    if (matchesAction('pr.request-changes', input, key, _actions)) { openDialog('reqchanges-body'); return }
    if (matchesAction('pr.close', input, key, _actions)) { openDialog('close-pr'); return }
    if (matchesAction('pr.comment', input, key, _actions)) { openDialog('comment-pr'); return }

    if (matchesAction('pr.checkout', input, key, _actions)) { openDialog('checkout'); return }

    // y — copy PR URL to clipboard
    if (matchesAction('pr.copy-url', input, key, _actions) && pr.url) {
      copyToClipboard(pr.url).then(ok => (ok ? showStatus(`✓ Copied ${pr.url}`) : showStatus('✗ Copy failed', true)))
      return
    }

    if (matchesAction('pr.open-browser', input, key, _actions) && pr.url) {
      openUrl(pr.url)
      return
    }

  })

  // ── Dialogs ───────────────────────────────────────────────────────────────

  const listPR = items[cursor]
  // `d` on a resting row finds the changed-file list already fetched (#482).
  usePrefetchPRDiff(repo, dialog ? null : listPR?.number)
  // Heavy fields (body, full checks) load for the focused row only, after the cursor settles,
  // and only while the preview panel is actually on screen.
  const panel = previewPanelLayout({ listWidth: innerWidth || termCols - 2, termRows, previewWidth: _appConfig.layout?.previewWidth })
  const previewVisible = !!listPR && !dialog && !popoverDismissed && panel.fits
  const [previewNumber, setPreviewNumber] = useState(null)
  useEffect(() => {
    const timer = setTimeout(() => setPreviewNumber(listPR?.number ?? null), PREVIEW_DELAY_MS)
    return () => clearTimeout(timer)
  }, [listPR?.number])
  const { data: preview, error: previewError } = useGh(getPRPreview, [repo, previewNumber], { ttl: 60_000, enabled: previewVisible && previewNumber != null && previewNumber === listPR?.number })
  const selectedPR = React.useMemo(() => {
    if (!listPR || previewNumber !== listPR.number) return listPR
    if (preview && typeof preview.body === 'string') return { ...listPR, ...preview }
    return previewError ? { ...listPR, previewError: true } : listPR
  }, [listPR, preview, previewError, previewNumber])

  const dialogView = renderPRListDialog({
    dialog, selectedPR, items, repo, repoInfo, authorFilter, effectiveHeight,
    mergeOptions, setMergeOptions, setDialog, setCursor, setScrollOffset,
    setAuthorFilter, searchText, setSearchText, showStatus, closeDialog, refetch, refreshPR, runWrite,
  })
  if (dialogView) return dialogView

  // ── List view ─────────────────────────────────────────────────────────────

  const visiblePRs = items.slice(scrollOffset, scrollOffset + effectiveHeight)

  return (
    <PRListView
      items={items}
      loading={loading}
      error={error}
      filterStates={filterStates}
      scope={scope}
      sortMode={sortMode}
      authorFilter={authorFilter}
      searchText={searchText}
      statusMsg={statusMsg}
      config={_cfg}
      filterKeys={FK}
      t={t}
      height={height}
      effectiveHeight={effectiveHeight}
      visiblePRs={visiblePRs}
      scrollOffset={scrollOffset}
      cursor={cursor}
      innerWidth={innerWidth}
      termCols={termCols}
      termRows={termRows}
      selectedPR={selectedPR}
      dialog={dialog}
      paging={{ hasMore: hasNextPage, total: totalCount, loadingMore: extra.loading, error: extra.error, cap: SEARCH_CAP, capped, search: Boolean(searchText) }}
      previewWidth={_appConfig.layout?.previewWidth}
      popoverDismissed={popoverDismissed}
      setPopoverDismissed={setPopoverDismissed}
      expansionEnabled={expansionEnabled}
    />
  )
}
