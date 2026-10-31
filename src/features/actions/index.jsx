/**
 * src/features/actions/index.jsx — Actions / workflow runs pane
 */

import React, { useState, useCallback, useEffect, useContext, useRef, memo } from 'react'
import { Box, Text, useStdout } from 'ink'
import { format } from 'timeago.js'
import { useKeymapInput } from '../../config/keymap.js'
import { useGh } from '../../hooks/useGh.js'
import { usePendingWrite } from '../../hooks/usePendingWrite.js'
import { classifyGhFailure, listRuns, getRunLogs, rerunRun, cancelRun } from '../../executor.js'
import { ConfirmDialog } from '../../components/dialogs/ConfirmDialog.jsx'
import { LogViewer } from '../../components/dialogs/LogViewer.jsx'
import { AppContext } from '../../context.js'
import { useKeyScope } from '../../keyscope.js'
import { useTheme } from '../../theme.js'
import { FailureNotice } from '../../components/FailureNotice.jsx'
import { Spinner } from '../../components/Spinner.jsx'
import { ActionListSkeleton } from '../../components/Skeleton.jsx'
import { firstActionKey, matchesAction } from '../../config/actions.js'
import { sanitize } from '../../utils.js'

function StatusBadge({ run }) {
  const { t } = useTheme()
  const status = run.status
  const conclusion = run.conclusion
  if (conclusion === 'success') return <Text color={t.ci.pass}>✓</Text>
  if (conclusion === 'failure' || conclusion === 'timed_out') return <Text color={t.ci.fail}>✗</Text>
  if (status === 'in_progress' || status === 'queued') return <Text color={t.ci.running}>●</Text>
  if (conclusion === 'cancelled') return <Text color={t.ui.muted}>⊘</Text>
  if (conclusion === 'skipped') return <Text color={t.ui.dim}>—</Text>
  return <Text color={t.ui.dim}>?</Text>
}

const ActionRow = memo(({ run, isSelected, t }) => {
  return (
    <Box key={run.databaseId} paddingX={1} backgroundColor={isSelected ? t.ui.headerBg : undefined}>
      <StatusBadge run={run} />
      <Text> </Text>
      <Box flexGrow={1}>
        <Text color={isSelected ? t.ui.selected : undefined} wrap="truncate">
          {sanitize(run.workflowName)}
        </Text>
      </Box>
      <Text color={t.ui.muted}> {sanitize(run.headBranch)}</Text>
      <Text color={t.ui.dim}> {format(run.createdAt)}</Text>
    </Box>
  )
})

export function ActionList({ repo, listHeight = 10, onPaneState, initialBranch = null }) {
  useKeyScope('pane')
  const { t } = useTheme()
  const { notifyDialog } = useContext(AppContext)
  const { stdout } = useStdout()
  const visibleHeight = listHeight || Math.max(5, (stdout?.rows || 24) - 8)

  const [branchFilter, setBranchFilter] = useState(initialBranch)
  const { data: runs, loading, error, refetch, isStale } = useGh(listRuns, [repo, branchFilter ? { branch: branchFilter } : {}])
  const [cursor, setCursor] = useState(0)
  const [scrollOffset, setScrollOffset] = useState(0)
  const [dialog, setDialog] = useState(null) // null | 'logs' | 'cancel'
  const [logLines, setLogLines] = useState([])
  const [logLoading, setLogLoading] = useState(false)
  const [statusMsg, setStatusMsg] = useState(null)
  const lastKeyRef   = useRef(null)
  const lastKeyTimer = useRef(null)

  const items = runs || []

  useEffect(() => {
    if (onPaneState) onPaneState({ loading, error, count: items.length, isStale })
  }, [loading, error, items.length, isStale]) // eslint-disable-line react-hooks/exhaustive-deps

  // A refetch can shrink the list (cancelled run, read notification); keep the cursor on a real row.
  useEffect(() => {
    if (items.length > 0 && cursor > items.length - 1) {
      const last = items.length - 1
      setCursor(last)
      setScrollOffset(Math.max(0, last - visibleHeight + 1))
    }
  }, [items.length]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    notifyDialog(!!dialog)
    if (onPaneState) onPaneState({ dialogHint: dialog || null })
    return () => { notifyDialog(false); if (onPaneState) onPaneState({ dialogHint: null }) }
  }, [dialog, notifyDialog]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => () => { clearTimeout(lastKeyTimer.current) }, [])

  const statusTimer = useRef(null)
  useEffect(() => () => { clearTimeout(statusTimer.current) }, [])
  const showStatus = (msg, isError = false, sticky = false) => {
    clearTimeout(statusTimer.current)
    setStatusMsg({ msg, isError, persist: isError })
    if (!isError && !sticky) statusTimer.current = setTimeout(() => setStatusMsg(null), 3000)
  }
  // Pending/double-submit guard for rerun and cancel (#453).
  const { run: pendingRun } = usePendingWrite((msg) => showStatus(msg, false, true))
  // Resolves true only when fn ran (false when ignored as a double submit).
  const runWrite = async (label, fn) => {
    let ran = false
    await pendingRun(label, async () => { ran = true; return fn() })
    return ran
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
      const rawLines = typeof rawLogs === 'string' ? rawLogs.split('\n') : []
      const lines = rawLines
        .filter(l => !l.trimStart().startsWith('##[endgroup]'))
        .map(l => {
          // Strip ANSI escape codes
          let out = l.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '')
          // Convert ##[group]<name> to section header
          const groupMatch = out.match(/^##\[group\](.+)/)
          if (groupMatch) return `=== ${groupMatch[1].trim()} ===`
          // Trim ISO timestamp prefix to HH:MM:SS
          out = out.replace(/^\d{4}-\d{2}-\d{2}T(\d{2}:\d{2}:\d{2})\.\d+Z\s*/, '$1 ')
          return out
        })
      setLogLines(lines)
    } catch (err) {
      setLogLines([`Error loading logs: ${err.message}`])
    }
    setLogLoading(false)
  }, [items, cursor, repo])

  useKeymapInput((input, key) => {
    if (statusMsg?.persist) { setStatusMsg(null) }
    if (dialog) return
    if (matchesAction('cursor.down', input, key)) { moveCursor(1); return }
    if (matchesAction('cursor.up', input, key))  { moveCursor(-1); return }
    if (matchesAction('list.refresh', input, key)) { refetch(); return }
    if (matchesAction('workflow.clear-filter', input, key) && branchFilter) { setBranchFilter(null); setCursor(0); setScrollOffset(0); return }

    // gg → top
    const topSequenceKey = firstActionKey('cursor.top', 'gg')[0]
    if (input === topSequenceKey) {
      if (lastKeyRef.current === topSequenceKey) {
        clearTimeout(lastKeyTimer.current)
        lastKeyRef.current = null
        setCursor(0); setScrollOffset(0)
        return
      }
      lastKeyRef.current = topSequenceKey
      lastKeyTimer.current = setTimeout(() => { lastKeyRef.current = null }, 400)
      return
    }
    lastKeyRef.current = null

    // G → bottom
    if (matchesAction('cursor.bottom', input, key)) {
      if (items.length > 0) {
        const last = items.length - 1
        setCursor(last); setScrollOffset(Math.max(0, last - visibleHeight + 1))
      }
      return
    }

    if (matchesAction('workflow.logs', input, key)) {
      openLogs()
      return
    }

    if (matchesAction('workflow.rerun', input, key)) {
      if (items[cursor]) setDialog('rerun')
      return
    }

    if (matchesAction('workflow.cancel', input, key)) {
      if (items[cursor]) setDialog('cancel')
      return
    }
  })

  const visibleRuns = items.slice(scrollOffset, scrollOffset + visibleHeight)

  if (dialog === 'logs') {
    if (logLoading) {
      return (
        <Box flexDirection="column" flexGrow={1} paddingX={1}>
          <Box gap={1}><Spinner /><Text color={t.ui.muted}>Loading logs…</Text></Box>
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

  if (dialog === 'rerun' && items[cursor]) {
    const run = items[cursor]
    return (
      <Box flexDirection="column" flexGrow={1}>
        <ConfirmDialog
          message={`Re-run failed jobs: ${sanitize(run.workflowName)} on ${sanitize(run.headBranch)}?`}
          onConfirm={() => {
            setDialog(null)
            runWrite('Re-running', () => rerunRun(repo, run.databaseId))
              .then(ran => { if (ran) { showStatus('Re-run triggered'); refetch() } })
              .catch(err => showStatus(`Failed: ${err.message}`, true))
          }}
          onCancel={() => setDialog(null)}
        />
      </Box>
    )
  }

  if (dialog === 'cancel' && items[cursor]) {
    const run = items[cursor]
    return (
      <Box flexDirection="column" flexGrow={1}>
        <ConfirmDialog
          message={`Cancel run: ${sanitize(run.workflowName)} on ${sanitize(run.headBranch)}?`}
          destructive={true}
          onConfirm={async () => {
            setDialog(null)
            try {
              if (!await runWrite('Cancelling', () => cancelRun(repo, run.databaseId))) return
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
      <Box paddingX={1} gap={1}>
        {branchFilter
          ? <><Text color={t.ui.dim}>branch:</Text><Text color={t.ci.pending} bold>{sanitize(branchFilter)}</Text><Text color={t.ui.dim}>{`  [${firstActionKey('workflow.clear-filter', 'F')}] clear filter`}</Text></>
          : <Text color={t.ui.dim}>all branches</Text>
        }
        {statusMsg && (
          <Text color={statusMsg.isError ? t.ci.fail : t.ci.pass}>
            {statusMsg.msg}{statusMsg.persist ? '  [any key to dismiss]' : ''}
          </Text>
        )}
      </Box>
      <Box flexDirection="column" flexGrow={1}>
        {loading && items.length === 0 && (
          <ActionListSkeleton count={visibleHeight} />
        )}
        {visibleRuns.map((run, i) => {
          const idx = scrollOffset + i
          const isSelected = idx === cursor

          return (
            <ActionRow
              key={run.databaseId}
              run={run}
              isSelected={isSelected}
              t={t}
            />
          )
        })}
        {error && (
          <Box paddingX={2} paddingY={1} flexDirection="column">
            <FailureNotice failure={classifyGhFailure(error)} />
            <Text color={t.ui.dim}>[{firstActionKey('list.refresh', 'r')}] retry</Text>
          </Box>
        )}
        {!loading && !error && items.length === 0 && (
          <Box paddingX={2} paddingY={1}>
            <Text color={t.ui.muted}>No workflow runs found{branchFilter ? ` for branch "${sanitize(branchFilter)}"` : ''}. [{firstActionKey('list.refresh', 'r')}] refresh{branchFilter ? `  [${firstActionKey('workflow.clear-filter', 'F')}] clear filter` : ''}</Text>
          </Box>
        )}
      </Box>
    </Box>
  )
}
