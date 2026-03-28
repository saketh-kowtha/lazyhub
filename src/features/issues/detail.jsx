/**
 * src/features/issues/detail.jsx — Issue detail pane
 */

import React, { useState, useContext } from 'react'
import { Box, Text, useInput } from 'ink'
import { format } from 'timeago.js'
import { useGh } from '../../hooks/useGh.js'
import { getIssue, addPRComment, listLabels, listCollaborators, addLabels, removeLabels } from '../../executor.js'
import { MultiSelect } from '../../components/dialogs/MultiSelect.jsx'
import { AppContext } from '../../app.jsx'
import { t } from '../../theme.js'

// Exported so app.jsx can use them if needed
export const FOOTER_KEYS = [
  { key: 'r', label: 'reply' },
  { key: 'l', label: 'labels' },
  { key: 'A', label: 'assignees' },
  { key: 'Esc', label: 'back' },
]

export function IssueDetail({ issueNumber, repo, onBack }) {
  const { notifyDialog } = useContext(AppContext)
  const { data: issue, loading, error, refetch } = useGh(getIssue, [repo, issueNumber])
  const [bodyExpanded, setBodyExpanded] = useState(false)
  const [replyMode, setReplyMode] = useState(false)
  const [replyText, setReplyText] = useState('')
  const [statusMsg, setStatusMsg] = useState(null)
  const [dialog, setDialog] = useState(null)

  // Notify App when dialog opens/closes so global keys are suppressed
  React.useEffect(() => {
    notifyDialog(!!dialog)
    return () => notifyDialog(false)
  }, [dialog, notifyDialog])

  useInput((input, key) => {
    if (dialog) return

    if (replyMode) {
      if (key.escape) { setReplyMode(false); setReplyText(''); return }
      if (key.return && key.ctrl) {
        addPRComment(repo, issueNumber, replyText)
          .then(() => { setStatusMsg('Reply sent'); refetch() })
          .catch(err => setStatusMsg(`Failed: ${err.message}`))
        setTimeout(() => setStatusMsg(null), 3000)
        setReplyMode(false)
        setReplyText('')
        return
      }
      if (key.backspace || key.delete) { setReplyText(r => r.slice(0, -1)); return }
      if (input && !key.ctrl && !key.meta) { setReplyText(r => r + input); return }
      return
    }

    if (input === 'r' && !replyMode) { setReplyMode(true); return }
    if (input === 'l') { setDialog('labels'); return }
    if (input === 'A') { setDialog('assignees'); return }
    if (key.escape || input === 'q') { onBack(); return }
    if (key.return && !bodyExpanded) { setBodyExpanded(true); return }
  })

  if (loading) return <Box paddingX={1}><Text color={t.ui.muted}>Loading...</Text></Box>
  if (error) return <Box paddingX={1}><Text color={t.ci.fail}>⚠ Failed — r to retry</Text></Box>
  if (!issue) return null

  // ── Dialogs ────────────────────────────────────────────────────────────────

  if (dialog === 'labels') {
    return <IssueLabelDialog repo={repo} issue={issue} onClose={() => { setDialog(null); refetch() }} />
  }

  if (dialog === 'assignees') {
    return <IssueAssigneeDialog repo={repo} issue={issue} onClose={() => { setDialog(null); refetch() }} />
  }

  // ── Detail view ────────────────────────────────────────────────────────────

  const bodyLines = (issue.body || '').split('\n')
  const displayBody = bodyExpanded ? bodyLines : bodyLines.slice(0, 8)
  const stateColor = issue.state === 'OPEN' ? t.issue.open : t.issue.closed

  return (
    <Box flexDirection="column" flexGrow={1} paddingX={1}>
      <Box marginBottom={1} flexDirection="column" borderStyle="single" borderColor={t.ui.border} paddingX={1}>
        <Box gap={1}>
          <Text color={stateColor}>{issue.state === 'OPEN' ? '○' : '✓'}</Text>
          <Text bold color={t.ui.selected} wrap="truncate">#{issue.number} {issue.title}</Text>
        </Box>
        <Box gap={2}>
          <Text color={t.ui.muted}>by {issue.author?.login}</Text>
          <Text color={t.ui.dim}>{format(issue.updatedAt)}</Text>
          {issue.assignees?.length > 0 && (
            <Box gap={1}>
              {issue.assignees.map(a => (
                <Text key={a.login} color={t.ui.muted}>@{a.login}</Text>
              ))}
            </Box>
          )}
          {issue.milestone?.title && (
            <Text color={t.ui.dim}>◎ {issue.milestone.title}</Text>
          )}
        </Box>
      </Box>

      {issue.labels?.length > 0 && (
        <Box marginBottom={1} gap={1}>
          {issue.labels.map(l => (
            <Box key={l.name} paddingX={1} borderStyle="round" borderColor={`#${l.color}`}>
              <Text color={`#${l.color}`}>{l.name}</Text>
            </Box>
          ))}
        </Box>
      )}

      {issue.body && (
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

      {issue.comments?.length > 0 && (
        <Box flexDirection="column" marginBottom={1}>
          <Text color={t.ui.muted} bold>Comments ({issue.comments.length}):</Text>
          {issue.comments.slice(0, 5).map((c, i) => (
            <Box key={i} flexDirection="column" paddingX={1} marginBottom={1}>
              <Box gap={1}>
                <Text color={t.ui.selected}>{c.author?.login}</Text>
                <Text color={t.ui.dim}>{format(c.updatedAt || c.createdAt)}</Text>
              </Box>
              <Text color={t.diff.ctxFg} wrap="truncate">{c.body?.slice(0, 120)}</Text>
            </Box>
          ))}
        </Box>
      )}

      {replyMode && (
        <Box flexDirection="column" borderStyle="round" borderColor={t.diff.threadBorder} paddingX={1}>
          <Text color={t.ui.muted}>Reply:</Text>
          <Box>
            <Text color={t.ui.selected}>{replyText}</Text>
            <Text color={t.ui.dim}>█</Text>
          </Box>
          <Text color={t.ui.dim}>[Ctrl+Enter] send  [Esc] cancel</Text>
        </Box>
      )}

      {statusMsg && <Text color={t.ci.pass}>{statusMsg}</Text>}
    </Box>
  )
}

// ─── Sub-dialogs ──────────────────────────────────────────────────────────────

function IssueLabelDialog({ repo, issue, onClose }) {
  const { data: allLabels, loading } = useGh(listLabels, [repo])
  if (loading) return <Box><Text color={t.ui.muted}>Loading labels...</Text></Box>
  const items = (allLabels || []).map(l => ({
    id: l.name,
    name: l.name,
    color: l.color,
    selected: issue.labels?.some(il => il.name === l.name),
  }))
  return (
    <MultiSelect
      items={items}
      onSubmit={async (selectedIds) => {
        const currentLabels = issue.labels?.map(l => l.name) || []
        const toAdd = selectedIds.filter(id => !currentLabels.includes(id))
        const toRemove = currentLabels.filter(id => !selectedIds.includes(id))
        try {
          if (toAdd.length) await addLabels(repo, issue.number, toAdd, 'issue')
          if (toRemove.length) await removeLabels(repo, issue.number, toRemove, 'issue')
        } catch {}
        onClose()
      }}
      onCancel={onClose}
    />
  )
}

function IssueAssigneeDialog({ repo, issue, onClose }) {
  const { data: collabs, loading } = useGh(listCollaborators, [repo])
  if (loading) return <Box><Text color={t.ui.muted}>Loading collaborators...</Text></Box>
  const items = (collabs || []).map(c => ({
    id: c.login,
    name: c.login,
    selected: issue.assignees?.some(a => a.login === c.login),
  }))
  return (
    <MultiSelect
      items={items}
      onSubmit={async (selectedIds) => {
        try {
          const { execa } = await import('execa')
          if (selectedIds.length) {
            await execa('gh', ['issue', 'edit', String(issue.number), '--repo', repo, '--add-assignee', selectedIds.join(',')])
          }
        } catch { /* ignore */ }
        onClose()
      }}
      onCancel={onClose}
    />
  )
}
