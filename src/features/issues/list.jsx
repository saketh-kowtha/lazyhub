/**
 * src/features/issues/list.jsx — Issue list pane
 */

import React, { useState, useCallback, useEffect, useContext, useRef, memo } from 'react'
import { Box, Text, useInput, useStdout } from 'ink'
import { format } from 'timeago.js'
import { useGh } from '../../hooks/useGh.js'
import { listIssues, listLabels, listCollaborators, closeIssue, createIssue, addLabels, removeLabels } from '../../executor.js'
import { FuzzySearch } from '../../components/dialogs/FuzzySearch.jsx'
import { MultiSelect } from '../../components/dialogs/MultiSelect.jsx'
import { ConfirmDialog } from '../../components/dialogs/ConfirmDialog.jsx'
import { FormCompose } from '../../components/dialogs/FormCompose.jsx'
import { AppContext } from '../../context.js'
import { loadConfig } from '../../config.js'
import { useTheme } from '../../theme.js'

const _cfg = loadConfig().issues

function IssueStateBadge({ issue }) {
  const { t } = useTheme()
  switch (issue.state) {
    case 'OPEN':   return <Text color={t.issue.open}>●</Text>
    case 'CLOSED': return <Text color={t.issue.closed}>✗</Text>
    default:       return <Text color={t.ui.muted}>?</Text>
  }
}

const IssueRow = memo(({ issue, isSelected, t }) => {
  const authorLogin = String(issue.author?.login || '').padEnd(12)
  const visibleLabels = (issue.labels || []).slice(0, 2)
  const extraLabels = (issue.labels || []).length - 2

  return (
    <Box paddingX={1} backgroundColor={isSelected ? t.ui.headerBg : undefined}>
      <IssueStateBadge issue={issue} />
      <Text> </Text>
      <Text color={t.ui.dim} bold>#{String(issue.number).padEnd(5)}</Text>
      <Text color={isSelected ? t.ui.selected : undefined} wrap="truncate" flexGrow={1}>
        {issue.title}
      </Text>
      {visibleLabels.map(l => (
        <Text key={l.name} color={`#${l.color}`}> [{l.name.slice(0, 14)}]</Text>
      ))}
      {extraLabels > 0 && (
        <Text color={t.ui.muted}> +{extraLabels}</Text>
      )}
      <Text color={t.ui.muted}> {authorLogin}</Text>
      <Text color={t.ui.dim}> {format(issue.updatedAt)}</Text>
    </Box>
  )
})

export function IssueList({ repo, listHeight = 10, onSelectIssue, onPaneState }) {
  const { t } = useTheme()
  const { notifyDialog } = useContext(AppContext)
  const { stdout } = useStdout()
  const visibleHeight = listHeight || Math.max(5, (stdout?.rows || 24) - 8)

  const FK = _cfg.keys
  const [filterState, setFilterState] = useState(_cfg.defaultFilter)
  const { data: issues, loading, error, refetch } = useGh(listIssues, [repo, { state: filterState, limit: _cfg.pageSize }])
  const [cursor, setCursor] = useState(0)
  const [scrollOffset, setScrollOffset] = useState(0)
  const [dialog, setDialog] = useState(null)
  const [statusMsg, setStatusMsg] = useState(null)
  const lastKeyRef   = useRef(null)
  const lastKeyTimer = useRef(null)

  const items = issues || []
  const STATE_CYCLE = ['open', 'closed']

  useEffect(() => {
    if (onPaneState) onPaneState({ loading, error, count: items.length })
  }, [loading, error, items.length]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    notifyDialog(!!dialog)
    return () => notifyDialog(false)
  }, [dialog, notifyDialog])

  const showStatus = (msg, isError = false) => {
    setStatusMsg({ msg, isError })
    setTimeout(() => setStatusMsg(null), 3000)
  }

  const moveCursor = useCallback((delta) => {
    setCursor(prev => {
      const next = Math.max(0, Math.min(items.length - 1, prev + delta))
      if (next < scrollOffset) setScrollOffset(next)
      if (next >= scrollOffset + visibleHeight) setScrollOffset(next - visibleHeight + 1)
      return next
    })
  }, [items.length, scrollOffset, visibleHeight])

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
      setCursor(last); setScrollOffset(Math.max(0, last - visibleHeight + 1))
      return
    }

    if (input === 'j' || key.downArrow) { moveCursor(1);  return }
    if (input === 'k' || key.upArrow)   { moveCursor(-1); return }
    if (input === 'r') { refetch(); return }
    if (input === '/') { setDialog('fuzzy'); return }
    if (input === 'n') { setDialog('new'); return }

    // Direct filter keys from config (defaults: O=open, C=closed)
    if (FK.filterOpen   && input === FK.filterOpen   && filterState !== 'open')   { setFilterState('open');   showStatus('▸ open');   setCursor(0); setScrollOffset(0); return }
    if (FK.filterClosed && input === FK.filterClosed && filterState !== 'closed') { setFilterState('closed'); showStatus('▸ closed'); setCursor(0); setScrollOffset(0); return }
    // f still cycles as fallback
    if (input === 'f') {
      setFilterState(prev => {
        const next = STATE_CYCLE[(STATE_CYCLE.indexOf(prev) + 1) % STATE_CYCLE.length]
        showStatus(`▸ ${next}`)
        return next
      })
      setCursor(0); setScrollOffset(0)
      return
    }

    if (loading || items.length === 0) return
    const issue = items[cursor]

    if (key.return) {
      if (issue) onSelectIssue(issue)
      return
    }

    // y — copy issue URL
    if (input === 'y' && issue?.url) {
      import('execa').then(({ execa }) => {
        const [cmd, args] = process.platform === 'darwin'
          ? ['pbcopy', []]
          : ['xclip', ['-selection', 'clipboard']]
        const proc = execa(cmd, args)
        proc.stdin?.end(issue.url)
        proc.then(() => showStatus(`✓ Copied ${issue.url}`)).catch(() => showStatus('✗ Copy failed', true))
      })
      return
    }

    if (input === 'x') {
      if (issue) setDialog('close')
      return
    }

    if (input === 'l') {
      if (issue) setDialog('labels')
      return
    }

    if (input === 'A') {
      if (issue) setDialog('assignees')
      return
    }
  })

  const selectedIssue = items[cursor]
  const visibleIssues = items.slice(scrollOffset, scrollOffset + visibleHeight)

  if (dialog === 'fuzzy') {
    return (
      <Box flexDirection="column" flexGrow={1}>
        <FuzzySearch
          items={items}
          searchFields={['title', 'number', 'author']}
          onSubmit={(item) => {
            const idx = items.indexOf(item)
            if (idx !== -1) { setCursor(idx); setScrollOffset(Math.max(0, idx - 2)) }
            setDialog(null)
          }}
          onCancel={() => setDialog(null)}
        />
      </Box>
    )
  }

  if (dialog === 'close' && selectedIssue) {
    return (
      <Box flexDirection="column" flexGrow={1}>
        <ConfirmDialog
          message={`Close issue #${selectedIssue.number}: ${selectedIssue.title}?`}
          destructive={true}
          onConfirm={async () => {
            setDialog(null)
            try {
              await closeIssue(repo, selectedIssue.number)
              showStatus(`Closed #${selectedIssue.number}`)
              refetch()
            } catch (err) {
              showStatus(`Failed: ${err.message}`, true)
            }
          }}
          onCancel={() => setDialog(null)}
        />
      </Box>
    )
  }

  if (dialog === 'new') {
    return (
      <Box flexDirection="column" flexGrow={1}>
        <FormCompose
          title="New Issue"
          fields={[
            { name: 'title', label: 'Title', type: 'text' },
            { name: 'body', label: 'Body', type: 'multiline' },
          ]}
          onSubmit={async (values) => {
            setDialog(null)
            try {
              await createIssue(repo, { title: values.title, body: values.body })
              showStatus('Issue created')
              refetch()
            } catch (err) {
              showStatus(`Failed: ${err.message}`, true)
            }
          }}
          onCancel={() => setDialog(null)}
        />
      </Box>
    )
  }

  if (dialog === 'labels' && selectedIssue) {
    return <IssueLabelDialog repo={repo} issue={selectedIssue} onClose={() => { setDialog(null); refetch() }} />
  }

  if (dialog === 'assignees' && selectedIssue) {
    return <IssueAssigneeDialog repo={repo} issue={selectedIssue} onClose={() => { setDialog(null); refetch() }} />
  }

  return (
    <Box flexDirection="column" flexGrow={1}>
      <Box paddingX={1} gap={1}>
        <Text color={t.ui.dim}>filter:</Text>
        <Text color={filterState === 'open' ? t.issue.open : t.issue.closed} bold>{filterState}</Text>
        <Text color={t.ui.dim}>  [{FK.filterOpen}] open  [{FK.filterClosed}] closed  [n] new</Text>
        {statusMsg && (
          <Text color={statusMsg.isError ? t.ci.fail : t.ci.pass}> {statusMsg.msg}</Text>
        )}
      </Box>
      <Box flexDirection="column" flexGrow={1}>
        {loading && items.length === 0 && (
          <Box paddingX={2} paddingY={1}>
            <Text color={t.ui.muted}>  Loading issues…</Text>
          </Box>
        )}
        {visibleIssues.map((issue, i) => {
          const idx = scrollOffset + i
          const isSelected = idx === cursor

          return (
            <IssueRow
              key={issue.number}
              issue={issue}
              isSelected={isSelected}
              t={t}
            />
          )
        })}
        {!loading && items.length === 0 && (
          <Box paddingX={2} paddingY={1}>
            <Text color={t.ui.muted}>No {filterState} issues found. [f] cycle filter  [n] new issue  [r] refresh</Text>
          </Box>
        )}
      </Box>
    </Box>
  )
}

function IssueLabelDialog({ repo, issue, onClose }) {
  const { t } = useTheme()
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
  const { t } = useTheme()
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
