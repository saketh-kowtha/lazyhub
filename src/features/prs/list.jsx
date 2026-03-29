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
import { format } from 'timeago.js'
import { useGh } from '../../hooks/useGh.js'
import {
  listPRs, listLabels, listCollaborators,
  mergePR, closePR, checkoutBranch, addLabels, removeLabels,
  requestReviewers, reviewPR, getRepoInfo,
} from '../../executor.js'
import { FuzzySearch } from '../../components/dialogs/FuzzySearch.jsx'
import { MultiSelect } from '../../components/dialogs/MultiSelect.jsx'
import { OptionPicker } from '../../components/dialogs/OptionPicker.jsx'
import { ConfirmDialog } from '../../components/dialogs/ConfirmDialog.jsx'
import { FormCompose } from '../../components/dialogs/FormCompose.jsx'
import { NewPRDialog } from './NewPRDialog.jsx'
import { AppContext } from '../../context.js'
import { loadConfig } from '../../config.js'
import { useTheme } from '../../theme.js'
import { sanitize } from '../../utils.js'

const _cfg = loadConfig().pr

// ─── Badges ──────────────────────────────────────────────────────────────────

function PRStateBadge({ pr }) {
  const { t } = useTheme()
  if (pr.isDraft) return <Text color={t.pr.draft}>⊘</Text>
  switch (pr.state) {
    case 'OPEN':   return <Text color={t.pr.open}>●</Text>
    case 'MERGED': return <Text color={t.pr.merged}>✓</Text>
    case 'CLOSED': return <Text color={t.pr.closed}>✗</Text>
    default:       return <Text color={t.ui.muted}>?</Text>
  }
}

function CIBadge({ pr }) {
  const { t } = useTheme()
  const checks = pr.statusCheckRollup
  if (!checks || checks.length === 0) return null
  const states = checks.map(c => c.state || c.conclusion || c.status || '')
  if (states.some(s => /failure|error/i.test(s)))              return <Text color={t.ci.fail}> ✗</Text>
  if (states.some(s => /pending|in_progress|queued/i.test(s))) return <Text color={t.ci.pending}> ●</Text>
  if (states.every(s => /success/i.test(s)))                   return <Text color={t.ci.pass}> ✓</Text>
  return null
}

const PRRow = memo(({ pr, isSelected, t }) => {
  const authorLogin = String(pr.author?.login || '').slice(0, 12).padEnd(12)
  const timeStr = pr.updatedAt ? format(pr.updatedAt) : ''

  return (
    <Box
      paddingX={1}
      backgroundColor={isSelected ? t.ui.headerBg : undefined}
    >
      <PRStateBadge pr={pr} />
      <Text color={t.ui.dim}> {'#' + String(pr.number).padEnd(5)}</Text>
      <Text
        color={isSelected ? t.ui.selected : undefined}
        italic={pr.isDraft}
        wrap="truncate"
        flexGrow={1}
      >
        {sanitize(pr.title)}
      </Text>
      <CIBadge pr={pr} />
      <Text color={t.ui.muted}> {authorLogin}</Text>
      <Text color={t.ui.dim}> {timeStr}</Text>
    </Box>
  )
})

const MERGE_OPTIONS = [
  { value: 'merge',  label: '--merge',  description: 'Create a merge commit' },
  { value: 'squash', label: '--squash', description: 'Squash all commits into one' },
  { value: 'rebase', label: '--rebase', description: 'Rebase onto base branch' },
]

// ─── PRList ───────────────────────────────────────────────────────────────────

export function PRList({ repo, listHeight = 10, onHover, onSelectPR, onOpenDiff, onPaneState }) {
  const { t } = useTheme()
  const { notifyDialog } = useContext(AppContext)
  const { stdout } = useStdout()
  const height = listHeight || Math.max(3, (stdout?.rows || 24) - 5)

  const [filterState, setFilterState] = useState(_cfg.defaultFilter)
  const [scope, setScope] = useState(_cfg.defaultScope)
  const [authorFilter, setAuthorFilter] = useState('')  // '' = all authors
  const [limit, setLimit] = useState(_cfg.pageSize)
  const { data: prs, loading, error, refetch } = useGh(listPRs, [repo, { state: filterState, scope, author: authorFilter || undefined, limit }])

  const [cursor, setCursor] = useState(0)
  const [scrollOffset, setScrollOffset] = useState(0)
  const [dialog, setDialog] = useState(null)
  const [mergeOptions, setMergeOptions] = useState(null)
  const [statusMsg, setStatusMsg] = useState(null)
  const lastKeyRef   = useRef(null)
  const lastKeyTimer = useRef(null)

  const items = prs || []

  // Filter keys from config (defaults: O=open, C=closed, M=merged)
  const FK = _cfg.keys
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
      // Load more when within 10 items of the bottom
      if (next >= items.length - 10 && !loading) {
        setLimit(l => l + 100)
      }
      return next
    })
  }, [items.length, scrollOffset, height, loading])

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

    // s — cycle scope
    if (input === 's') {
      const SCOPES = ['all', 'own', 'reviewing']
      setScope(prev => {
        const next = SCOPES[(SCOPES.indexOf(prev) + 1) % SCOPES.length]
        showStatus(`scope: ${next}`)
        return next
      })
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
        title={`Merge PR #${selectedPR.number}: ${selectedPR.title}`}
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
        message={`Close PR #${selectedPR.number}: ${selectedPR.title}?`}
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

  const visiblePRs = items.slice(scrollOffset, scrollOffset + height)

  return (
    <Box flexDirection="column" flexGrow={1}>
      <Box paddingX={1} gap={1}>
        <Text color={filterState === 'open' ? t.pr.open : filterState === 'merged' ? t.pr.merged : t.pr.closed} bold>
          {filterState}
        </Text>
        <Text color={t.ui.dim}>·</Text>
        <Text color={scope === 'own' ? t.ui.selected : scope === 'reviewing' ? t.ci.pending : t.ui.muted} bold>
          {scope === 'own' ? 'mine' : scope === 'reviewing' ? 'reviewing' : 'all'}
        </Text>
        {authorFilter && (
          <>
            <Text color={t.ui.dim}>·</Text>
            <Text color={t.ci.pending}>@{authorFilter}</Text>
            <Text color={t.ui.dim}> [@] change</Text>
          </>
        )}
        <Text color={t.ui.dim}>  [{FK.filterOpen}]open [{FK.filterClosed}]closed [{FK.filterMerged}]merged [s]scope [@]author</Text>
        {items.length >= _cfg.pageSize && (
          <Text color={t.ui.dim}> ({items.length})</Text>
        )}
        {statusMsg && (
          <Text color={statusMsg.isError ? t.ci.fail : t.ci.pass}>  {statusMsg.msg}</Text>
        )}
      </Box>

      {!loading && !error && items.length === 0 && (
        <Box paddingX={2} paddingY={1}>
          <Text color={t.ui.muted}>No {filterState} pull requests. [f] change filter  [r] refresh</Text>
        </Box>
      )}

      {loading && items.length === 0 && (
        <Box paddingX={2} paddingY={1}>
          <Text color={t.ui.muted}>  Loading pull requests…</Text>
        </Box>
      )}

      {visiblePRs.map((pr, i) => {
        const idx = scrollOffset + i
        const isSelected = idx === cursor

        return (
          <PRRow
            key={pr.number}
            pr={pr}
            isSelected={isSelected}
            t={t}
          />
        )
      })}

      {(items.length > height || items.length >= 100) && (
        <Box paddingX={1} justifyContent="space-between">
          <Text color={t.ui.dim}>
            {scrollOffset + 1}–{Math.min(scrollOffset + height, items.length)} / {items.length}
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

// Simple inline author-search box
function AuthorSearchDialog({ current, onSubmit, onCancel }) {
  const { t } = useTheme()
  const [text, setText] = useState(current || '')

  useInput((input, key) => {
    if (key.escape) { onCancel(); return }
    if (key.return) { onSubmit(text.trim()); return }
    if (key.backspace || key.delete) { setText(s => s.slice(0, -1)); return }
    if (input && !key.ctrl && !key.meta) { setText(s => s + input); return }
  })

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={t.ui.selected} paddingX={2} paddingY={1}>
      <Text color={t.ui.selected} bold>Filter by author</Text>
      <Box marginTop={1} gap={1}>
        <Text color={t.ui.dim}>@</Text>
        <Text color={t.ui.selected}>{text}</Text>
        <Text color={t.ui.dim}>█</Text>
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
