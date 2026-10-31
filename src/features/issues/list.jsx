// @ts-nocheck
// TODO(#197): issue list view needs explicit item/dialog prop typedefs.
/**
 * Issue list controller: query, filters, cursor, input and dialog lifecycle.
 */

import React, { useState, useCallback, useEffect, useContext, useRef } from 'react'
import { useStdout } from 'ink'
import { useKeymapInput } from '../../config/keymap.js'
import { useGh } from '../../hooks/useGh.js'
import { listIssuesPage } from '../../executor.js'
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
  const { data: firstPage, loading, error, refetch: refetchFirst, isStale } = useGh(listIssuesPage, [repo, { state: filterState, limit: _cfg.pageSize }])

  // Later pages are fetched by cursor and appended; earlier pages are never refetched (D16).
  const pageKey = `${repo}|${filterState}`
  const [more, setMore] = useState({ key: pageKey, items: [], endCursor: null, hasNextPage: null, totalCount: null, loading: false, error: null })
  const extra = more.key === pageKey ? more : { items: [], endCursor: null, hasNextPage: null, totalCount: null, loading: false, error: null }
  const inFlight = useRef(false)
  const refetch = useCallback(() => {
    setMore({ key: pageKey, items: [], endCursor: null, hasNextPage: null, totalCount: null, loading: false, error: null })
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
  const items = sortMode === 'oldest'
    ? [...rawItems].sort((a, b) => new Date(a.updatedAt) - new Date(b.updatedAt))
    : rawItems
  const STATE_CYCLE = ['open', 'closed']

  const loadMore = useCallback(async () => {
    if (inFlight.current || !endCursor) return
    inFlight.current = true
    setMore(prev => ({ ...(prev.key === pageKey ? prev : { items: [] }), key: pageKey, loading: true, error: null }))
    try {
      const page = await listIssuesPage(repo, { state: filterState, limit: _cfg.pageSize, after: endCursor })
      setMore(prev => ({
        key: pageKey,
        items: [...(prev.key === pageKey ? prev.items : []), ...page.items],
        endCursor: page.endCursor, hasNextPage: page.hasNextPage, totalCount: page.totalCount,
        loading: false, error: null,
      }))
    } catch (err) {
      setMore(prev => ({ ...(prev.key === pageKey ? prev : { items: [] }), key: pageKey, loading: false, error: err }))
    } finally {
      inFlight.current = false
    }
  }, [repo, filterState, endCursor, pageKey])

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

  const showStatus = (msg, isError = false) => {
    setStatusMsg({ msg, isError, persist: isError })
    if (!isError) setTimeout(() => setStatusMsg(null), 3000)
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
    if (matchesAction('list.refresh', input, key, _actions)) { refetch(); return }
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
        refetch={refetch}
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
