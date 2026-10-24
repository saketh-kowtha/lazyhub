// @ts-check

/** PR label, collaborator and author pickers used by the list pane. */
import React, { useState } from 'react'
import { Box, Text } from 'ink'
import { useGh } from '../../hooks/useGh.js'
import { listLabels, listCollaborators, addLabels, removeLabels, addPRAssignees, removePRAssignees, requestReviewers, removeReviewers } from '../../executor.js'
import { MultiSelect } from '../../components/dialogs/MultiSelect.jsx'
import { TextInput, sanitize } from '../../utils.js'
import { useKeyScope } from '../../keyscope.js'
import { useKeymapInput } from '../../config/keymap.js'
import { useTheme } from '../../theme/index.js'
import { schemeToT } from './list-row.jsx'

function PRSelectionDialog({ repo, pr, current, getOptions, field, loadingText, title = '', add, remove, onClose }) {
  const { scheme } = useTheme()
  const t = schemeToT(scheme)
  const { data: options, loading } = useGh(getOptions, [repo])
  if (loading) return <Box paddingX={1}><Text color={t.ui.muted}>{loadingText}</Text></Box>

  const selected = new Set(current)
  const items = (options || []).map(option => ({
    id: option[field],
    name: sanitize(option[field]),
    color: field === 'name' ? option.color : undefined,
    selected: selected.has(option[field]),
  }))

  return (
    <MultiSelect
      title={title}
      items={items}
      onSubmit={async (selectedIds) => {
        const toAdd = selectedIds.filter(id => !current.includes(id))
        const toRemove = current.filter(id => !selectedIds.includes(id))
        try {
          if (toAdd.length) await add(repo, pr.number, toAdd)
          if (toRemove.length) await remove(repo, pr.number, toRemove)
        } catch { /* ignore */ }
        onClose()
      }}
      onCancel={onClose}
    />
  )
}

const addPRLabels = (repo, number, labels) => addLabels(repo, number, labels, 'pr')
const removePRLabels = (repo, number, labels) => removeLabels(repo, number, labels, 'pr')

export function LabelDialog({ repo, pr, onClose }) {
  return <PRSelectionDialog
    repo={repo} pr={pr} onClose={onClose}
    current={pr.labels?.map(label => label.name) || []}
    getOptions={listLabels} field="name" loadingText="Loading labels…"
    add={addPRLabels} remove={removePRLabels}
  />
}

export function AssigneeDialog({ repo, pr, onClose }) {
  return <PRSelectionDialog
    repo={repo} pr={pr} onClose={onClose}
    current={pr.assignees?.map(assignee => assignee.login) || []}
    getOptions={listCollaborators} field="login" loadingText="Loading collaborators…"
    add={addPRAssignees} remove={removePRAssignees}
  />
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
  const current = [...new Set((pr.reviewRequests || []).map(reviewer => reviewer.login || reviewer.name).filter(Boolean))]
  return <PRSelectionDialog
    repo={repo} pr={pr} onClose={onClose}
    current={current} title="Request Reviewers"
    getOptions={listCollaborators} field="login" loadingText="Loading collaborators…"
    add={requestReviewers} remove={removeReviewers}
  />
}
