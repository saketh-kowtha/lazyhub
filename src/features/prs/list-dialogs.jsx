// @ts-nocheck
// TODO(#197): split PR dialog module needs typed imports/props in a follow-up pass.
import React from 'react'
import { Box } from 'ink'
import { useGh } from '../../hooks/useGh.js'
import { listLabels, listCollaborators, addLabels, removeLabels, addPRAssignees, removePRAssignees, requestReviewers, removeReviewers } from '../../executor.js'
import { MultiSelect } from '../../components/dialogs/MultiSelect.jsx'
import { TextInput } from '../../utils.js'
import { useTheme } from '../../theme/index.js'
import { schemeToT } from './list-row.jsx'

export function LabelDialog({ repo, pr, onClose }) {
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

export function AssigneeDialog({ repo, pr, onClose }) {
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
export function AuthorSearchDialog({ current, onSubmit, onCancel }) {
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

export function ReviewerDialog({ repo, pr, onClose }) {
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
