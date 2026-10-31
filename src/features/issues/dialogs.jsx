/**
 * Shared issue label and assignee editors; display names are sanitized, IDs stay raw.
 * Same contract as the PR pickers (#513): Esc closes while options load, a load
 * failure says why and r retries, values already on the issue that the fetched
 * list lacks stay checked (never stripped), and the change is ONE edit call.
 */

import React, { useState, useRef } from 'react'
import { Box, Text, useInput } from 'ink'
import { useGh } from '../../hooks/useGh.js'
import { classifyGhFailure, listLabels, listCollaborators, editIssueMembers } from '../../executor.js'
import { MultiSelect } from '../../components/dialogs/MultiSelect.jsx'
import { FailureNotice } from '../../components/FailureNotice.jsx'
import { useKeyScope } from '../../keyscope.js'
import { matchesAction, firstActionKey } from '../../config/actions.js'
import { useTheme } from '../../theme.js'
import { sanitize } from '../../utils.js'

// Shell shown while options load, fail or save: Esc always closes, r retries.
function PickerStatus({ children, onCancel, onRetry = undefined, padding = 0 }) {
  const { t } = useTheme()
  useKeyScope('dialog')
  useInput((input, key) => {
    if (matchesAction('dialog.cancel', input, key)) { onCancel(); return }
    if (onRetry && input === firstActionKey('list.refresh', 'r')) onRetry()
  })
  return (
    <Box flexDirection="column" paddingX={padding}>
      {children}
      <Text color={t.ui.dim}>{onRetry ? `[${firstActionKey('list.refresh', 'r')}] retry  ` : ''}[Esc] close</Text>
    </Box>
  )
}

function IssueSelectionDialog({ repo, issue, current: currentNow, getOptions, field, kind, loadingText, onClose, onError, loadingPadding = 0 }) {
  const { t } = useTheme()
  // The diff base is what the issue had when the dialog opened; a refetch behind it must not move it.
  const [current] = useState(currentNow)
  const [saving, setSaving] = useState(false)
  const submitted = useRef(false)
  // Esc while saving closes at once; the late completion must not close whatever opened next.
  const dismissed = useRef(false)
  const dismiss = () => { dismissed.current = true; onClose() }
  const { data: options, loading, error, refetch } = useGh(getOptions, [repo])
  const hasOptions = Array.isArray(options) && options.length > 0

  if (saving) {
    return <PickerStatus onCancel={dismiss} padding={loadingPadding}><Text color={t.ui.muted}>Updating #{issue.number}...</Text></PickerStatus>
  }
  if (loading && !hasOptions) {
    return <PickerStatus onCancel={onClose} padding={loadingPadding}><Text color={t.ui.muted}>{loadingText}</Text></PickerStatus>
  }
  if (error && !hasOptions) {
    return <PickerStatus onCancel={onClose} onRetry={refetch} padding={loadingPadding}><FailureNotice failure={classifyGhFailure(error)} /></PickerStatus>
  }

  const selected = new Set(current)
  const items = (options || []).map(option => ({
    id: option[field],
    name: sanitize(option[field]),
    color: field === 'name' ? option.color : undefined,
    selected: selected.has(option[field]),
  }))
  // Values on the issue that the fetched list does not contain (labels past the
  // cap, collaborators the token cannot list) stay visible and checked, so the
  // diff only removes what the user unchecked.
  const listed = new Set(items.map(item => item.id))
  for (const id of current) {
    if (!listed.has(id)) items.push({ id, name: sanitize(id), selected: true })
  }

  return (
    <MultiSelect
      items={items}
      onSubmit={async (selectedIds) => {
        if (submitted.current) return
        const toAdd = selectedIds.filter(id => !current.includes(id))
        const toRemove = current.filter(id => !selectedIds.includes(id))
        if (!toAdd.length && !toRemove.length) { onClose(); return }
        submitted.current = true
        setSaving(true)
        try {
          await editIssueMembers(repo, issue.number, kind, { add: toAdd, remove: toRemove })
        } catch (err) {
          if (onError) onError(err)
        }
        if (!dismissed.current) onClose()
      }}
      onCancel={onClose}
    />
  )
}

export function IssueLabelDialog({ repo, issue, onClose, onError, loadingPadding = 0 }) {
  return <IssueSelectionDialog
    repo={repo} issue={issue} onClose={onClose} onError={onError} loadingPadding={loadingPadding}
    current={issue.labels?.map(l => l.name) || []}
    getOptions={listLabels} field="name" kind="label" loadingText="Loading labels..."
  />
}

export function IssueAssigneeDialog({ repo, issue, onClose, onError, loadingPadding = 0 }) {
  return <IssueSelectionDialog
    repo={repo} issue={issue} onClose={onClose} onError={onError} loadingPadding={loadingPadding}
    current={issue.assignees?.map(a => a.login) || []}
    getOptions={listCollaborators} field="login" kind="assignee" loadingText="Loading collaborators..."
  />
}
