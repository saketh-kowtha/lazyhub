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
import { Box, Text, useInput, useStdout } from 'ink'
import { useKeyScope } from '../../keyscope.js'
import { useGh } from '../../hooks/useGh.js'
import {
  listPRs, listLabels, listCollaborators,
  mergePR, closePR, checkoutBranch, addLabels, removeLabels,
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
import { loadConfig } from '../../config.js'
import { useTheme } from '../../theme.js'
import { sanitize, TextInput, shortAge, authorColor } from '../../utils.js'
import { PRListSkeleton } from '../../components/Skeleton.jsx'

const _cfg = loadConfig().pr

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

// Fixed columns in each PRRow: paddingX(2) + cursor(1) + badge(2) + num(7) + CI_max(8) + author(13) + age(5) = 38; +4 buffer for wide unicode
const PR_ROW_FIXED_COLS = 42

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
  const authorLogin = String(pr.author?.login || '').slice(0, 11).padEnd(11)
  const authorClr   = authorColor(pr.author?.login)
  const ageStr      = shortAge(pr.updatedAt).padStart(4)
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

// ─── PRList ───────────────────────────────────────────────────────────────────

export function PRList({ repo, listHeight = 10, innerWidth, onSelectPR, onOpenDiff, onPaneState }) {
  useKeyScope('pane')
  const { t } = useTheme()
  const { notifyDialog } = useContext(AppContext)
  const { stdout } = useStdout()
  const termRows = stdout?.rows || 24
  const height = listHeight || Math.max(3, termRows - 5)
  // Reserve rows for the expanded detail block; disable on tiny terminals
  const EXPAND_ROWS = 5
  const expansionEnabled = termRows >= 20
  const effectiveHeight = expansionEnabled ? Math.max(3, height - EXPAND_ROWS) : height

  // Preserve filter/cursor/scroll across back-navigation from detail/diff
  const [savedState, setSavedState] = usePaneState('prs', {
    filterState: _cfg.defaultFilter,
    scope: _cfg.defaultScope,
    sortMode: 'default',
    authorFilter: '',
    limit: _cfg.pageSize,
    cursor: 0,
    scrollOffset: 0,
  })

  const [filterState, setFilterStateRaw] = useState(savedState.filterState)
  const [scope, setScopeRaw] = useState(savedState.scope)
  const [sortMode, setSortModeRaw] = useState(savedState.sortMode)
  const [authorFilter, setAuthorFilterRaw] = useState(savedState.authorFilter)
  const [limit, setLimitRaw] = useState(savedState.limit)
  const { data: prs, loading, error, refetch } = useGh(listPRs, [repo, { state: filterState, scope, author: authorFilter || undefined, limit }])

  const [cursor, setCursorRaw] = useState(savedState.cursor)
  const [scrollOffset, setScrollOffsetRaw] = useState(savedState.scrollOffset)

  // Wrap setters to also persist to pane state map
  const setFilterState = (v) => { setFilterStateRaw(v); setSavedState({ filterState: typeof v === 'function' ? v(filterState) : v }) }
  const setScope = (v) => { setScopeRaw(v); setSavedState({ scope: v }) }
  const setSortMode = (v) => { setSortModeRaw(v); setSavedState({ sortMode: v }) }
  const setAuthorFilter = (v) => { setAuthorFilterRaw(v); setSavedState({ authorFilter: v }) }
  const setLimit = (v) => { setLimitRaw(v); setSavedState({ limit: typeof v === 'function' ? v(limit) : v }) }
  const setCursor = (v) => { setCursorRaw(v); setSavedState({ cursor: typeof v === 'function' ? v(cursor) : v }) }
  const setScrollOffset = (v) => { setScrollOffsetRaw(v); setSavedState({ scrollOffset: typeof v === 'function' ? v(scrollOffset) : v }) }
  const [dialog, setDialog] = useState(null)
  const [mergeOptions, setMergeOptions] = useState(null)
  const [statusMsg, setStatusMsg] = useState(null)
  const lastKeyRef   = useRef(null)
  const lastKeyTimer = useRef(null)

  const rawItems = (prs || []).filter(pr => pr && pr.number)
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
    setCursor(next)
    if (next < scrollOffset) setScrollOffset(next)
    if (next >= scrollOffset + effectiveHeight) setScrollOffset(next - effectiveHeight + 1)
    if (next >= items.length - 10 && !loading) {
      setLimit(l => l + 100)
    }
  }, [cursor, items.length, scrollOffset, effectiveHeight, loading])

  const openDialog = useCallback((name) => setDialog(name), [])
  const closeDialog = useCallback(() => setDialog(null), [])

  useInput((input, key) => {
    if (statusMsg?.persist) { setStatusMsg(null) }
    if (dialog) return

    // gg → top
    if (input === 'g') {
      if (lastKeyRef.current === 'g') {
        clearTimeout(lastKeyTimer.current)
        lastKeyRef.current = null
        setCursor(0); setScrollOffset(0)
        return
      }
      lastKeyRef.current = 'g'
      lastKeyTimer.current = setTimeout(() => { lastKeyRef.current = null }, 400)
      return
    }
    lastKeyRef.current = null

    // G → bottom
    if (input === 'G') {
      if (items.length > 0) {
        const last = items.length - 1
        setCursor(last); setScrollOffset(Math.max(0, last - effectiveHeight + 1))
      }
      return
    }

    if (input === 'j' || key.downArrow) { moveCursor(1);  return }
    if (input === 'k' || key.upArrow)   { moveCursor(-1); return }
    if (input === 'r') { refetch(); return }
    if (input === '/') { openDialog('fuzzy'); return }

    // Configurable direct filter keys (defaults: O=open, C=closed, M=merged)
    if (FK.filterOpen   && input === FK.filterOpen   && filterState !== 'open')   { setFilterState('open');   showStatus('▸ open');   setCursor(0); setScrollOffset(0); return }
    if (FK.filterClosed && input === FK.filterClosed && filterState !== 'closed') { setFilterState('closed'); showStatus('▸ closed'); setCursor(0); setScrollOffset(0); return }
    if (FK.filterMerged && input === FK.filterMerged && filterState !== 'merged') { setFilterState('merged'); showStatus('▸ merged'); setCursor(0); setScrollOffset(0); return }
    // f still cycles through all states (kept as fallback)
    if (input === 'f') {
      setFilterState(prev => {
        const next = STATE_CYCLE[(STATE_CYCLE.indexOf(prev) + 1) % STATE_CYCLE.length]
        showStatus(`▸ ${next}`)
        return next
      })
      setCursor(0); setScrollOffset(0)
      return
    }

    // s — cycle scope then age sort
    if (input === 's') {
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
    if (input === '@') { openDialog('author-search'); return }

    // N — new PR
    if (input === 'N') { openDialog('new-pr'); return }

    if (loading || items.length === 0) return
    const pr = items[cursor]
    if (!pr) return

    if (key.return) { onSelectPR(pr); return }
    if (input === 'd') { onOpenDiff(pr); return }
    if (input === 'm') { openDialog('merge'); return }
    if (input === 'l') { openDialog('labels'); return }
    if (input === 'A') { openDialog('assignees'); return }
    if (input === 'R') { openDialog('reviewers'); return }
    if (input === 'a') { openDialog('approve-body'); return }
    if (input === 'x') { openDialog('reqchanges-body'); return }
    if (input === 'X') { openDialog('close-pr'); return }

    if (input === 'c') { openDialog('checkout'); return }

    // y — copy PR URL to clipboard
    if (input === 'y' && pr.url) {
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

    if (input === 'o' && pr.url) {
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
    <Box flexDirection="column" flexGrow={1}>
      <Box paddingX={1} gap={1} overflow="hidden">
        <Text color={filterState === 'open' ? t.pr.open : filterState === 'merged' ? t.pr.merged : t.pr.closed} bold>
          {filterState}
        </Text>
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
        <Box paddingX={2} paddingY={1}>
          <Text color={t.ui.muted}>No {filterState} pull requests. [f] change filter  [r] refresh</Text>
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
    </Box>
  )
}

// ─── Sub-dialogs ──────────────────────────────────────────────────────────────

function LabelDialog({ repo, pr, onClose }) {
  const { t } = useTheme()
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
  const { t } = useTheme()
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
  const { t } = useTheme()
  const [text, setText] = useState(current || '')
  useKeyScope('dialog')

  useInput((input, key) => {
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
  const { t } = useTheme()
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
