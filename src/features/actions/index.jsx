/**
 * src/features/actions/index.jsx — Actions / workflow runs pane
 */

import React, { useState, useCallback, useEffect, useContext } from 'react'
import { Box, Text, useInput, useStdout } from 'ink'
import { format } from 'timeago.js'
import { useGh } from '../../hooks/useGh.js'
import { listRuns, getRunLogs, rerunRun, cancelRun } from '../../executor.js'
import { ConfirmDialog } from '../../components/dialogs/ConfirmDialog.jsx'
import { LogViewer } from '../../components/dialogs/LogViewer.jsx'
import { AppContext } from '../../context.js'
import { t } from '../../theme.js'

function statusBadge(run) {
  const status = run.status
  const conclusion = run.conclusion
  if (conclusion === 'success') return { icon: '✓', color: t.ci.pass }
  if (conclusion === 'failure' || conclusion === 'timed_out') return { icon: '✗', color: t.ci.fail }
  if (status === 'in_progress' || status === 'queued') return { icon: '●', color: t.ci.running }
  if (conclusion === 'cancelled') return { icon: '⊘', color: t.ui.muted }
  if (conclusion === 'skipped') return { icon: '—', color: t.ui.dim }
  return { icon: '?', color: t.ui.dim }
}

export function ActionList({ repo, listHeight = 10, onPaneState }) {
  const { notifyDialog } = useContext(AppContext)
  const { stdout } = useStdout()
  const visibleHeight = listHeight || Math.max(5, (stdout?.rows || 24) - 8)

  const { data: runs, loading, error, refetch } = useGh(listRuns, [repo])
  const [cursor, setCursor] = useState(0)
  const [scrollOffset, setScrollOffset] = useState(0)
  const [dialog, setDialog] = useState(null) // null | 'logs' | 'cancel'
  const [logLines, setLogLines] = useState([])
  const [logLoading, setLogLoading] = useState(false)
  const [statusMsg, setStatusMsg] = useState(null)

  const items = runs || []

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

  const openLogs = useCallback(async () => {
    const run = items[cursor]
    if (!run) return
    setLogLoading(true)
    setDialog('logs')
    try {
      const rawLogs = await getRunLogs(repo, run.databaseId)
      const lines = typeof rawLogs === 'string' ? rawLogs.split('\n') : []
      setLogLines(lines)
    } catch (err) {
      setLogLines([`Error loading logs: ${err.message}`])
    }
    setLogLoading(false)
  }, [items, cursor, repo])

  useInput((input, key) => {
    if (dialog) return
    if (input === 'j' || key.downArrow) { moveCursor(1); return }
    if (input === 'k' || key.upArrow)  { moveCursor(-1); return }
    if (input === 'r') { refetch(); return }
    if (loading || items.length === 0) return

    if (key.return || input === 'l') {
      openLogs()
      return
    }

    if (input === 'R') {
      const run = items[cursor]
      if (run) {
        rerunRun(repo, run.databaseId)
          .then(() => { showStatus('Re-run triggered'); refetch() })
          .catch(err => showStatus(`Failed: ${err.message}`, true))
      }
      return
    }

    if (input === 'X') {
      if (items[cursor]) setDialog('cancel')
      return
    }
  })

  const visibleRuns = items.slice(scrollOffset, scrollOffset + visibleHeight)

  if (dialog === 'logs') {
    if (logLoading) {
      return (
        <Box flexDirection="column" flexGrow={1} paddingX={1}>
          <Text color={t.ui.muted}>Loading logs...</Text>
        </Box>
      )
    }
    return (
      <LogViewer
        lines={logLines}
        onClose={() => setDialog(null)}
      />
    )
  }

  if (dialog === 'cancel' && items[cursor]) {
    const run = items[cursor]
    return (
      <Box flexDirection="column" flexGrow={1}>
        <ConfirmDialog
          message={`Cancel run: ${run.workflowName} on ${run.headBranch}?`}
          destructive={true}
          onConfirm={async () => {
            setDialog(null)
            try {
              await cancelRun(repo, run.databaseId)
              showStatus('Run cancelled')
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

  return (
    <Box flexDirection="column" flexGrow={1}>
      {statusMsg && (
        <Box paddingX={1}>
          <Text color={statusMsg.isError ? t.ci.fail : t.ci.pass}>{statusMsg.msg}</Text>
        </Box>
      )}
      <Box flexDirection="column" flexGrow={1}>
        {visibleRuns.map((run, i) => {
          const idx = scrollOffset + i
          const isSelected = idx === cursor
          const badge = statusBadge(run)
          return (
            <Box key={run.databaseId} paddingX={1} backgroundColor={isSelected ? '#1c2128' : undefined}>
              <Text color={badge.color}>{badge.icon} </Text>
              <Text color={isSelected ? t.ui.selected : undefined} wrap="truncate" flexGrow={1}>
                {run.workflowName}
              </Text>
              <Text color={t.ui.muted}> {run.headBranch}</Text>
              <Text color={t.ui.dim}> {format(run.createdAt)}</Text>
            </Box>
          )
        })}
        {!loading && items.length === 0 && (
          <Box paddingX={2} paddingY={1}>
            <Text color={t.ui.muted}>No workflow runs found. [r] refresh</Text>
          </Box>
        )}
      </Box>
    </Box>
  )
}
