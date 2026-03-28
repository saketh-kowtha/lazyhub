/**
 * src/features/prs/detail.jsx — PR detail pane
 */

import React, { useState, useContext } from 'react'
import { Box, Text, useInput } from 'ink'
import { format } from 'timeago.js'
import { useGh } from '../../hooks/useGh.js'
import { getPR, listLabels, listCollaborators, addLabels, removeLabels, getRepoInfo, getPRChecks, getBranchProtection, enableAutoMerge, disableAutoMerge, mergePR } from '../../executor.js'
import { MultiSelect } from '../../components/dialogs/MultiSelect.jsx'
import { OptionPicker } from '../../components/dialogs/OptionPicker.jsx'
import { AppContext } from '../../app.jsx'
import { t } from '../../theme.js'

function reviewStatusIcon(state) {
  switch (state) {
    case 'APPROVED': return { icon: '✓', color: t.ci.pass }
    case 'CHANGES_REQUESTED': return { icon: '✗', color: t.ci.fail }
    case 'COMMENTED': return { icon: '●', color: t.ui.muted }
    default: return { icon: '○', color: t.ui.dim }
  }
}

function prStateBadge(pr) {
  if (pr.isDraft) return { icon: '⊘', color: t.pr.draft, label: 'Draft' }
  switch (pr.state) {
    case 'OPEN': return { icon: '●', color: t.pr.open, label: 'Open' }
    case 'MERGED': return { icon: '✓', color: t.pr.merged, label: 'Merged' }
    case 'CLOSED': return { icon: '✗', color: t.pr.closed, label: 'Closed' }
    default: return { icon: '?', color: t.ui.muted, label: pr.state }
  }
}

// Exported so app.jsx can use them if needed
export const FOOTER_KEYS = [
  { key: 'd', label: 'diff' },
  { key: 'm', label: 'merge' },
  { key: 'M', label: 'auto-merge' },
  { key: 'a', label: 'approve' },
  { key: 'l', label: 'labels' },
  { key: 'A', label: 'assignees' },
  { key: 'r', label: 'refresh' },
  { key: 'Esc', label: 'back' },
]

const MERGE_OPTIONS = [
  { value: 'merge',  label: '--merge',  description: 'Create a merge commit' },
  { value: 'squash', label: '--squash', description: 'Squash all commits into one' },
  { value: 'rebase', label: '--rebase', description: 'Rebase onto base branch' },
]

export function PRDetail({ prNumber, repo, onBack, onOpenDiff }) {
  const { notifyDialog } = useContext(AppContext)
  const { data: pr, loading, error, refetch } = useGh(getPR, [repo, prNumber])
  const { data: repoInfo } = useGh(getRepoInfo, [repo], { ttl: 300_000 })
  const { data: checks } = useGh(getPRChecks, [repo, prNumber], { ttl: 30_000 })
  const baseBranch = pr?.baseRefName || ''
  const { data: protection } = useGh(getBranchProtection, [repo, baseBranch], { ttl: 300_000 })
  const [bodyExpanded, setBodyExpanded] = useState(false)
  const [dialog, setDialog] = useState(null)

  // Notify App when dialog opens/closes so global keys are suppressed
  React.useEffect(() => {
    notifyDialog(!!dialog)
    return () => notifyDialog(false)
  }, [dialog, notifyDialog])

  useInput((input, key) => {
    if (dialog) return
    if (input === 'r') { refetch(); return }
    if (input === 'd' && pr) { onOpenDiff(pr); return }
    if (input === 'l') { setDialog('labels'); return }
    if (input === 'A') { setDialog('assignees'); return }
    if (input === 'm' && pr && pr.state === 'OPEN') { setDialog('merge'); return }
    if (input === 'M' && pr && pr.state === 'OPEN' && !pr.isDraft) {
      if (pr.autoMergeRequest) {
        disableAutoMerge(repo, prNumber).then(() => refetch()).catch(() => {})
      } else {
        enableAutoMerge(repo, prNumber, repoInfo?.squashMergeAllowed ? 'squash' : 'merge')
          .then(() => refetch()).catch(() => {})
      }
      return
    }
    if (key.escape || input === 'q') { onBack(); return }
    if (key.return && !bodyExpanded) { setBodyExpanded(true); return }
  })

  if (loading) {
    return (
      <Box flexDirection="column" flexGrow={1} paddingX={1}>
        <Text color={t.ui.muted}>Loading PR details...</Text>
      </Box>
    )
  }

  if (error) {
    return (
      <Box flexDirection="column" flexGrow={1} paddingX={1}>
        <Text color={t.ci.fail}>⚠ Failed to load — r to retry</Text>
        <Text color={t.ui.dim}>{error.message}</Text>
      </Box>
    )
  }

  if (!pr) return null

  // ── Dialogs ────────────────────────────────────────────────────────────────

  if (dialog === 'merge') {
    return (
      <OptionPicker
        title={`Merge PR #${pr.number}: ${pr.title}`}
        options={MERGE_OPTIONS}
        promptText="Commit message (optional, Enter to skip)"
        onSubmit={async (val) => {
          const strategy = typeof val === 'object' ? val.value : val
          const msg = typeof val === 'object' ? val.text : undefined
          setDialog(null)
          try {
            await mergePR(repo, pr.number, strategy, msg)
            refetch()
          } catch { /* ignore */ }
        }}
        onCancel={() => setDialog(null)}
      />
    )
  }

  if (dialog === 'labels') {
    return <PRLabelDialog repo={repo} pr={pr} onClose={() => { setDialog(null); refetch() }} />
  }

  if (dialog === 'assignees') {
    return <PRAssigneeDialog repo={repo} pr={pr} onClose={() => { setDialog(null); refetch() }} />
  }

  // ── Detail view ────────────────────────────────────────────────────────────

  const badge = prStateBadge(pr)
  const bodyLines = (pr.body || '').split('\n')
  const displayBody = bodyExpanded ? bodyLines : bodyLines.slice(0, 8)

  // Checks: prefer fetched checks, fall back to statusCheckRollup
  const allChecks = (checks && checks.length > 0) ? checks : (pr.statusCheckRollup || [])

  return (
    <Box flexDirection="column" flexGrow={1} paddingX={1}>
      {/* Header */}
      <Box marginBottom={1} flexDirection="column" borderStyle="single" borderColor={t.ui.border} paddingX={1}>
        <Box gap={1}>
          <Text color={badge.color}>{badge.icon}</Text>
          <Text bold color={t.ui.selected} wrap="truncate">#{pr.number} {pr.title}</Text>
        </Box>
        <Box gap={2}>
          <Text color={t.ui.muted}>by {pr.author?.login}</Text>
          <Text color={t.ui.dim}>{format(pr.updatedAt)}</Text>
          <Text color={t.ui.muted}>{pr.baseRefName}</Text>
          <Text color={t.ui.dim}>←</Text>
          <Text color={t.ui.selected}>{pr.headRefName}</Text>
        </Box>
      </Box>

      {/* Labels */}
      {pr.labels?.length > 0 && (
        <Box marginBottom={1} gap={1}>
          {pr.labels.map(l => (
            <Box key={l.name} paddingX={1} borderStyle="round" borderColor={`#${l.color}`}>
              <Text color={`#${l.color}`}>{l.name}</Text>
            </Box>
          ))}
        </Box>
      )}

      {/* Reviewers */}
      {(pr.reviews?.length > 0 || pr.reviewRequests?.length > 0) && (
        <Box marginBottom={1} flexDirection="column">
          <Text color={t.ui.muted} bold>Reviewers:</Text>
          {(pr.reviews || []).map((r, i) => {
            const rs = reviewStatusIcon(r.state)
            return (
              <Box key={i} gap={1}>
                <Text color={rs.color}>{rs.icon}</Text>
                <Text color={t.ui.muted}>{r.author?.login}</Text>
              </Box>
            )
          })}
          {(pr.reviewRequests || [])
            .filter(req => !(pr.reviews || []).some(r => r.author?.login === req.login))
            .map((req, i) => (
              <Box key={`req-${i}`} gap={1}>
                <Text color={t.ui.dim}>○</Text>
                <Text color={t.ui.muted}>{req.login || req.name}</Text>
              </Box>
            ))
          }
        </Box>
      )}

      {/* CI Checks */}
      {allChecks.length > 0 && (
        <Box marginBottom={1} flexDirection="column">
          <Text color={t.ui.muted} bold>Checks:</Text>
          {allChecks.slice(0, 8).map((c, i) => {
            const status = c.conclusion || c.status || c.state || ''
            let icon, color
            if (/success/i.test(status)) { icon = '✓'; color = t.ci.pass }
            else if (/failure|error/i.test(status)) { icon = '✗'; color = t.ci.fail }
            else if (/pending|in_progress|queued/i.test(status)) { icon = '●'; color = t.ci.pending }
            else if (/cancelled|skipped/i.test(status)) { icon = '⊘'; color = t.ui.dim }
            else { icon = '○'; color = t.ui.dim }
            const name = (c.name || c.context || '').slice(0, 35)
            return (
              <Box key={i} gap={1} paddingLeft={1}>
                <Text color={color}>{icon}</Text>
                <Text color={t.ui.muted} wrap="truncate">{name}</Text>
                {c.appName && <Text color={t.ui.dim}>({c.appName})</Text>}
              </Box>
            )
          })}
          {allChecks.length > 8 && (
            <Text color={t.ui.dim} paddingLeft={1}>  +{allChecks.length - 8} more checks</Text>
          )}
        </Box>
      )}

      {/* Merge eligibility */}
      {pr && (
        <Box marginBottom={1} flexDirection="column">
          <Text color={t.ui.muted} bold>Merge status:</Text>
          {pr.isDraft && <Text color={t.pr.draft}>  ⊘ Draft — convert to ready before merging</Text>}
          {pr.mergeable === 'CONFLICTING' && <Text color={t.ci.fail}>  ✗ Has merge conflicts</Text>}
          {pr.mergeStateStatus === 'BLOCKED' && <Text color={t.ci.fail}>  ✗ Blocked — required checks/reviews pending</Text>}
          {pr.mergeStateStatus === 'BEHIND' && <Text color={t.ci.pending}>  ● Branch is behind base — update required</Text>}
          {pr.mergeStateStatus === 'CLEAN' && <Text color={t.ci.pass}>  ✓ Ready to merge</Text>}
          {pr.mergeStateStatus === 'UNSTABLE' && <Text color={t.ci.pending}>  ● Unstable — some checks failing</Text>}
          {pr.mergeStateStatus === 'HAS_HOOKS' && <Text color={t.ci.pass}>  ✓ Ready (merge hooks active)</Text>}
          {pr.autoMergeRequest && (
            <Text color={t.ci.pass}>  ✓ Auto-merge enabled ({pr.autoMergeRequest.mergeMethod?.toLowerCase()})</Text>
          )}
          {protection && (
            <Box flexDirection="column" paddingLeft={2}>
              {protection.requiredReviews > 0 && (
                <Text color={t.ui.dim}>
                  Reviews required: {protection.requiredReviews}
                  {protection.requireCodeOwnerReviews ? ' (+ CODEOWNERS)' : ''}
                </Text>
              )}
              {protection.requireStatusChecks && protection.requiredChecks?.length > 0 && (
                <Text color={t.ui.dim}>Required checks: {protection.requiredChecks.slice(0, 3).join(', ')}
                  {protection.requiredChecks.length > 3 ? ` +${protection.requiredChecks.length - 3}` : ''}
                </Text>
              )}
            </Box>
          )}
        </Box>
      )}

      {/* Stats */}
      <Box marginBottom={1} gap={2}>
        <Text color={t.ci.pass}>+{pr.additions || 0}</Text>
        <Text color={t.ci.fail}>-{pr.deletions || 0}</Text>
        <Text color={t.ui.muted}>{pr.changedFiles || 0} files</Text>
      </Box>

      {/* Body */}
      {pr.body && (
        <Box flexDirection="column" marginBottom={1}>
          <Text color={t.ui.muted} bold>Description:</Text>
          <Box flexDirection="column" borderStyle="single" borderColor={t.ui.border} paddingX={1}>
            {displayBody.map((line, i) => (
              <Text key={i} color={t.diff.ctxFg} wrap="truncate">{line || ' '}</Text>
            ))}
            {!bodyExpanded && bodyLines.length > 8 && (
              <Text color={t.ui.dim}>[Enter] expand ({bodyLines.length - 8} more lines)</Text>
            )}
          </Box>
        </Box>
      )}
    </Box>
  )
}

// ─── Sub-dialogs ──────────────────────────────────────────────────────────────

function PRLabelDialog({ repo, pr, onClose }) {
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

function PRAssigneeDialog({ repo, pr, onClose }) {
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
