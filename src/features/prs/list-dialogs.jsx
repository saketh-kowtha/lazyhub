// @ts-check

/** PR label, collaborator and author pickers used by the list pane. */
import React, { useState } from 'react'
import { Box, Text, useInput } from 'ink'
import { useGh } from '../../hooks/useGh.js'
import { classifyGhFailure, listLabels, listCollaborators, editPRMembers } from '../../executor.js'
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

function PRSelectionDialog({ repo, pr, current: currentNow, names = {}, getOptions, field, loadingText, title = '', kind, onClose, onError }) {
  const { scheme } = useTheme()
  const t = schemeToT(scheme)
  // The diff base is what the PR had when the dialog opened; a refetch behind it must not move it.
  const [current] = useState(currentNow)
  const { data: options, loading, error, refetch } = useGh(getOptions, [repo])
  const hasOptions = Array.isArray(options) && options.length > 0
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
    if (!listed.has(id)) items.push({ id, name: sanitize(names[id] || id), selected: true })
  }

  return (
    <MultiSelect
      title={title}
      items={items}
      onSubmit={async (selectedIds) => {
        const toAdd = selectedIds.filter(id => !current.includes(id))
        const toRemove = current.filter(id => !selectedIds.includes(id))
        try {
          await editPRMembers(repo, pr.number, kind, { add: toAdd, remove: toRemove })
        } catch (err) {
          if (onError) onError(err)
        }
        onClose()
      }}
      onCancel={onClose}
    />
  )
}

export function LabelDialog({ repo, pr, onClose, onError }) {
  return <PRSelectionDialog
    repo={repo} pr={pr} onClose={onClose} onError={onError}
    current={pr.labels?.map(label => label.name) || []}
    getOptions={listLabels} field="name" loadingText="Loading labels…"
    kind="label"
  />
}

export function AssigneeDialog({ repo, pr, onClose, onError }) {
  return <PRSelectionDialog
    repo={repo} pr={pr} onClose={onClose} onError={onError}
    current={pr.assignees?.map(assignee => assignee.login) || []}
    getOptions={listCollaborators} field="login" loadingText="Loading collaborators…"
    kind="assignee"
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

// A reviewer's id is the login, or "org/slug" for a team (gh JSON gives slug, the list query folds it into login).
const reviewerId = (reviewer) => reviewer.login || reviewer.slug || reviewer.name

export function ReviewerDialog({ repo, pr, onClose, onError }) {
  const requests = (pr.reviewRequests || []).filter(reviewer => reviewerId(reviewer))
  const current = [...new Set(requests.map(reviewerId))]
  const names = Object.fromEntries(requests.map(reviewer => [reviewerId(reviewer), reviewer.name || reviewerId(reviewer)]))
  return <PRSelectionDialog
    repo={repo} pr={pr} onClose={onClose} onError={onError}
    current={current} names={names} title="Request Reviewers"
    getOptions={listCollaborators} field="login" loadingText="Loading collaborators…"
    kind="reviewer"
  />
}
