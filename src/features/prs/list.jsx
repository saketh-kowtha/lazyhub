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
import { Box, Text, useInput, useStdout } from 'ink'
import { format } from 'timeago.js'
import { useGh } from '../../hooks/useGh.js'
import {
  listPRs, listLabels, listCollaborators,
  mergePR, checkoutBranch, addLabels, removeLabels,
  requestReviewers, reviewPR,
} from '../../executor.js'
import { FuzzySearch } from '../../components/dialogs/FuzzySearch.jsx'
import { MultiSelect } from '../../components/dialogs/MultiSelect.jsx'
import { OptionPicker } from '../../components/dialogs/OptionPicker.jsx'
import { ConfirmDialog } from '../../components/dialogs/ConfirmDialog.jsx'
import { AppContext } from '../../app.jsx'
import { t } from '../../theme.js'

// ─── Badges ──────────────────────────────────────────────────────────────────

function prStateBadge(pr) {
  if (pr.isDraft) return { icon: '⊘', color: t.pr.draft }
  switch (pr.state) {
    case 'OPEN':   return { icon: '●', color: t.pr.open }
    case 'MERGED': return { icon: '✓', color: t.pr.merged }
    case 'CLOSED': return { icon: '✗', color: t.pr.closed }
    default:       return { icon: '?', color: t.ui.muted }
  }
}

function ciBadge(pr) {
  const checks = pr.statusCheckRollup
  if (!checks || checks.length === 0) return null
  const states = checks.map(c => c.state || c.conclusion || c.status || '')
  if (states.some(s => /failure|error/i.test(s)))              return { icon: '✗', color: t.ci.fail }
  if (states.some(s => /pending|in_progress|queued/i.test(s))) return { icon: '●', color: t.ci.pending }
  if (states.every(s => /success/i.test(s)))                   return { icon: '✓', color: t.ci.pass }
  return null
}

const MERGE_OPTIONS = [
  { value: 'merge',  label: '--merge',  description: 'Create a merge commit' },
  { value: 'squash', label: '--squash', description: 'Squash all commits into one' },
  { value: 'rebase', label: '--rebase', description: 'Rebase onto base branch' },
]

// ─── PRList ───────────────────────────────────────────────────────────────────

export function PRList({ repo, listHeight = 10, onHover, onSelectPR, onOpenDiff, onPaneState }) {
  const { notifyDialog } = useContext(AppContext)
  const { stdout } = useStdout()
  const height = listHeight || Math.max(3, (stdout?.rows || 24) - 5)

  // f cycles: open → closed → merged → open
  const [filterState, setFilterState] = useState('open')
  const { data: prs, loading, error, refetch } = useGh(listPRs, [repo, { state: filterState }])

  const [cursor, setCursor] = useState(0)
  const [scrollOffset, setScrollOffset] = useState(0)
  const [dialog, setDialog] = useState(null)
  const [statusMsg, setStatusMsg] = useState(null)
  const lastKeyRef   = useRef(null)
  const lastKeyTimer = useRef(null)

  const items = prs || []

  const STATE_CYCLE = ['open', 'closed', 'merged']

  // Notify parent of loading/error/count
  useEffect(() => {
    if (onPaneState) onPaneState({ loading, error, count: items.length })
  }, [loading, error, items.length]) // eslint-disable-line react-hooks/exhaustive-deps

  // Notify App when dialog opens/closes so global keys are suppressed
  useEffect(() => {
    notifyDialog(!!dialog)
    return () => notifyDialog(false)
  }, [dialog, notifyDialog])

  // Notify parent of hovered item for side panel
  useEffect(() => {
    if (onHover) onHover(items[cursor] || null)
  }, [cursor, items.length]) // eslint-disable-line react-hooks/exhaustive-deps

  const showStatus = (msg, isError = false) => {
    setStatusMsg({ msg, isError })
    setTimeout(() => setStatusMsg(null), 3000)
  }

  const moveCursor = useCallback((delta) => {
    setCursor(prev => {
      const next = Math.max(0, Math.min(items.length - 1, prev + delta))
      if (next < scrollOffset) setScrollOffset(next)
      if (next >= scrollOffset + height) setScrollOffset(next - height + 1)
      return next
    })
  }, [items.length, scrollOffset, height])

  const openDialog = useCallback((name) => setDialog(name), [])
  const closeDialog = useCallback(() => setDialog(null), [])

  useInput((input, key) => {
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
      const last = items.length - 1
      setCursor(last); setScrollOffset(Math.max(0, last - height + 1))
      return
    }

    if (input === 'j' || key.downArrow) { moveCursor(1);  return }
    if (input === 'k' || key.upArrow)   { moveCursor(-1); return }
    if (input === 'r') { refetch(); return }
    if (input === '/') { openDialog('fuzzy'); return }

    // f — cycle filter state
    if (input === 'f') {
      setFilterState(prev => {
        const next = STATE_CYCLE[(STATE_CYCLE.indexOf(prev) + 1) % STATE_CYCLE.length]
        showStatus(`Filter: ${next}`)
        return next
      })
      setCursor(0); setScrollOffset(0)
      return
    }

    if (loading || items.length === 0) return
    const pr = items[cursor]
    if (!pr) return

    if (key.return) { onSelectPR(pr); return }
    if (input === 'd') { onOpenDiff(pr); return }
    if (input === 'm') { openDialog('merge'); return }
    if (input === 'l') { openDialog('labels'); return }
    if (input === 'A') { openDialog('assignees'); return }
    if (input === 'R') { openDialog('reviewers'); return }
    if (input === 'a') { openDialog('approve'); return }

    if (input === 'c') {
      checkoutBranch(repo, pr.number)
        .then(() => showStatus(`✓ Checked out PR #${pr.number}`))
        .catch(err => showStatus(`✗ Checkout: ${err.message}`, true))
      return
    }

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
    return (
      <FuzzySearch
        items={items}
        searchFields={['title', 'number', 'author', 'headRefName']}
        onSubmit={(item) => {
          const idx = items.indexOf(item)
          if (idx !== -1) {
            setCursor(idx)
            setScrollOffset(Math.max(0, idx - Math.floor(height / 2)))
          }
          closeDialog()
        }}
        onCancel={closeDialog}
      />
    )
  }

  if (dialog === 'merge' && selectedPR) {
    return (
      <OptionPicker
        title={`Merge PR #${selectedPR.number}: ${selectedPR.title}`}
        options={MERGE_OPTIONS}
        promptText="Commit message (optional, Enter to skip)"
        onSubmit={async (val) => {
          const strategy = typeof val === 'object' ? val.value : val
          const msg = typeof val === 'object' ? val.text : undefined
          closeDialog()
          try {
            await mergePR(repo, selectedPR.number, strategy, msg)
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

  if (dialog === 'labels' && selectedPR) {
    return <LabelDialog repo={repo} pr={selectedPR} onClose={() => { closeDialog(); refetch() }} />
  }

  if (dialog === 'assignees' && selectedPR) {
    return <AssigneeDialog repo={repo} pr={selectedPR} onClose={() => { closeDialog(); refetch() }} />
  }

  if (dialog === 'reviewers' && selectedPR) {
    return <ReviewerDialog repo={repo} pr={selectedPR} onClose={() => { closeDialog(); refetch() }} />
  }

  if (dialog === 'approve' && selectedPR) {
    return (
      <ConfirmDialog
        message={`Approve PR #${selectedPR.number}?`}
        destructive={false}
        onConfirm={async () => {
          closeDialog()
          try {
            await reviewPR(repo, selectedPR.number, 'approve')
            showStatus(`✓ Approved PR #${selectedPR.number}`)
          } catch (err) {
            showStatus(`✗ ${err.message}`, true)
          }
        }}
        onCancel={closeDialog}
      />
    )
  }

  // ── List view ─────────────────────────────────────────────────────────────

  const visiblePRs = items.slice(scrollOffset, scrollOffset + height)

  return (
    <Box flexDirection="column" flexGrow={1}>
      <Box paddingX={1} gap={1}>
        <Text color={t.ui.dim}>filter:</Text>
        <Text color={filterState === 'open' ? t.pr.open : filterState === 'merged' ? t.pr.merged : t.pr.closed} bold>
          {filterState}
        </Text>
        <Text color={t.ui.dim}>[f] cycle</Text>
        {statusMsg && (
          <Text color={statusMsg.isError ? t.ci.fail : t.ci.pass}> {statusMsg.msg}</Text>
        )}
      </Box>

      {!loading && !error && items.length === 0 && (
        <Box paddingX={2} paddingY={1}>
          <Text color={t.ui.muted}>No {filterState} pull requests. [f] change filter  [r] refresh</Text>
        </Box>
      )}

      {visiblePRs.map((pr, i) => {
        const idx = scrollOffset + i
        const isSelected = idx === cursor
        const badge = prStateBadge(pr)
        const ci = ciBadge(pr)
        const authorLogin = (pr.author?.login || '').slice(0, 12)
        const timeStr = pr.updatedAt ? format(pr.updatedAt) : ''

        return (
          <Box
            key={pr.number}
            paddingX={1}
            backgroundColor={isSelected ? t.ui.headerBg : undefined}
          >
            <Text color={badge.color}>{badge.icon}</Text>
            <Text color={t.ui.dim}> {'#' + String(pr.number).padEnd(5)}</Text>
            <Text
              color={isSelected ? t.ui.selected : undefined}
              wrap="truncate"
              flexGrow={1}
            >
              {pr.title}
            </Text>
            {ci
              ? <Text color={ci.color}> {ci.icon}</Text>
              : <Text>   </Text>
            }
            <Text color={t.ui.muted}> {authorLogin}</Text>
            <Text color={t.ui.dim}> {timeStr}</Text>
          </Box>
        )
      })}

      {items.length > height && (
        <Box paddingX={1}>
          <Text color={t.ui.dim}>
            {scrollOffset + 1}–{Math.min(scrollOffset + height, items.length)} / {items.length}
          </Text>
        </Box>
      )}
    </Box>
  )
}

// ─── Sub-dialogs ──────────────────────────────────────────────────────────────

function LabelDialog({ repo, pr, onClose }) {
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
        try {
          const { execa } = await import('execa')
          if (selectedIds.length > 0) {
            await execa('gh', [
              'pr', 'edit', String(pr.number), '--repo', repo,
              '--add-assignee', selectedIds.join(','),
            ])
          }
        } catch { /* ignore */ }
        onClose()
      }}
      onCancel={onClose}
    />
  )
}

function ReviewerDialog({ repo, pr, onClose }) {
  const { data: collabs, loading } = useGh(listCollaborators, [repo])
  if (loading) return <Box paddingX={1}><Text color={t.ui.muted}>Loading collaborators…</Text></Box>

  const items = (collabs || []).map(c => ({
    id: c.login,
    name: c.login,
    selected: pr.reviewRequests?.some(r => r.login === c.login) ?? false,
  }))

  return (
    <MultiSelect
      items={items}
      onSubmit={async (selectedIds) => {
        try {
          if (selectedIds.length) await requestReviewers(repo, pr.number, selectedIds)
        } catch { /* ignore */ }
        onClose()
      }}
      onCancel={onClose}
    />
  )
}
