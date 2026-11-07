// @ts-check

/** PR label, collaborator and author pickers used by the list pane. */
import React, { useState, useRef } from 'react'
import { Box, Text } from 'ink'
import { useInput } from '../../hooks/useSafeInput.js'
import { useGh } from '../../hooks/useGh.js'
import { classifyGhFailure, listLabels, listCollaborators, editPRMembers, validatePRSearch, collaboratorsTruncated, COLLAB_MAX_ROWS } from '../../executor.js'
import { MultiSelect } from '../../components/dialogs/MultiSelect.jsx'
import { TextInput, sanitize } from '../../utils.js'
import { useKeyScope } from '../../keyscope.js'
import { matchesAction, firstActionKey, hintLine } from '../../config/actions.js'
import { useVirtualList } from '../../hooks/useVirtualList.js'
import { buildAuthorCandidates, rankAuthors, loadRecentAuthors } from './author-candidates.js'
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

function PRSelectionDialog({ repo, pr, current: currentNow, names = {}, getOptions, field, loadingText, title = '', kind, onClose, onError, runWrite = (_label, fn) => fn() }) {
  const { scheme } = useTheme()
  const t = schemeToT(scheme)
  // The diff base is what the PR had when the dialog opened; a refetch behind it must not move it.
  const [current] = useState(currentNow)
  const [saving, setSaving] = useState(false)
  const submitted = useRef(false)
  // Esc while saving closes the dialog at once; the late completion must not close whatever opened next.
  const dismissed = useRef(false)
  const dismiss = () => { dismissed.current = true; onClose() }
  const { data: options, loading, error, refetch } = useGh(getOptions, [repo])
  const hasOptions = Array.isArray(options) && options.length > 0
  if (saving) return <PickerStatus title={title} onCancel={dismiss}><Text color={t.ui.muted}>Updating #{pr.number}…</Text></PickerStatus>
  if (loading && !hasOptions) {
    return <PickerStatus title={title} onCancel={onClose}><Text color={t.ui.muted}>{loadingText}</Text></PickerStatus>
  }
  if (error && !hasOptions) {
    // The classified cause says what to do; the first line of gh's own message says why (e.g. 403 needs push access).
    const reason = sanitize(String(error?.message || '').split('\n').find(line => line.trim()) || '').slice(0, 100)
    return (
      <PickerStatus title={title} onCancel={onClose} onRetry={refetch}>
        <FailureNotice failure={classifyGhFailure(error)} />
        {reason ? <Text color={t.ui.dim}>{`  ${reason}`}</Text> : null}
      </PickerStatus>
    )
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

  // Never silently cap the list: say so when GitHub paging stopped at the ceiling (#444).
  const truncated = field === 'login' && collaboratorsTruncated(options)
  const picker = (
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
            await editPRMembers(repo, pr.number, kind, { add: toAdd, remove: toRemove })
          })
          if (!ran && onError) onError(new Error('another update is still in progress'))
        } catch (err) {
          if (onError) onError(err)
        }
        if (!dismissed.current) onClose()
      }}
      onCancel={onClose}
    />
  )
  if (!truncated) return picker
  return (
    <Box flexDirection="column">
      <Text color={t.ci.pending}>{`showing first ${COLLAB_MAX_ROWS.toLocaleString('en-US')} collaborators`}</Text>
      {picker}
    </Box>
  )
}

export function LabelDialog({ repo, pr, onClose, onError, runWrite }) {
  return <PRSelectionDialog
    repo={repo} pr={pr} onClose={onClose} onError={onError} runWrite={runWrite}
    current={pr.labels?.map(label => label.name) || []}
    getOptions={listLabels} field="name" loadingText="Loading labels…"
    title={`Labels: PR #${pr.number}`}
    kind="label"
  />
}

export function AssigneeDialog({ repo, pr, onClose, onError, runWrite }) {
  return <PRSelectionDialog
    repo={repo} pr={pr} onClose={onClose} onError={onError} runWrite={runWrite}
    current={pr.assignees?.map(assignee => assignee.login) || []}
    getOptions={listCollaborators} field="login" loadingText="Loading collaborators…"
    title={`Assignees: PR #${pr.number}`}
    kind="assignee"
  />
}

// Author filter (#563): a searchable list seeded from the loaded rows, the repository's
// collaborators and recent filters. Typed text that matches nothing is still applied as-is,
// and the list never blocks typing: loading and failure only change the rows below the field.
const AUTHOR_LIST_ROWS = 8
const SOURCE_LABEL = { recent: 'recent', row: 'in list', collaborator: 'collaborator' }

export function AuthorSearchDialog({ current, repo, rows = [], onSubmit, onCancel }) {
  const { scheme } = useTheme()
  const t = schemeToT(scheme)
  const [text, setText] = useState(current || '')
  // Read once per open: loadState() is a synchronous file read, not for every render (#455).
  const [recent] = useState(() => loadRecentAuthors(repo))
  useKeyScope('dialog')
  const { data: collaborators, loading, error } = useGh(listCollaborators, [repo], { enabled: Boolean(repo) }) || {}
  const query = text.trim().replace(/^@/, '')

  const matches = React.useMemo(
    () => rankAuthors(buildAuthorCandidates({ rows, collaborators, recent }), query),
    [rows, collaborators, recent, query],
  )
  // Rows the cursor can land on: "all authors" when nothing is typed, the matches, and the typed
  // text itself unless it is already the exact top match (so a free-typed login always works).
  const entries = React.useMemo(() => {
    const out = []
    if (!query) out.push({ id: '__all__', login: '', kind: 'all' })
    for (const m of matches) out.push({ id: `u:${m.login}`, login: m.login, kind: 'user', match: m })
    if (query && matches[0]?.login.toLowerCase() !== query.toLowerCase()) out.push({ id: '__typed__', login: query, kind: 'typed' })
    return out
  }, [matches, query])

  const { cursor, scrollOffset, visibleItems, moveCursor, setCursor, setScrollOffset } =
    useVirtualList({ items: entries, height: AUTHOR_LIST_ROWS })

  useInput((input, key) => {
    if (matchesAction('dialog.cancel', input, key)) { onCancel(); return }
    if (matchesAction('dialog.confirm', input, key)) {
      const entry = entries[cursor]
      onSubmit(entry ? entry.login : query)
      return
    }
    if (matchesAction('dialog.filter-up', input, key)) { moveCursor(cursor - 1); return }
    if (matchesAction('dialog.filter-down', input, key)) { moveCursor(cursor + 1); return }
  })

  const truncated = collaboratorsTruncated(collaborators)
  const reason = error ? sanitize(String(error?.message || '').split('\n').find(line => line.trim()) || '').slice(0, 100) : ''
  return (
    <Box flexDirection="column" borderStyle="round" borderColor={t.ui.selected} paddingX={2} paddingY={1}>
      <Text color={t.ui.selected} bold>Filter by author</Text>
      <Box marginTop={1} gap={1}>
        <Text color={t.ui.dim}>@</Text>
        <TextInput value={text} onChange={v => { setText(v); setCursor(0); setScrollOffset(0) }} focus={true} placeholder="type to search, or a username" />
      </Box>
      {loading && !collaborators && <Text color={t.ui.muted}>Loading collaborators…</Text>}
      {error && !collaborators && (
        <Box flexDirection="column">
          <FailureNotice failure={classifyGhFailure(error)} compact />
          {reason ? <Text color={t.ui.dim}>{`  ${reason}`}</Text> : null}
          <Text color={t.ui.dim}>Collaborators are unavailable; type a username and press Enter.</Text>
        </Box>
      )}
      {truncated && <Text color={t.ci.pending}>{`showing first ${COLLAB_MAX_ROWS.toLocaleString('en-US')} collaborators`}</Text>}
      <Box marginTop={1} flexDirection="column">
        {visibleItems.map((entry, i) => {
          const isCursor = scrollOffset + i === cursor
          const color = isCursor ? t.ui.selected : undefined
          return (
            <Box key={entry.id}>
              <Text color={isCursor ? t.ui.selected : t.ui.muted}>{isCursor ? '▶ ' : '  '}</Text>
              {entry.kind === 'all' && <Text color={color}>All authors (clear filter)</Text>}
              {entry.kind === 'typed' && <Text color={color} wrap="truncate">{`Use "${sanitize(entry.login)}" as typed`}</Text>}
              {entry.kind === 'user' && (
                <Text color={color} wrap="truncate">
                  {sanitize(entry.login)}
                  <Text color={t.ui.dim}>{`${entry.match.name ? `  ${sanitize(entry.match.name)}` : ''}  ${entry.match.sources.map(src => SOURCE_LABEL[src]).join(', ')}`}</Text>
                </Text>
              )}
            </Box>
          )
        })}
      </Box>
      <Box marginTop={1}>
        <Text color={t.ui.dim} wrap="truncate">{hintLine(['dialog.type', ['dialog.filter-down', 'nav'], 'dialog.confirm', 'dialog.cancel'])}</Text>
      </Box>
    </Box>
  )
}

// Server-side search (#508): the text goes to GitHub search, so any PR in the repo is reachable.
export function SearchQueryDialog({ current, onSubmit, onCancel }) {
  const { scheme } = useTheme()
  const t = schemeToT(scheme)
  const [text, setText] = useState(current || '')
  const [problem, setProblem] = useState(null)
  useKeyScope('dialog')

  useKeymapInput((input, key) => {
    if (key.escape) { onCancel(); return }
    if (key.return) {
      try { onSubmit(validatePRSearch(text)) } catch (err) { setProblem(err.message) }
    }
  })

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={t.ui.selected} paddingX={2} paddingY={1}>
      <Text color={t.ui.selected} bold>Search pull requests</Text>
      <Box marginTop={1} gap={1}>
        <Text color={t.ui.dim}>/</Text>
        <TextInput value={text} onChange={v => { setText(v); setProblem(null) }} focus={true} placeholder="author:alice flaky test" />
      </Box>
      {problem && <Text color={t.ci.fail}>{sanitize(problem)}</Text>}
      <Text color={t.ui.dim}>GitHub search, any age. [Enter] apply  [Esc] cancel  (empty = clear)</Text>
    </Box>
  )
}

// A reviewer's id is the login, or "org/slug" for a team (the list query folds it into login).
const reviewerId = (reviewer) => reviewer.login || reviewer.slug || reviewer.name

export function ReviewerDialog({ repo, pr, onClose, onError, runWrite }) {
  const requests = (pr.reviewRequests || []).filter(reviewer => reviewerId(reviewer))
  const current = [...new Set(requests.map(reviewerId))]
  const names = Object.fromEntries(requests.map(reviewer => [reviewerId(reviewer), reviewer.name || reviewerId(reviewer)]))
  return <PRSelectionDialog
    repo={repo} pr={pr} onClose={onClose} onError={onError} runWrite={runWrite}
    current={current} names={names} title={`Reviewers: PR #${pr.number}`}
    getOptions={listCollaborators} field="login" loadingText="Loading collaborators…"
    kind="reviewer"
  />
}
