/**
 * src/features/actions/index.jsx — Actions / workflow runs pane
 */

import React, { useState, useCallback, useEffect, memo } from 'react'
import { Box, Text, useStdout } from 'ink'
import { format } from 'timeago.js'
import { useKeymapInput } from '../../config/keymap.js'
import { useGh } from '../../hooks/useGh.js'
import { useListController } from '../../hooks/useListController.js'
import { useMutation } from '../../hooks/useMutation.js'
import { listRuns, getRunLogs, rerunRun, cancelRun } from '../../executor.js'
import { ConfirmDialog } from '../../components/dialogs/ConfirmDialog.jsx'
import { LogViewer } from '../../components/dialogs/LogViewer.jsx'
import { FuzzySearch } from '../../components/dialogs/FuzzySearch.jsx'
import { toLogLines, logTitle } from './log-lines.js'
import { loadFailureExcerpt } from '../prs/ci-log.js'
import { useKeyScope } from '../../keyscope.js'
import { useTheme } from '../../theme.js'
import { QueryBoundary } from '../../components/QueryBoundary.jsx'
import { MutationStatus } from '../../components/MutationStatus.jsx'
import { ListRow } from '../../ui/ListRow.jsx'
import { useMinuteClock } from '../../ui/clock.js'
import { Spinner } from '../../components/Spinner.jsx'
import { ActionListSkeleton } from '../../components/Skeleton.jsx'
import { firstActionKey, matchesAction } from '../../config/actions.js'
import { sanitize } from '../../utils.js'
import { fitCell, paneWidth, planRow } from '../../ui/row-layout.js'

// Colour budget (#566): the state is the glyph; only a failing or running run is coloured.
function StatusBadge({ run, isSelected }) {
  const { t } = useTheme()
  const status = run.status
  const conclusion = run.conclusion
  const quiet = isSelected ? t.ui.selected : t.ui.muted
  if (conclusion === 'success') return <Text color={quiet}>✓</Text>
  if (conclusion === 'failure' || conclusion === 'timed_out') return <Text color={t.ci.fail} bold>✗</Text>
  if (status === 'in_progress' || status === 'queued') return <Text color={t.ci.running}>●</Text>
  if (conclusion === 'cancelled') return <Text color={quiet}>⊘</Text>
  if (conclusion === 'skipped') return <Text color={quiet}>—</Text>
  return <Text color={quiet}>?</Text>
}

const BRANCH_COLS = 20
const AGE_COLS = 13

// One line, never wider than the pane (#430): the age, then the branch, are dropped when it is tight.
const ActionRow = memo(({ run, isSelected, width }) => {
  useMinuteClock()
  const { t } = useTheme()
  const { titleWidth, show } = planRow(width, {
    fixed: 2 + 1 + 2,
    optional: [{ key: 'age', width: AGE_COLS + 1 }, { key: 'branch', width: BRANCH_COLS + 1 }],
  })
  return (
    <ListRow selected={isSelected}>
      <StatusBadge run={run} isSelected={isSelected} />
      <Text> </Text>
      <Text color={isSelected ? t.ui.selected : undefined} bold={isSelected}>{fitCell(sanitize(run.workflowName), titleWidth)}</Text>
      {show.branch && <Text color={isSelected ? t.ui.selected : t.ui.muted}> {fitCell(sanitize(run.headBranch), BRANCH_COLS)}</Text>}
      {show.age && <Text color={isSelected ? t.ui.selected : t.ui.muted}> {fitCell(format(run.createdAt), AGE_COLS)}</Text>}
    </ListRow>
  )
})

export function ActionList({ repo, listHeight = 10, innerWidth, onPaneState, initialBranch = null }) {
  useKeyScope('pane')
  const { t } = useTheme()
  const { stdout } = useStdout()
  const rowWidth = paneWidth(innerWidth, stdout)
  const visibleHeight = listHeight || Math.max(5, (stdout?.rows || 24) - 8)

  const [branchFilter, setBranchFilter] = useState(initialBranch)
  const query = useGh(listRuns, [repo, branchFilter ? { branch: branchFilter } : {}])
  const { data: runs, loading, error, refetch, isStale } = query
  const [dialog, setDialog] = useState(null) // null | 'logs' | 'cancel' | 'rerun' | 'fuzzy'
  const [logLines, setLogLines] = useState([])
  const [logTitleText, setLogTitle] = useState('Log Viewer')
  const [logLoading, setLogLoading] = useState(false)
  const [logExcerpt, setLogExcerpt] = useState(null)

  const items = runs || []
  const list = useListController({ items, height: visibleHeight, getId: r => r.databaseId })

  useEffect(() => {
    if (onPaneState) onPaneState({ loading, error, count: items.length, isStale })
  }, [loading, error, items.length, isStale]) // eslint-disable-line react-hooks/exhaustive-deps

  useKeyScope('dialog', !!dialog)
  useEffect(() => {
    if (onPaneState) onPaneState({ dialogHint: dialog || null })
    return () => { if (onPaneState) onPaneState({ dialogHint: null }) }
  }, [dialog]) // eslint-disable-line react-hooks/exhaustive-deps

  // Pending guard, status line and refetch-after-write live in useMutation (#453).
  const rerun = useMutation((run) => rerunRun(repo, run.databaseId), { label: 'Re-running', success: 'Re-run triggered', invalidates: [() => refetch()] })
  const cancel = useMutation((run) => cancelRun(repo, run.databaseId), { label: 'Cancelling', success: 'Run cancelled', invalidates: [() => refetch()] })
  // One status line: whichever write spoke last.
  const status = cancel.status || rerun.status

  const openLogs = useCallback(async () => {
    const run = list.selected
    if (!run) return
    setLogTitle(logTitle(run))
    setLogLoading(true)
    setLogExcerpt(null)
    // A failed run opens on its failure excerpt (#463); every other run opens on the full log.
    const failed = /failure|timed_out/i.test(run.conclusion || '')
    setDialog(failed ? 'failed-logs' : 'logs')
    const excerptPromise = failed ? loadFailureExcerpt(repo, { runId: run.databaseId }) : Promise.resolve(null)
    try {
      const rawLogs = await getRunLogs(repo, run.databaseId)
      const lines = toLogLines(rawLogs)
      setLogLines(lines)
    } catch (err) {
      setLogLines([`Error loading logs: ${err.message}`])
    }
    setLogExcerpt(await excerptPromise.catch(() => ({ state: 'unavailable', detail: 'Could not fetch the failed-step log', excerpt: null })))
    setLogLoading(false)
  }, [list.selected, repo])

  useKeymapInput((input, key) => {
    if (status?.persist) { rerun.dismiss(); cancel.dismiss() }
    if (dialog) return
    if (list.handleKey(input, key)) return
    if (matchesAction('list.refresh', input, key)) { refetch(); return }
    if (matchesAction('list.search', input, key)) { if (items.length > 0) setDialog('fuzzy'); return }
    if (matchesAction('workflow.clear-filter', input, key) && branchFilter) { setBranchFilter(null); list.jumpTop(); return }

    if (matchesAction('workflow.logs', input, key)) {
      openLogs()
      return
    }

    if (matchesAction('workflow.rerun', input, key)) {
      if (list.selected) setDialog('rerun')
      return
    }

    if (matchesAction('workflow.cancel', input, key)) {
      if (list.selected) setDialog('cancel')
      return
    }
  })

  if (dialog === 'fuzzy') {
    return (
      <Box flexDirection="column" flexGrow={1}>
        <FuzzySearch
          items={items.map(run => ({ ...run, title: sanitize(`${run.workflowName || ''}  ${run.headBranch || ''}`) }))}
          searchFields={['title']}
          onSubmit={(item) => {
            const idx = items.findIndex(run => run.databaseId === item.databaseId)
            if (idx !== -1) list.moveTo(idx)
            setDialog(null)
          }}
          onCancel={() => setDialog(null)}
        />
      </Box>
    )
  }

  if (dialog === 'logs' || dialog === 'failed-logs') {
    if (logLoading) {
      return (
        <Box flexDirection="column" flexGrow={1} paddingX={1}>
          <Box gap={1}><Spinner /><Text color={t.ui.muted}>Loading logs…</Text></Box>
        </Box>
      )
    }
    return (
      <LogViewer
        title={logTitleText}
        lines={logLines}
        excerpt={dialog === 'failed-logs' ? logExcerpt : null}
        onClose={() => setDialog(null)}
      />
    )
  }

  if (dialog === 'rerun' && list.selected) {
    const run = list.selected
    return (
      <Box flexDirection="column" flexGrow={1}>
        <ConfirmDialog
          message={`Re-run failed jobs: ${sanitize(run.workflowName)} on ${sanitize(run.headBranch)}?`}
          onConfirm={() => {
            setDialog(null)
            rerun.mutate(run)
          }}
          onCancel={() => setDialog(null)}
        />
      </Box>
    )
  }

  if (dialog === 'cancel' && list.selected) {
    const run = list.selected
    return (
      <Box flexDirection="column" flexGrow={1}>
        <ConfirmDialog
          message={`Cancel run: ${sanitize(run.workflowName)} on ${sanitize(run.headBranch)}?`}
          destructive={true}
          onConfirm={() => {
            setDialog(null)
            cancel.mutate(run)
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
      </Box>
      <MutationStatus status={status} />
      <Box flexDirection="column" flexGrow={1}>
        <QueryBoundary
          query={query}
          skeleton={<ActionListSkeleton count={visibleHeight} />}
          empty={(
            <Box paddingX={2} paddingY={1}>
              <Text color={t.ui.muted}>No workflow runs found{branchFilter ? ` for branch "${sanitize(branchFilter)}"` : ''}. [{firstActionKey('list.refresh', 'r')}] refresh{branchFilter ? `  [${firstActionKey('workflow.clear-filter', 'F')}] clear filter` : ''}</Text>
            </Box>
          )}
        >
          {() => list.visibleItems.map((run, i) => (
            <ActionRow
              key={run.databaseId}
              run={run}
              isSelected={list.scrollOffset + i === list.cursor}
              width={rowWidth}
            />
          ))}
        </QueryBoundary>
      </Box>
    </Box>
  )
}
