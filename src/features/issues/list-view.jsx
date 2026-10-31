/**
 * Issue list presentation: filter/status line, visible rows and loading/failure states.
 */

import React from 'react'
import { Box, Text } from 'ink'
import { classifyGhFailure } from '../../executor.js'
import { firstActionKey } from '../../config/actions.js'
import { IssueListSkeleton } from '../../components/Skeleton.jsx'
import { FailureNotice } from '../../components/FailureNotice.jsx'
import { EmptyState } from '../../components/EmptyState.jsx'
import { IssueRow } from './list-row.jsx'

export function IssueListView({ items, loading, error, filterState, sortMode, statusMsg, filterKeys: FK, actions, t, visibleHeight, visibleIssues, scrollOffset, cursor, paging }) {
  return (
    <Box flexDirection="column" flexGrow={1}>
      <Box paddingX={1} gap={1}>
        <Text color={t.ui.dim}>filter:</Text>
        <Text color={filterState === 'open' ? t.issue.open : t.issue.closed} bold>{filterState}</Text>
        {sortMode === 'oldest' && (
          <Text color={t.ci.pending} bold>↑ oldest</Text>
        )}
        <Text color={t.ui.dim}>  [{FK.filterOpen}] open  [{FK.filterClosed}] closed  [s] sort  [n] new</Text>
        {statusMsg && (
          <Text color={statusMsg.isError ? t.ci.fail : t.ci.pass}> {statusMsg.msg}{statusMsg.persist ? ' [any key]' : ''}</Text>
        )}
      </Box>
      <Box flexDirection="column" flexGrow={1}>
        {loading && items.length === 0 && (
          <IssueListSkeleton count={visibleHeight} />
        )}
        {loading && items.length > 0 && (
          <Box paddingX={1}><Text color={t.ui.muted}>refreshing…</Text></Box>
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
        {!error && items.length > 0 && paging && (
          <Box paddingX={1}>
            <Text color={paging.error ? t.ci.fail : t.ui.dim}>
              {paging.error
                ? `Could not load more issues; showing ${items.length}${paging.total ? ` of ${paging.total}` : ''} [${firstActionKey('list.refresh', 'r', actions)}] retry`
                : paging.hasMore
                  ? `${items.length} of ${paging.total ?? '?'}${paging.loadingMore ? ' · loading more…' : ''}`
                  : paging.total > items.length
                    ? `${items.length} of ${paging.total} (GitHub search returns at most ${paging.cap})`
                    : `${items.length} of ${items.length} · end of list`}
            </Text>
          </Box>
        )}
        {error && (
          <Box paddingX={2} paddingY={1} flexDirection="column">
            <FailureNotice failure={classifyGhFailure(error)} />
            <Text color={t.ui.dim}>[{firstActionKey('list.refresh', 'r', actions)}] retry</Text>
          </Box>
        )}
        {!loading && !error && items.length === 0 && (
          <EmptyState
            title={`No ${filterState} issues found.`}
            actions={[{ key: firstActionKey('issue.filter-cycle', 'f', actions), label: 'cycle the open/closed filter' }, { key: firstActionKey('issue.new', 'n', actions), label: 'new issue' }, { key: firstActionKey('list.refresh', 'r', actions), label: 'refresh' }]}
          />
        )}
      </Box>
    </Box>
  )
}
