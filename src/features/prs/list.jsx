// @ts-check

/**
 * src/features/prs/list.jsx — PR list pane
 *
 * Props:
 *   repo         string
 *   listHeight   number   — visible row count from App
 *   onHover      fn(pr)   — called when cursor moves (for side panel)
 *   onSelectPR   fn(pr)   — called on Enter → full detail
 *   onOpenDiff   fn(pr)   — called on 'd'
 *   onPaneState  fn({loading, error, count})
 */

import React, { useState, useCallback, useEffect, useContext, useRef } from 'react'
import { Box, Text, useStdout } from 'ink'
import { useKeymapInput } from '../../config/keymap.js'
import { useKeyScope } from '../../keyscope.js'
import { useGh } from '../../hooks/useGh.js'
import {
  listPRs, listLabels, listCollaborators,
  enableAutoMerge, disableAutoMerge, mergePR, closePR, checkoutBranch, addLabels, removeLabels,
  requestReviewers, removeReviewers, reviewPR, getRepoInfo,
  addPRAssignees, removePRAssignees,
} from '../../executor.js'
import { FuzzySearch } from '../../components/dialogs/FuzzySearch.jsx'
import { MultiSelect } from '../../components/dialogs/MultiSelect.jsx'
import { OptionPicker } from '../../components/dialogs/OptionPicker.jsx'
import { ConfirmDialog } from '../../components/dialogs/ConfirmDialog.jsx'
import { FormCompose } from '../../components/dialogs/FormCompose.jsx'
import { NewPRDialog } from './NewPRDialog.jsx'
import { AppContext } from '../../context.js'
import { usePaneState } from '../../hooks/usePaneState.js'
import { loadConfig, loadState, saveState } from '../../config.js'
import { firstActionKey, matchesAction } from '../../config/actions.js'
import { useTheme } from '../../theme/index.js'
import { sanitize } from '../../utils.js'
import {
  schemeToT,
  canToggleAutoMergeFromList,
  MERGE_OPTIONS,
} from './list-row.jsx'
import { LabelDialog, AssigneeDialog, AuthorSearchDialog, ReviewerDialog } from './list-dialogs.jsx'
import { PRListView } from './list-view.jsx'

const _appConfig = loadConfig()
const _cfg = _appConfig.pr
const _actions = _appConfig.toml

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
  const STATE_CYCLE = ['open', 'closed', 'merged']

  // Notify parent of loading/error/count — cursor/scrollOffset stay local
  useEffect(() => {
    if (onPaneState) onPaneState({ loading, error, count: items.length, isStale })
  }, [loading, error, items.length, isStale]) // eslint-disable-line react-hooks/exhaustive-deps

  // Notify App when dialog opens/closes so global keys are suppressed + footer updates
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
    const next = Math.max(0, Math.min(items.length - 1, cursor + delta))
    if (next !== cursor) setPopoverDismissed(false)
    setCursor(next)
    if (next < scrollOffset) setScrollOffset(next)
    if (next >= scrollOffset + effectiveHeight) setScrollOffset(next - effectiveHeight + 1)
    if (next >= items.length - 10 && !loading) {
      setLimit(l => l + 100)
    }
  }, [cursor, items.length, scrollOffset, effectiveHeight, loading])

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
    if (matchesAction('pr.auto-merge', input, key, _actions) && canToggleAutoMergeFromList(focusedPR)) {
      if (focusedPR.autoMergeRequest) {
        disableAutoMerge(repo, focusedPR.number)
          .then(() => { showStatus('✓ Auto-merge disabled'); refetch() })
          .catch(err => showStatus(`✗ Auto-merge failed: ${err.message}`, true))
      } else {
        enableAutoMerge(repo, focusedPR.number, repoInfo?.squashMergeAllowed ? 'squash' : 'merge')
          .then(() => { showStatus('⟳ Auto-merge enabled'); refetch() })
          .catch(err => showStatus(`✗ Auto-merge failed: ${err.message}`, true))
      }
      return
    }

    // Filter state toggles (defaults: O/C/M) — press to toggle state in/out of active set
    if (FK.filterOpen && input === FK.filterOpen) {
      setFilterStates(prev => { const n = new Set(prev); n.has('open') ? (n.size > 1 && n.delete('open')) : n.add('open'); return n })
      setCursor(0); setScrollOffset(0); return
    }
    if (FK.filterClosed && input === FK.filterClosed) {
      setFilterStates(prev => { const n = new Set(prev); n.has('closed') ? (n.size > 1 && n.delete('closed')) : n.add('closed'); return n })
      setCursor(0); setScrollOffset(0); return
    }
    if (FK.filterMerged && input === FK.filterMerged) {
      setFilterStates(prev => { const n = new Set(prev); n.has('merged') ? (n.size > 1 && n.delete('merged')) : n.add('merged'); return n })
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

  if (dialog === 'fuzzy') {
    const fuzzyItems = items.map(pr => ({ ...pr, authorLogin: pr.author?.login || '' }))
    return (
      <FuzzySearch
        items={fuzzyItems}
        searchFields={['title', 'number', 'authorLogin', 'headRefName']}
        onSubmit={(item) => {
          const idx = items.findIndex(p => p.number === item.number)
          if (idx !== -1) {
            setCursor(idx)
            setScrollOffset(Math.max(0, idx - Math.floor(effectiveHeight / 2)))
          }
          closeDialog()
        }}
        onCancel={closeDialog}
      />
    )
  }

  if (dialog === 'author-search') {
    return (
      <AuthorSearchDialog
        current={authorFilter}
        onSubmit={(author) => {
          setAuthorFilter(author)
          setCursor(0); setScrollOffset(0)
          showStatus(author ? `author: @${author}` : 'author: all')
          closeDialog()
        }}
        onCancel={closeDialog}
      />
    )
  }

  if (dialog === 'merge' && selectedPR) {
    return (
      <OptionPicker
        title={`Merge PR #${selectedPR.number}: ${sanitize(selectedPR.title)}`}
        options={MERGE_OPTIONS}
        promptText="Commit message (optional, Enter to skip)"
        onSubmit={(val) => {
          const strategy = typeof val === 'object' ? val.value : val
          const msg      = typeof val === 'object' ? val.text  : undefined
          setMergeOptions({ strategy, msg })
          setDialog('merge-confirm')
        }}
        onCancel={closeDialog}
      />
    )
  }

  if (dialog === 'merge-confirm' && selectedPR && mergeOptions) {
    return (
      <ConfirmDialog
        message={`Merge PR #${selectedPR.number} via --${mergeOptions.strategy}?${mergeOptions.msg ? `\nMessage: "${mergeOptions.msg}"` : ''}`}
        destructive={true}
        onConfirm={async () => {
          closeDialog()
          try {
            await mergePR(repo, selectedPR.number, mergeOptions.strategy, mergeOptions.msg)
            showStatus(`✓ Merged PR #${selectedPR.number}`)
            refetch()
          } catch (err) {
            showStatus(`✗ Merge failed: ${err.message}`, true)
          }
        }}
        onCancel={closeDialog}
      />
    )
  }

  if (dialog === 'checkout' && selectedPR) {
    return (
      <ConfirmDialog
        message={`Checkout branch "${selectedPR.headRefName}" from PR #${selectedPR.number}?`}
        destructive={false}
        onConfirm={async () => {
          closeDialog()
          try {
            await checkoutBranch(repo, selectedPR.number)
            showStatus(`✓ Checked out ${selectedPR.headRefName}`)
          } catch (err) {
            showStatus(`✗ Checkout: ${err.message}`, true)
          }
        }}
        onCancel={closeDialog}
      />
    )
  }

  if (dialog === 'close-pr' && selectedPR) {
    return (
      <ConfirmDialog
        message={`Close PR #${selectedPR.number}: ${sanitize(selectedPR.title)}?`}
        destructive={true}
        onConfirm={async () => {
          closeDialog()
          try {
            await closePR(repo, selectedPR.number)
            showStatus(`Closed PR #${selectedPR.number}`)
            refetch()
          } catch (err) {
            showStatus(`Failed: ${err.message}`, true)
          }
        }}
        onCancel={closeDialog}
      />
    )
  }

  if (dialog === 'labels' && selectedPR) {
    return <LabelDialog repo={repo} pr={selectedPR} onClose={() => { closeDialog(); refetch() }} />
  }

  if (dialog === 'assignees' && selectedPR) {
    return <AssigneeDialog repo={repo} pr={selectedPR} onClose={() => { closeDialog(); refetch() }} />
  }

  if (dialog === 'reviewers' && selectedPR) {
    return <ReviewerDialog repo={repo} pr={selectedPR} onClose={() => { closeDialog(); refetch() }} />
  }

  if (dialog === 'approve-body' && selectedPR) {
    return (
      <FormCompose
        title={`Approve PR #${selectedPR.number}`}
        fields={[{ name: 'body', label: 'Optional comment (Ctrl+G to submit, leave empty to skip)', type: 'text' }]}
        onSubmit={async (values) => {
          closeDialog()
          try {
            await reviewPR(repo, selectedPR.number, 'approve', values.body || '')
            showStatus(`✓ Approved PR #${selectedPR.number}`)
          } catch (err) {
            showStatus(`✗ ${err.message}`, true)
          }
        }}
        onCancel={closeDialog}
      />
    )
  }

  if (dialog === 'new-pr') {
    return (
      <Box flexDirection="column" flexGrow={1} paddingY={1} paddingX={1}>
        <NewPRDialog
          repo={repo}
          onClose={closeDialog}
          onCreated={() => { showStatus('✓ PR created'); refetch() }}
        />
      </Box>
    )
  }

  if (dialog === 'reqchanges-body' && selectedPR) {
    return (
      <FormCompose
        title={`Request changes on PR #${selectedPR.number}`}
        fields={[{ name: 'body', label: 'Describe the changes needed', type: 'text' }]}
        onSubmit={async (values) => {
          closeDialog()
          try {
            await reviewPR(repo, selectedPR.number, 'request-changes', values.body)
            showStatus(`✓ Requested changes on PR #${selectedPR.number}`)
          } catch (err) {
            showStatus(`✗ ${err.message}`, true)
          }
        }}
        onCancel={closeDialog}
      />
    )
  }

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
      popoverDismissed={popoverDismissed}
      setPopoverDismissed={setPopoverDismissed}
      expansionEnabled={expansionEnabled}
      scheme={scheme}
    />
  )
}

// ─── Sub-dialogs ──────────────────────────────────────────────────────────────
