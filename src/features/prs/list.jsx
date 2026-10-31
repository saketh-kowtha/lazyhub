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
import { useStdout } from 'ink'
import { useKeymapInput } from '../../config/keymap.js'
import { useKeyScope } from '../../keyscope.js'
import { useGh } from '../../hooks/useGh.js'
import { listPRs, getRepoInfo } from '../../executor.js'
import { AppContext } from '../../context.js'
import { usePaneState } from '../../hooks/usePaneState.js'
import { loadConfig, loadState, saveState } from '../../config.js'
import { firstActionKey, matchesAction } from '../../config/actions.js'
import { useTheme } from '../../theme/index.js'
import { sanitize } from '../../utils.js'
import {
  schemeToT,
  canToggleAutoMergeFromList,
} from './list-row.jsx'
import { usePendingWrite } from '../../hooks/usePendingWrite.js'
import { renderPRListDialog } from './list-dialog-view.jsx'
import { PRListView } from './list-view.jsx'

const _appConfig = loadConfig()
const _cfg = _appConfig.pr
const _actions = _appConfig.toml
const STATE_CYCLE = ['open', 'closed', 'merged']
const FILTER_BINDINGS = [['filterOpen', 'open'], ['filterClosed', 'closed'], ['filterMerged', 'merged']]

export { schemeToT, canToggleAutoMergeFromList } from './list-row.jsx'

export function PRList({ repo, listHeight = 10, innerWidth, onSelectPR, onOpenDiff, onPaneState }) {
  useKeyScope('pane')
  const { scheme } = useTheme()
  const t = schemeToT(scheme)
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
  const _persistedScope = loadState().prScope
  const [savedState, setSavedState] = usePaneState('prs', {
    filterStates: [_cfg.defaultFilter],
    scope: _persistedScope || _cfg.defaultScope,
    sortMode: 'default',
    authorFilter: '',
    limit: _cfg.pageSize,
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
  const [limit, setLimitRaw] = useState(savedState.limit)

  // Single state → pass it directly; multi-state → fetch 'all' and filter client-side
  const apiState = filterStates.size === 1 ? [...filterStates][0] : 'all'
  const { data: prs, loading, error, refetch, isStale } = useGh(listPRs, [repo, { state: apiState, scope, author: authorFilter || undefined, limit }])
  const { data: repoInfo } = useGh(getRepoInfo, [repo], { ttl: 300_000 })

  const [cursor, setCursorRaw] = useState(savedState.cursor)
  const [scrollOffset, setScrollOffsetRaw] = useState(savedState.scrollOffset)

  // Wrap setters to also persist to pane state map
  const setFilterStates = (updater) => {
    const next = typeof updater === 'function' ? updater(filterStates) : updater
    const arr = Array.from(next)
    setFilterStatesArr(arr)
    setSavedState({ filterStates: arr })
  }
  const setScope = (v) => { setScopeRaw(v); setSavedState({ scope: v }); saveState({ prScope: v }) }
  const setSortMode = (v) => { setSortModeRaw(v); setSavedState({ sortMode: v }) }
  const setAuthorFilter = (v) => { setAuthorFilterRaw(v); setSavedState({ authorFilter: v }) }
  const setLimit = (v) => { setLimitRaw(v); setSavedState({ limit: typeof v === 'function' ? v(limit) : v }) }
  const setCursor = (v) => { setCursorRaw(v); setSavedState({ cursor: typeof v === 'function' ? v(cursor) : v }) }
  const setScrollOffset = (v) => { setScrollOffsetRaw(v); setSavedState({ scrollOffset: typeof v === 'function' ? v(scrollOffset) : v }) }
  const [dialog, setDialog] = useState(null)
  const [mergeOptions, setMergeOptions] = useState(null)
  const [statusMsg, setStatusMsg] = useState(null)
  // Popover is auto-shown for the focused row. ESC dismisses it for the
  // current row; any cursor change clears the dismissal so it reappears.
  const [popoverDismissed, setPopoverDismissed] = useState(false)
  const lastKeyRef   = useRef(null)
  const lastKeyTimer = useRef(null)

  const rawItems = (prs || []).filter(pr => pr && pr.number && filterStates.has((pr.state || '').toLowerCase()))
  const items = sortMode === 'oldest'
    ? [...rawItems].sort((a, b) => new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime())
    : rawItems

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
  const { run: runWrite } = usePendingWrite((msg) => showStatus(msg, false, true))

  const moveCursor = useCallback((delta) => {
    const next = Math.max(0, Math.min(items.length - 1, cursor + delta))
    if (next !== cursor) setPopoverDismissed(false)
    setCursor(next)
    if (next < scrollOffset) setScrollOffset(next)
    if (next >= scrollOffset + effectiveHeight) setScrollOffset(next - effectiveHeight + 1)
    if (next >= items.length - 10 && !loading && items.length >= limit) {
      setLimit(l => l + 100)
    }
  }, [cursor, items.length, limit, scrollOffset, effectiveHeight, loading])

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
    if (matchesAction('list.refresh', input, key, _actions)) { refetch(); return }
    if (matchesAction('list.search', input, key, _actions)) { openDialog('fuzzy'); return }

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

    if (matchesAction('pr.open-selected', input, key, _actions)) { onSelectPR(pr); return }
    if (matchesAction('pr.diff', input, key, _actions)) { onOpenDiff(pr); return }
    if (matchesAction('pr.merge', input, key, _actions)) { openDialog('merge'); return }
    if (matchesAction('pr.labels', input, key, _actions)) { openDialog('labels'); return }
    if (matchesAction('pr.assignees', input, key, _actions)) { openDialog('assignees'); return }
    if (matchesAction('pr.reviewers', input, key, _actions)) { openDialog('reviewers'); return }
    if (matchesAction('pr.approve', input, key, _actions)) { openDialog('approve-body'); return }
    if (matchesAction('pr.request-changes', input, key, _actions)) { openDialog('reqchanges-body'); return }
    if (matchesAction('pr.close', input, key, _actions)) { openDialog('close-pr'); return }

    if (matchesAction('pr.checkout', input, key, _actions)) { openDialog('checkout'); return }

    // y — copy PR URL to clipboard
    if (matchesAction('pr.copy-url', input, key, _actions) && pr.url) {
      import('execa').then(({ execa }) => {
        const [cmd, args] = process.platform === 'darwin'
          ? ['pbcopy', []]
          : ['xclip', ['-selection', 'clipboard']]
        const proc = execa(cmd, args)
        proc.stdin?.end(pr.url)
        proc.then(() => showStatus(`✓ Copied ${pr.url}`)).catch(() => showStatus('✗ Copy failed', true))
      })
      return
    }

    if (matchesAction('pr.open-browser', input, key, _actions) && pr.url) {
      import('execa').then(({ execa }) => {
        const cmd = process.platform === 'darwin' ? 'open' : 'xdg-open'
        execa(cmd, [pr.url]).catch(() => {})
      })
      return
    }

  })

  // ── Dialogs ───────────────────────────────────────────────────────────────

  const selectedPR = items[cursor]

  const dialogView = renderPRListDialog({
    dialog, selectedPR, items, repo, repoInfo, authorFilter, effectiveHeight,
    mergeOptions, setMergeOptions, setDialog, setCursor, setScrollOffset,
    setAuthorFilter, showStatus, closeDialog, refetch, runWrite,
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
      popoverDismissed={popoverDismissed || _appConfig.layout.previewPanel === false}
      setPopoverDismissed={setPopoverDismissed}
      expansionEnabled={expansionEnabled}
      scheme={scheme}
    />
  )
}
