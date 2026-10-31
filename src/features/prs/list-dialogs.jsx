// @ts-check

/** PR label, collaborator and author pickers used by the list pane. */
import React, { useState, useRef } from 'react'
import { Box, Text, useInput } from 'ink'
import { useGh } from '../../hooks/useGh.js'
import { classifyGhFailure, listLabels, listCollaborators, addLabels, removeLabels, addPRAssignees, removePRAssignees, requestReviewers, removeReviewers } from '../../executor.js'
import { MultiSelect } from '../../components/dialogs/MultiSelect.jsx'
import { TextInput, sanitize } from '../../utils.js'
import { useKeyScope } from '../../keyscope.js'
import { matchesAction, firstActionKey } from '../../config/actions.js'
import { FailureNotice } from '../../components/FailureNotice.jsx'
import { useKeymapInput } from '../../config/keymap.js'
import { useTheme } from '../../theme/index.js'
import { schemeToT } from './list-row.jsx'

// Shell shown while options load or fail: Esc always closes, r retries (#443, #444).
function PickerStatus({ title, children, onCancel, onRetry = undefined }) {
  const { scheme } = useTheme()
  const t = schemeToT(scheme)
  useKeyScope('dialog')
  useInput((input, key) => {
    if (matchesAction('dialog.cancel', input, key)) { onCancel(); return }
    if (onRetry && input === firstActionKey('list.refresh', 'r')) onRetry()
  })
  return (
    <Box flexDirection="column" paddingX={1}>
      {title ? <Text color={t.ui.selected} bold>{title}</Text> : null}
      {children}
      <Text color={t.ui.dim}>{onRetry ? `[${firstActionKey('list.refresh', 'r')}] retry  ` : ''}[Esc] close</Text>
    </Box>
  )
}

function PRSelectionDialog({ repo, pr, current, getOptions, field, loadingText, title = '', add, remove, onClose, onError, runWrite = (_label, fn) => fn() }) {
  const { scheme } = useTheme()
  const t = schemeToT(scheme)
  const [saving, setSaving] = useState(false)
  const submitted = useRef(false)
  const { data: options, loading, error, refetch } = useGh(getOptions, [repo])
  const hasOptions = Array.isArray(options) && options.length > 0
  if (saving) return <PickerStatus title={title} onCancel={onClose}><Text color={t.ui.muted}>Updating #{pr.number}…</Text></PickerStatus>
  if (loading && !hasOptions) {
    return <PickerStatus title={title} onCancel={onClose}><Text color={t.ui.muted}>{loadingText}</Text></PickerStatus>
  }
  if (error && !hasOptions) {
    return <PickerStatus title={title} onCancel={onClose} onRetry={refetch}><FailureNotice failure={classifyGhFailure(error)} /></PickerStatus>
  }

  const selected = new Set(current)
  const items = (options || []).map(option => ({
    id: option[field],
    name: sanitize(option[field]),
    color: field === 'name' ? option.color : undefined,
    selected: selected.has(option[field]),
  }))
  // Values already on the PR that the fetched list does not contain (teams,
  // collaborators past the first page, labels past the cap) stay visible and
  // checked, so the diff below only removes what the user unchecked (#423).
  const listed = new Set(items.map(item => item.id))
  for (const id of current) {
    if (!listed.has(id)) items.push({ id, name: sanitize(id), selected: true })
  }

  return (
    <MultiSelect
      title={title}
      items={items}
      onSubmit={async (selectedIds) => {
        if (submitted.current) return
        const toAdd = selectedIds.filter(id => !current.includes(id))
        const toRemove = current.filter(id => !selectedIds.includes(id))
        if (!toAdd.length && !toRemove.length) { onClose(); return }
        submitted.current = true
        setSaving(true)
        let ran = false
        try {
          await runWrite(`Updating #${pr.number}`, async () => {
            ran = true
            if (toAdd.length) await add(repo, pr.number, toAdd)
            if (toRemove.length) await remove(repo, pr.number, toRemove)
          })
          if (!ran && onError) onError(new Error('another update is still in progress'))
        } catch (err) {
          if (onError) onError(err)
        }
        onClose()
      }}
      onCancel={onClose}
    />
  )
}

const addPRLabels = (repo, number, labels) => addLabels(repo, number, labels, 'pr')
const removePRLabels = (repo, number, labels) => removeLabels(repo, number, labels, 'pr')

export function LabelDialog({ repo, pr, onClose, onError, runWrite }) {
  return <PRSelectionDialog
    repo={repo} pr={pr} onClose={onClose} onError={onError} runWrite={runWrite}
    current={pr.labels?.map(label => label.name) || []}
    getOptions={listLabels} field="name" loadingText="Loading labels…"
    add={addPRLabels} remove={removePRLabels}
  />
}

export function AssigneeDialog({ repo, pr, onClose, onError, runWrite }) {
  return <PRSelectionDialog
    repo={repo} pr={pr} onClose={onClose} onError={onError} runWrite={runWrite}
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

export function ReviewerDialog({ repo, pr, onClose, onError, runWrite }) {
  const current = [...new Set((pr.reviewRequests || []).map(reviewer => reviewer.login || reviewer.name).filter(Boolean))]
  return <PRSelectionDialog
    repo={repo} pr={pr} onClose={onClose} onError={onError} runWrite={runWrite}
    current={current} title="Request Reviewers"
    getOptions={listCollaborators} field="login" loadingText="Loading collaborators…"
    add={requestReviewers} remove={removeReviewers}
  />
}
