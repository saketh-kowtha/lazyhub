// @ts-nocheck
// TODO(#197): issue list view needs explicit item/dialog prop typedefs.
/**
 * Issue list controller: query, filters, cursor, input and dialog lifecycle.
 */

import React, { useState, useCallback, useEffect, useContext, useRef } from 'react'
import { useStdout } from 'ink'
import { useKeymapInput } from '../../config/keymap.js'
import { useGh } from '../../hooks/useGh.js'
import { usePendingWrite } from '../../hooks/usePendingWrite.js'
import { listIssuesPage, getIssueRow } from '../../executor.js'
import { sanitize } from '../../utils.js'
import { AppContext } from '../../context.js'
import { useKeyScope } from '../../keyscope.js'
import { loadConfig } from '../../config.js'
import { firstActionKey, matchesAction } from '../../config/actions.js'
import { useTheme } from '../../theme.js'
import { IssueListDialogs } from './list-dialogs.jsx'
import { IssueListView } from './list-view.jsx'

const _appConfig = loadConfig()
const _cfg = _appConfig.issues
const _actions = _appConfig.toml
// GitHub search never returns more than 1,000 results.
const SEARCH_CAP = 1000

export function IssueList({ repo, listHeight = 10, onSelectIssue, onPaneState, initialCursor = 0, initialScrollOffset = 0 }) {
  useKeyScope('pane')
  const { t } = useTheme()
  const { notifyDialog } = useContext(AppContext)
  const { stdout } = useStdout()
  const visibleHeight = listHeight || Math.max(5, (stdout?.rows || 24) - 8)

  const FK = _cfg.keys
  const [filterState, setFilterState] = useState(_cfg.defaultFilter)
  const [sortMode, setSortMode] = useState('default') // 'default' | 'oldest'
  const { data: firstPage, loading, error, refetch: refetchFirst, isStale } = useGh(listIssuesPage, [repo, { state: filterState, limit: _cfg.pageSize, sort: sortMode }])

  // Later pages are fetched by cursor and appended; earlier pages are never refetched (D16).
  const pageKey = `${repo}|${filterState}|${sortMode}`
  const emptyMore = (key) => ({ key, items: [], endCursor: null, hasNextPage: null, totalCount: null, loading: false, error: null })
  const [more, setMore] = useState(() => emptyMore(pageKey))
  const extra = more.key === pageKey ? more : emptyMore(pageKey)
  // Writes patch rows in place (number -> row, or null when it left this filter) and
  // prepend created issues, so a close or label edit at row 400 keeps every loaded page.
  const [overlay, setOverlay] = useState({ key: pageKey, rows: {}, added: [] })
  const patches = overlay.key === pageKey ? overlay : { key: pageKey, rows: {}, added: [] }
  const inFlight = useRef(false)
  const currentKey = useRef(pageKey)
  currentKey.current = pageKey
  // A new filter/sort starts clean: no pages, cursor or in-flight request carried over.
  useEffect(() => {
    inFlight.current = false
    setMore(emptyMore(pageKey))
    setOverlay({ key: pageKey, rows: {}, added: [] })
  }, [pageKey]) // eslint-disable-line react-hooks/exhaustive-deps
  // Explicit `r`: start over from page 1.
  const refetch = useCallback(() => {
    inFlight.current = false
    setMore(emptyMore(pageKey))
    setOverlay({ key: pageKey, rows: {}, added: [] })
    refetchFirst()
  }, [pageKey, refetchFirst])
  const [cursor, setCursor] = useState(initialCursor)
  const [scrollOffset, setScrollOffset] = useState(initialScrollOffset)
  const [dialog, setDialog] = useState(null)
  const [statusMsg, setStatusMsg] = useState(null)
  const lastKeyRef   = useRef(null)
  const lastKeyTimer = useRef(null)

  const hasNextPage = extra.hasNextPage ?? firstPage?.hasNextPage ?? false
  const endCursor = extra.endCursor ?? firstPage?.endCursor ?? null
  const totalCount = extra.totalCount ?? firstPage?.totalCount ?? null
  const rawItems = React.useMemo(() => {
    const seen = new Set()
    return [...(firstPage?.items || []), ...extra.items].filter(i => !seen.has(i.number) && seen.add(i.number))
  }, [firstPage, extra.items])
  const items = React.useMemo(() => {
    const seen = new Set()
    return [...patches.added, ...rawItems]
      .filter(i => !seen.has(i.number) && seen.add(i.number))
      .map(i => (i.number in patches.rows ? patches.rows[i.number] : i))
      .filter(Boolean)
  }, [rawItems, patches])
  const STATE_CYCLE = ['open', 'closed']

  const loadMore = useCallback(async () => {
    if (inFlight.current || !endCursor) return
    const requestKey = pageKey
    inFlight.current = true
    setMore(prev => ({ ...(prev.key === requestKey ? prev : emptyMore(requestKey)), loading: true, error: null }))
    try {
      const page = await listIssuesPage(repo, { state: filterState, limit: _cfg.pageSize, sort: sortMode, after: endCursor })
      if (currentKey.current !== requestKey) return // filter changed meanwhile: drop the stale page
      setMore(prev => ({
        key: requestKey,
        items: [...(prev.key === requestKey ? prev.items : []), ...page.items],
        endCursor: page.endCursor, hasNextPage: page.hasNextPage, totalCount: page.totalCount,
        loading: false, error: null,
      }))
    } catch (err) {
      if (currentKey.current !== requestKey) return
      setMore(prev => ({ ...(prev.key === requestKey ? prev : emptyMore(requestKey)), loading: false, error: err }))
    } finally {
      if (currentKey.current === requestKey) inFlight.current = false
    }
  }, [repo, filterState, sortMode, endCursor, pageKey]) // eslint-disable-line react-hooks/exhaustive-deps

  // Retry only the page that failed; the pages already loaded stay.
  const retryPage = useCallback(() => {
    setMore(prev => (prev.key === pageKey ? { ...prev, error: null } : prev))
  }, [pageKey])

  // After a write, re-read just that issue and patch its row (or drop it when it no
  // longer matches the filter). Falls back to a full refetch only if that read fails.
  const refreshIssue = useCallback(async (number, { added = false } = {}) => {
    const key = pageKey
    try {
      const row = await getIssueRow(repo, number)
      if (currentKey.current !== key) return
      const keep = filterState === 'all' || String(row.state).toLowerCase() === filterState
      setOverlay(prev => {
        const base = prev.key === key ? prev : { key, rows: {}, added: [] }
        return {
          key,
          rows: { ...base.rows, [number]: keep ? row : null },
          added: added && keep && sortMode !== 'oldest' ? [row, ...base.added] : base.added,
        }
      })
    } catch {
      refetch()
    }
  }, [repo, filterState, sortMode, pageKey, refetch])

  // Fetch the next cursor page when the cursor nears the end of what is loaded.
  useEffect(() => {
    if (hasNextPage && !loading && !error && !extra.loading && !extra.error && cursor >= rawItems.length - 10) loadMore()
  }, [cursor, rawItems.length, hasNextPage, loading, error, extra.loading, extra.error, loadMore])

  useEffect(() => {
    if (onPaneState) onPaneState({ loading, error, count: items.length, isStale })
  }, [loading, error, items.length, isStale]) // eslint-disable-line react-hooks/exhaustive-deps

  // A refetch can shrink the list (closed issue, read notification); keep the cursor on a real row.
  useEffect(() => {
    if (items.length > 0 && cursor > items.length - 1) {
      const last = items.length - 1
      setCursor(last)
      setScrollOffset(Math.max(0, last - visibleHeight + 1))
    }
  }, [items.length]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    notifyDialog(!!dialog)
    if (onPaneState) onPaneState({ dialogHint: dialog || null })
    return () => { notifyDialog(false); if (onPaneState) onPaneState({ dialogHint: null }) }
  }, [dialog, notifyDialog]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => () => { clearTimeout(lastKeyTimer.current) }, [])

  const statusTimer = useRef(null)
  useEffect(() => () => { clearTimeout(statusTimer.current) }, [])
  const showStatus = (msg, isError = false, sticky = false) => {
    clearTimeout(statusTimer.current)
    setStatusMsg({ msg, isError, persist: isError })
    if (!isError && !sticky) statusTimer.current = setTimeout(() => setStatusMsg(null), 3000)
  }
  // Pending/double-submit guard for close and create (#453). Lives here, not in
  // the dialogs, because the dialogs unmount as soon as they close.
  const { run: pendingRun } = usePendingWrite((msg) => showStatus(msg, false, true))
  // Resolves true only when fn ran (false when ignored as a double submit).
  const runWrite = async (label, fn) => {
    let ran = false
    const result = await pendingRun(label, async () => { ran = true; return fn() })
    return { ran, result }
  }

  const moveCursor = useCallback((delta) => {
    setCursor(prev => {
      const next = Math.max(0, Math.min(items.length - 1, prev + delta))
      if (next < scrollOffset) setScrollOffset(next)
      if (next >= scrollOffset + visibleHeight) setScrollOffset(next - visibleHeight + 1)
      return next
    })
  }, [items.length, scrollOffset, visibleHeight])

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
        setCursor(last); setScrollOffset(Math.max(0, last - visibleHeight + 1))
      }
      return
    }

    if (matchesAction('cursor.down', input, key, _actions)) { moveCursor(1);  return }
    if (matchesAction('cursor.up', input, key, _actions))   { moveCursor(-1); return }
    if (matchesAction('list.refresh', input, key, _actions)) { if (extra.error) retryPage(); else refetch(); return }
    if (matchesAction('list.search', input, key, _actions)) { setDialog('fuzzy'); return }
    if (matchesAction('issue.new', input, key, _actions)) { setDialog('new'); return }

    // Direct filter keys from config (defaults: O=open, C=closed)
    if (FK.filterOpen   && input === FK.filterOpen   && filterState !== 'open')   { setFilterState('open');   showStatus('▸ open');   setCursor(0); setScrollOffset(0); return }
    if (FK.filterClosed && input === FK.filterClosed && filterState !== 'closed') { setFilterState('closed'); showStatus('▸ closed'); setCursor(0); setScrollOffset(0); return }
    // f still cycles as fallback
    if (matchesAction('issue.filter-cycle', input, key, _actions)) {
      setFilterState(prev => {
        const next = STATE_CYCLE[(STATE_CYCLE.indexOf(prev) + 1) % STATE_CYCLE.length]
        showStatus(`▸ ${next}`)
        return next
      })
      setCursor(0); setScrollOffset(0)
      return
    }

    // s — cycle age sort
    if (matchesAction('issue.sort-cycle', input, key, _actions)) {
      setSortMode(prev => {
        const next = prev === 'default' ? 'oldest' : 'default'
        showStatus(next === 'oldest' ? 'sort: oldest first' : 'sort: default')
        return next
      })
      setCursor(0); setScrollOffset(0)
      return
    }

    if (loading || items.length === 0) return
    const issue = items[cursor]

    if (matchesAction('issue.open-selected', input, key, _actions)) {
      if (issue) onSelectIssue(issue)
      return
    }

    // y — copy issue URL
    if (matchesAction('issue.copy-url', input, key, _actions) && issue?.url) {
      import('execa').then(({ execa }) => {
        const [cmd, args] = process.platform === 'darwin'
          ? ['pbcopy', []]
          : ['xclip', ['-selection', 'clipboard']]
        const proc = execa(cmd, args)
        proc.stdin?.end(issue.url)
        proc.then(() => showStatus(`✓ Copied ${sanitize(issue.url)}`)).catch(() => showStatus('✗ Copy failed', true))
      })
      return
    }

    if (matchesAction('issue.close', input, key, _actions)) {
      if (issue) setDialog('close')
      return
    }

    if (matchesAction('issue.labels', input, key, _actions)) {
      if (issue) setDialog('labels')
      return
    }

    if (matchesAction('issue.assignees', input, key, _actions)) {
      if (issue) setDialog('assignees')
      return
    }

    if (matchesAction('issue.open-browser', input, key, _actions) && issue?.url) {
      import('execa').then(({ execa }) => {
        const cmd = process.platform === 'darwin' ? 'open' : 'xdg-open'
        execa(cmd, [issue.url]).catch(() => {})
      })
      return
    }
  })

  const selectedIssue = items[cursor]
  const visibleIssues = items.slice(scrollOffset, scrollOffset + visibleHeight)

  if (dialog === 'fuzzy' || dialog === 'new' || (selectedIssue && ['close', 'labels', 'assignees'].includes(dialog))) {
    return (
      <IssueListDialogs
        dialog={dialog}
        repo={repo}
        items={items}
        selectedIssue={selectedIssue}
        setCursor={setCursor}
        setScrollOffset={setScrollOffset}
        onClose={() => setDialog(null)}
        showStatus={showStatus}
        runWrite={runWrite}
        refetch={refetch}
        refreshIssue={refreshIssue}
      />
    )
  }

  return (
    <IssueListView
      items={items}
      loading={loading}
      error={error}
      filterState={filterState}
      sortMode={sortMode}
      statusMsg={statusMsg}
      filterKeys={FK}
      actions={_actions}
      t={t}
      visibleHeight={visibleHeight}
      visibleIssues={visibleIssues}
      scrollOffset={scrollOffset}
      cursor={cursor}
      paging={{ hasMore: hasNextPage, total: totalCount, loadingMore: extra.loading, error: extra.error, cap: SEARCH_CAP }}
    />
  )
}
