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

import React, { useState, useCallback, useEffect, useContext, useRef, memo } from 'react'
import { Box, Text, useStdout } from 'ink'
import { useKeymapInput } from '../../config/keymap.js'
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
import { sanitize, TextInput, shortAge, authorColor, truncateToWidth, padEndWidth, padStartWidth } from '../../utils.js'
import { PRListSkeleton } from '../../components/Skeleton.jsx'
import { Popover } from '../../ui/Popover.jsx'

const _appConfig = loadConfig()
const _cfg = _appConfig.pr
const _actions = _appConfig.toml

// ─── Theme adapter ────────────────────────────────────────────────────────────
// Maps the new token scheme (src/theme/index.js) to the legacy `t.*` shape
// consumed by every sub-component in this file.  All token values are 1:1
// with the lazyhub-dark scheme values that existed before this migration.
//
// Token map:
//   t.ui.muted    → scheme.fg.muted      (#768390 muted secondary text)
//   t.ui.dim      → scheme.fg.subtle     (#545d68 tertiary/separator text)
//   t.ui.selected → scheme.accent.primary (#539bf5 focused row / active)
//   t.pr.*        → scheme.pr.*          (open/draft/merged/closed indicators)
//   t.ci.*        → scheme.ci.*          (pass/fail/pending/skipped)
//   t.review.*    → mapped to ci.pass/ci.fail (same semantic)
//   t.pr.conflict → scheme.ci.pending    (amber; identical value in old theme)
/**
 * Maps a new-style token scheme object (src/theme/index.js) to the legacy
 * `t.*` shape consumed by PR list sub-components.
 *
 * @param {object} scheme - Active scheme from useTheme().scheme
 * @returns {{ ui: object, pr: object, ci: object, review: object }}
 */
export function schemeToT(scheme) {
  return {
    ui: {
      muted:    scheme.fg.muted,
      dim:      scheme.fg.subtle,
      selected: scheme.accent.primary,
    },
    pr: {
      open:     scheme.pr.open,
      draft:    scheme.pr.draft,
      merged:   scheme.pr.merged,
      closed:   scheme.pr.closed,
      // conflict had no token; old theme used ci.pending amber — keep that.
      conflict: scheme.ci.pending,
    },
    ci: {
      pass:    scheme.ci.pass,
      fail:    scheme.ci.fail,
      pending: scheme.ci.pending,
      skipped: scheme.ci.skipped,
    },
    review: {
      approved: scheme.ci.pass,
      changes:  scheme.ci.fail,
    },
  }
}

// ─── Age colour ───────────────────────────────────────────────────────────────

function ageColor(updatedAt, t) {
  if (!updatedAt) return t.ui.dim
  const days = (Date.now() - new Date(updatedAt).getTime()) / 86_400_000
  if (days < 0.167) return t.ci.pass   // < 4h — fresh, green
  if (days < 3)     return undefined    // 4h–3d — recent, default
  if (days < 7)     return t.ci.pending // 3–7d — aging, yellow
  if (days < 21)    return t.ci.fail    // 7–21d — stale, red
  return t.ui.dim                        // > 21d — frozen, dim
}

// ─── Badges ───────────────────────────────────────────────────────────────────

function PRStateBadge({ pr, t }) {
  const conflicting = pr.state === 'OPEN' && pr.mergeable === 'CONFLICTING'
  if (pr.isDraft)   return <Text color={t.pr.draft}>◐</Text>
  if (conflicting)  return <Text color={t.pr.conflict || t.ci.pending}>▲</Text>
  switch (pr.state) {
    case 'OPEN':
      if (pr.autoMergeRequest) return <Text color={t.pr.merged}>⟳</Text>
      return <Text color={t.pr.open}>●</Text>
    case 'MERGED': return <Text color={t.pr.merged}>●</Text>
    case 'CLOSED': return <Text color={t.pr.closed}>●</Text>
    default:       return <Text color={t.ui.muted}>●</Text>
  }
}

function CIBadge({ pr, t }) {
  const checks = pr.statusCheckRollup
  if (!checks || checks.length === 0) return null
  const total   = checks.length
  const states  = checks.map(c => c.state || c.conclusion || c.status || '')
  const failing = states.filter(s => /failure|error/i.test(s)).length
  const pending = states.filter(s => /pending|in_progress|queued/i.test(s)).length
  if (failing > 0) return <Text color={t.ci.fail}> ✗ {failing}/{total}</Text>
  if (pending > 0) return <Text color={t.ci.pending}> ● {pending}/{total}</Text>
  return <Text color={t.ci.pass}> ✓</Text>
}

function ReviewBadge({ pr, t }) {
  const rd = pr.reviewDecision
  if (!rd || rd === 'REVIEW_REQUIRED') return <Text> </Text>
  if (rd === 'APPROVED')          return <Text color={t.review?.approved || t.ci.pass}> ✓</Text>
  if (rd === 'CHANGES_REQUESTED') return <Text color={t.review?.changes  || t.ci.fail}> ✗</Text>
  return <Text> </Text>
}

// Fixed columns: paddingX(2) + cursor(1) + badge(2) + num(7) + review(2) + CI_max(8) + author(13) + age(5) = 40; +4 buffer
const PR_ROW_FIXED_COLS = 44

// ─── Expanded detail shown below selected PR ─────────────────────────────────

function PRExpandedDetail({ pr, t }) {
  const checks   = pr.statusCheckRollup || []
  const labels   = (pr.labels || []).slice(0, 5)
  const reviewers = (pr.reviewRequests || []).slice(0, 4)
  const bodyLine = (pr.body || '').trim().split('\n').find(l => l.trim()) || ''

  const failing = checks.filter(c => /failure|error/i.test(c.state || c.conclusion || '')).length
  const pending = checks.filter(c => /pending|in_progress|queued/i.test(c.state || c.conclusion || c.status || '')).length
  const passing = checks.length - failing - pending
  const ciColor = failing ? t.ci.fail : pending ? t.ci.pending : checks.length ? t.ci.pass : t.ui.dim
  const ciParts = []
  if (passing) ciParts.push(`✓ ${passing}`)
  if (pending) ciParts.push(`● ${pending}`)
  if (failing) ciParts.push(`✗ ${failing}`)
  if (checks.length) ciParts.push(`/ ${checks.length}`)

  const branch = [pr.headRefName, pr.baseRefName].filter(Boolean).join(' → ')

  return (
    <Box flexDirection="column" paddingLeft={4}>
      {branch ? (
        <Text color={t.ui.muted} wrap="truncate">⑂  {branch}</Text>
      ) : null}
      {checks.length > 0 && (
        <Text color={ciColor} wrap="truncate">   {ciParts.join('  ')}</Text>
      )}
      {labels.length > 0 && (
        <Text color={t.ui.dim} wrap="truncate">
          {'◆  ' + labels.map(l => l.name).join('  ·  ')}
        </Text>
      )}
      {reviewers.length > 0 && (
        <Text color={t.ui.dim} wrap="truncate">
          {'◇  ' + reviewers.map(r => '@' + (r.login || r.name || '')).join('  ')}
        </Text>
      )}
      {bodyLine ? (
        <Text color={t.ui.dim} dimColor italic wrap="truncate">
          {"   " + sanitize(bodyLine).slice(0, 120)}
        </Text>
      ) : null}
    </Box>
  )
}

const PRRow = memo(({ pr, isSelected, t, titleWidth, expanded }) => {
  // Use display-width-aware helpers so CJK/emoji authors don't break borders
  const rawLogin    = String(pr.author?.login || '')
  const authorLogin = padEndWidth(truncateToWidth(rawLogin, 11), 11)
  const authorClr   = authorColor(pr.author?.login)
  const ageStr      = padStartWidth(shortAge(pr.updatedAt), 4)
  const timeColor   = ageColor(pr.updatedAt, t)
  const tw          = Math.max(8, titleWidth || 20)

  return (
    <Box flexDirection="column">
      <Box paddingX={1} height={1}>
        <Text color={isSelected ? t.ui.selected : t.ui.dim}>{isSelected ? '▎' : ' '}</Text>
        <PRStateBadge pr={pr} t={t} />
        <Text color={t.ui.dim}> {'#' + String(pr.number).padEnd(5)}</Text>
        <Box width={tw} overflow="hidden">
          <Text
            color={isSelected ? t.ui.selected : undefined}
            bold={isSelected}
            italic={pr.isDraft}
            wrap="truncate"
          >
            {sanitize(pr.title)}
          </Text>
        </Box>
        <CIBadge pr={pr} t={t} />
        <ReviewBadge pr={pr} t={t} />
        <Text color={authorClr || t.ui.muted}> @{authorLogin}</Text>
        <Text color={timeColor}> {ageStr}</Text>
      </Box>
      {expanded && <PRExpandedDetail pr={pr} t={t} />}
    </Box>
  )
})

const MERGE_OPTIONS = [
  { value: 'merge',  label: '--merge',  description: 'Create a merge commit' },
  { value: 'squash', label: '--squash', description: 'Squash all commits into one' },
  { value: 'rebase', label: '--rebase', description: 'Rebase onto base branch' },
]

export function canToggleAutoMergeFromList(pr) {
  return pr?.state === 'OPEN' && !pr?.isDraft
}

// ─── PR detail popover content ────────────────────────────────────────────────

/** Default popover width in columns; clamped to terminal width at runtime. */
const POPOVER_WIDTH = 52
/** Height in rows: title(1) + meta(1) + divider(1) + body(6) + divider(1) + summary(1) + divider(1) + hint(1) + border(2) = 15 */
const POPOVER_HEIGHT = 15

/**
 * Popover content component: shows PR title, meta, body excerpt, CI summary,
 * unresolved thread count, and action hints.
 *
 * @param {object} props
 * @param {object} props.pr  - PR object from the list (includes body, statusCheckRollup, etc.)
 * @param {object} props.t   - Theme adapter object (schemeToT output).
 * @param {object} props.scheme - Raw theme scheme from useTheme().
 * @param {number} props.width  - Effective popover inner width (box width - 2 for borders).
 */
function PRDetailPopoverContent({ pr, t, scheme, width }) {
  const innerW = Math.max(10, width - 2)  // subtract left+right border

  // ── Meta line: state · @author → base · age
  const stateLabel = pr.isDraft ? 'draft' : (pr.state || '').toLowerCase()
  const stateColor = pr.isDraft ? t.pr.draft
    : pr.state === 'OPEN'   ? t.pr.open
    : pr.state === 'MERGED' ? t.pr.merged
    : t.pr.closed
  const author     = pr.author?.login || ''
  const base       = pr.baseRefName || 'main'
  const age        = shortAge(pr.updatedAt)

  // ── Body excerpt: first ~6 non-empty lines, truncated
  const bodyLines = (pr.body || '')
    .split('\n')
    .map(l => sanitize(l.trimEnd()))
    .filter(l => l.length > 0)
    .slice(0, 6)
  while (bodyLines.length < 6) bodyLines.push('')

  // ── CI summary
  const checks   = pr.statusCheckRollup || []
  const failing  = checks.filter(c => /failure|error/i.test(c.state || c.conclusion || '')).length
  const pending  = checks.filter(c => /pending|in_progress|queued/i.test(c.state || c.conclusion || c.status || '')).length
  const ciColor  = failing ? t.ci.fail : pending ? t.ci.pending : checks.length ? t.ci.pass : t.ui.dim
  const ciLabel  = checks.length === 0 ? 'no checks'
    : failing ? `✗ ${failing} failing`
    : pending ? `● ${pending} pending`
    : `✓ ci-pass`

  // ── Unresolved threads (reviewThreads not in list payload; default 0)
  const unresolvedCount = 0

  const borderColor  = scheme.border.focused

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={borderColor}
      width={width}
    >
      {/* Title */}
      <Box paddingX={1}>
        <Text color={scheme.fg.default} bold wrap="truncate">
          {'#' + pr.number + ' ' + sanitize(pr.title || '')}
        </Text>
      </Box>
      {/* Meta */}
      <Box paddingX={1}>
        <Text color={stateColor}>{stateLabel}</Text>
        <Text color={t.ui.dim}> · </Text>
        <Text color={t.ui.muted}>@{truncateToWidth(author, 12)}</Text>
        <Text color={t.ui.dim}> → </Text>
        <Text color={t.ui.muted}>{truncateToWidth(base, 16)}</Text>
        <Text color={t.ui.dim}> · </Text>
        <Text color={t.ui.dim}>{age}</Text>
      </Box>
      {/* Divider */}
      <Box><Text color={t.ui.dim}>{'─'.repeat(innerW + 2)}</Text></Box>
      {/* Body excerpt */}
      {bodyLines.map((line, idx) => (
        <Box key={idx} paddingX={1}>
          <Text color={scheme.fg.default} wrap="truncate">
            {line || ' '}
          </Text>
        </Box>
      ))}
      {/* Divider */}
      <Box><Text color={t.ui.dim}>{'─'.repeat(innerW + 2)}</Text></Box>
      {/* Summary */}
      <Box paddingX={1}>
        <Text color={ciColor}>{ciLabel}</Text>
        <Text color={t.ui.dim}> · </Text>
        <Text color={unresolvedCount > 0 ? t.ci.pending : t.ui.dim}>
          {unresolvedCount} unresolved
        </Text>
      </Box>
      {/* Divider */}
      <Box><Text color={t.ui.dim}>{'─'.repeat(innerW + 2)}</Text></Box>
      {/* Hint bar */}
      <Box paddingX={1}>
        <Text color={t.ui.dim} wrap="truncate">
          {truncateToWidth('↩ open · a approve · m merge · [p] close', innerW)}
        </Text>
      </Box>
    </Box>
  )
}

// Prevent rerenders when other rows change focus (only rerender on PR data change)
const PRDetailPopoverContentMemo = memo(PRDetailPopoverContent)

// ─── PRList ───────────────────────────────────────────────────────────────────

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
  const { data: prs, loading, error, refetch } = useGh(listPRs, [repo, { state: apiState, scope, author: authorFilter || undefined, limit }])
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
    ? [...rawItems].sort((a, b) => new Date(a.updatedAt) - new Date(b.updatedAt))
    : rawItems

  // Filter keys from config (defaults: O=open, C=closed, M=merged)
  const FK = _cfg.keys
  const STATE_CYCLE = ['open', 'closed', 'merged']

  // Notify parent of loading/error/count — cursor/scrollOffset stay local
  useEffect(() => {
    if (onPaneState) onPaneState({ loading, error, count: items.length })
  }, [loading, error, items.length]) // eslint-disable-line react-hooks/exhaustive-deps

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

  // Popover anchor coordinates:
  //   Row 0 = filter/header bar.
  //   Row 1..N = visible PR rows.
  //   The selected row is at visual index (cursor - scrollOffset), 0-based.
  //   +1 for the header bar above the rows.
  const popoverRowIndex = cursor - scrollOffset
  const popoverAnchor = {
    x: 1,
    y: 1 + popoverRowIndex,
    width: innerWidth ? innerWidth - 2 : termCols - 2,
    height: 1,
  }
  const effectivePopoverWidth  = Math.min(POPOVER_WIDTH, termCols - 4)
  const effectivePopoverHeight = POPOVER_HEIGHT

  return (
    <Box flexDirection="column" flexGrow={1}>
      <Box paddingX={1} gap={1} overflow="hidden">
        {/* State chips — active states colored, inactive dimmed */}
        <Box gap={0}>
          {[['open', t.pr.open], ['closed', t.pr.closed], ['merged', t.pr.merged]].map(([state, color], i) => (
            <React.Fragment key={state}>
              {i > 0 && <Text color={t.ui.dim}>/</Text>}
              <Text color={filterStates.has(state) ? color : t.ui.dim} bold={filterStates.has(state)}>{state}</Text>
            </React.Fragment>
          ))}
        </Box>
        <Text color={t.ui.dim}>·</Text>
        <Text color={sortMode === 'oldest' ? t.ci.pending : scope === 'own' ? t.ui.selected : scope === 'reviewing' ? t.ci.pending : t.ui.muted} bold>
          {sortMode === 'oldest' ? '↑ oldest' : scope === 'own' ? 'mine' : scope === 'reviewing' ? 'reviewing' : 'all'}
        </Text>
        {authorFilter && (
          <>
            <Text color={t.ui.dim}>·</Text>
            <Text color={t.ci.pending}>@{authorFilter}</Text>
            <Text color={t.ui.dim}> [@] change</Text>
          </>
        )}
        {loading && items.length > 0 && <Text color={t.ui.dim}>⟳</Text>}
        {statusMsg
          ? <Text color={statusMsg.isError ? t.ci.fail : t.ci.pass}>{statusMsg.msg}{statusMsg.persist ? ' [any key]' : ''}</Text>
          : <Text color={t.ui.dim}>[{FK.filterOpen}]open [{FK.filterClosed}]closed [{FK.filterMerged}]merged [s]scope [@]author</Text>
        }
        {items.length >= _cfg.pageSize && (
          <Text color={t.ui.dim}> ({items.length})</Text>
        )}
      </Box>

      {!loading && !error && items.length === 0 && (
        <Box paddingX={2} paddingY={1} flexDirection="column" gap={0}>
          <Text color={t.ui.muted}>
            No {[...filterStates].join('/')} pull requests
            {scope === 'own' ? ' by you' : scope === 'reviewing' ? ' assigned for your review' : ''}.
          </Text>
          {scope === 'own' && (
            <Text color={t.ui.dim}>[s] show all open PRs  [r] refresh</Text>
          )}
          {scope !== 'own' && (
            <Text color={t.ui.dim}>[f] change filter  [s] change scope  [r] refresh</Text>
          )}
        </Box>
      )}

      {loading && items.length === 0 && (
        <PRListSkeleton count={height} />
      )}

      {visiblePRs.map((pr, i) => {
        const idx = scrollOffset + i
        const isSelected = idx === cursor
        return (
          <PRRow
            key={`${pr.number}`}
            pr={pr}
            isSelected={isSelected}
            t={t}
            titleWidth={innerWidth ? innerWidth - PR_ROW_FIXED_COLS : undefined}
            expanded={expansionEnabled && isSelected}
          />
        )
      })}

      {(items.length > effectiveHeight || items.length >= 100) && (
        <Box paddingX={1} justifyContent="space-between">
          <Text color={t.ui.dim}>
            {scrollOffset + 1}–{Math.min(scrollOffset + effectiveHeight, items.length)} / {items.length}
          </Text>
          {items.length >= 100 && !loading && (
            <Text color={t.ui.dim}>scroll down for more</Text>
          )}
        </Box>
      )}

      {/* Floating PR detail popover — auto-shown for focused row; position:
          absolute means no layout shift. ESC dismisses for current row;
          moving the cursor re-shows. */}
      {selectedPR && !dialog && !popoverDismissed && (
        <Popover
          anchor={popoverAnchor}
          popoverWidth={effectivePopoverWidth}
          popoverHeight={effectivePopoverHeight}
          termCols={termCols}
          termRows={termRows}
          preferredSide="right"
          onClose={() => setPopoverDismissed(true)}
        >
          <PRDetailPopoverContentMemo
            pr={selectedPR}
            t={t}
            scheme={scheme}
            width={effectivePopoverWidth}
          />
        </Popover>
      )}
    </Box>
  )
}

// ─── Sub-dialogs ──────────────────────────────────────────────────────────────

function LabelDialog({ repo, pr, onClose }) {
  const { scheme } = useTheme()
  const t = schemeToT(scheme)
  const { data: allLabels, loading } = useGh(listLabels, [repo])
  if (loading) return <Box paddingX={1}><Text color={t.ui.muted}>Loading labels…</Text></Box>

  const items = (allLabels || []).map(l => ({
    id: l.name,
    name: l.name,
    color: l.color,
    selected: pr.labels?.some(pl => pl.name === l.name) ?? false,
  }))

  return (
    <MultiSelect
      items={items}
      onSubmit={async (selectedIds) => {
        const current = pr.labels?.map(l => l.name) || []
        const toAdd    = selectedIds.filter(id => !current.includes(id))
        const toRemove = current.filter(id => !selectedIds.includes(id))
        try {
          if (toAdd.length)    await addLabels(repo, pr.number, toAdd, 'pr')
          if (toRemove.length) await removeLabels(repo, pr.number, toRemove, 'pr')
        } catch { /* ignore */ }
        onClose()
      }}
      onCancel={onClose}
    />
  )
}

function AssigneeDialog({ repo, pr, onClose }) {
  const { scheme } = useTheme()
  const t = schemeToT(scheme)
  const { data: collabs, loading } = useGh(listCollaborators, [repo])
  if (loading) return <Box paddingX={1}><Text color={t.ui.muted}>Loading collaborators…</Text></Box>

  const items = (collabs || []).map(c => ({
    id: c.login,
    name: c.login,
    selected: pr.assignees?.some(a => a.login === c.login) ?? false,
  }))

  return (
    <MultiSelect
      items={items}
      onSubmit={async (selectedIds) => {
        const current = pr.assignees?.map(a => a.login) || []
        const toAdd    = selectedIds.filter(id => !current.includes(id))
        const toRemove = current.filter(id => !selectedIds.includes(id))
        try {
          if (toAdd.length)    await addPRAssignees(repo, pr.number, toAdd)
          if (toRemove.length) await removePRAssignees(repo, pr.number, toRemove)
        } catch { /* ignore */ }
        onClose()
      }}
      onCancel={onClose}
    />
  )
}

// Simple inline author-search box
function AuthorSearchDialog({ current, onSubmit, onCancel }) {
  const { scheme } = useTheme()
  const t = schemeToT(scheme)
  const [text, setText] = useState(current || '')
  useKeyScope('dialog')

  useKeymapInput((input, key) => {
    if (key.escape) { onCancel(); return }
    if (key.return) { onSubmit(text.trim()); return }
  })

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={t.ui.selected} paddingX={2} paddingY={1}>
      <Text color={t.ui.selected} bold>Filter by author</Text>
      <Box marginTop={1} gap={1}>
        <Text color={t.ui.dim}>@</Text>
        <TextInput value={text} onChange={setText} focus={true} placeholder="username" />
      </Box>
      <Box marginTop={0}>
        <Text color={t.ui.dim}>[Enter] apply  [Esc] cancel  (empty = show all authors)</Text>
      </Box>
    </Box>
  )
}

function ReviewerDialog({ repo, pr, onClose }) {
  const { scheme } = useTheme()
  const t = schemeToT(scheme)
  const { data: collabs, loading } = useGh(listCollaborators, [repo])
  if (loading) return <Box paddingX={1}><Text color={t.ui.muted}>Loading collaborators…</Text></Box>

  const currentRequested = new Set(
    (pr.reviewRequests || []).map(r => r.login || r.name).filter(Boolean)
  )

  const items = (collabs || []).map(c => ({
    id: c.login,
    name: c.login,
    selected: currentRequested.has(c.login),
  }))

  return (
    <MultiSelect
      title="Request Reviewers"
      items={items}
      onSubmit={async (selectedIds) => {
        const current = [...currentRequested]
        const toAdd    = selectedIds.filter(id => !current.includes(id))
        const toRemove = current.filter(id => !selectedIds.includes(id))
        try {
          if (toAdd.length)    await requestReviewers(repo, pr.number, toAdd)
          if (toRemove.length) await removeReviewers(repo, pr.number, toRemove)
        } catch { /* ignore */ }
        onClose()
      }}
      onCancel={onClose}
    />
  )
}
