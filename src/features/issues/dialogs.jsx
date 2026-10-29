/**
 * Shared issue label and assignee editors; display names are sanitized, IDs stay raw.
 */

import React from 'react'
import { Box, Text } from 'ink'
import { useGh } from '../../hooks/useGh.js'
import { listLabels, listCollaborators, addLabels, removeLabels, addIssueAssignees, removeIssueAssignees } from '../../executor.js'
import { MultiSelect } from '../../components/dialogs/MultiSelect.jsx'
import { useTheme } from '../../theme.js'
import { sanitize } from '../../utils.js'

export function IssueLabelDialog({ repo, issue, onClose, loadingPadding = 0 }) {
  const { t } = useTheme()
  const { data: allLabels, loading } = useGh(listLabels, [repo])
  if (loading) return <Box paddingX={loadingPadding}><Text color={t.ui.muted}>Loading labels...</Text></Box>
  const items = (allLabels || []).map(l => ({
    id: l.name,
    name: sanitize(l.name),
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

export function IssueAssigneeDialog({ repo, issue, onClose, loadingPadding = 0 }) {
  const { t } = useTheme()
  const { data: collabs, loading } = useGh(listCollaborators, [repo])
  if (loading) return <Box paddingX={loadingPadding}><Text color={t.ui.muted}>Loading collaborators...</Text></Box>
  const items = (collabs || []).map(c => ({
    id: c.login,
    name: sanitize(c.login),
    selected: issue.assignees?.some(a => a.login === c.login),
  }))
  return (
    <MultiSelect
      items={items}
      onSubmit={async (selectedIds) => {
        const current = issue.assignees?.map(a => a.login) || []
        const toAdd    = selectedIds.filter(id => !current.includes(id))
        const toRemove = current.filter(id => !selectedIds.includes(id))
        try {
          if (toAdd.length)    await addIssueAssignees(repo, issue.number, toAdd)
          if (toRemove.length) await removeIssueAssignees(repo, issue.number, toRemove)
        } catch { /* ignore */ }
        onClose()
      }}
      onCancel={onClose}
    />
  )
}
