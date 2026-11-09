/**
 * Issue list presentation: filter/status line, visible rows and loading/failure states.
 */

import React from 'react'
import { Box, Text } from 'ink'
import { firstActionKey } from '../../config/actions.js'
import { IssueListSkeleton } from '../../components/Skeleton.jsx'
import { QueryBoundary } from '../../components/QueryBoundary.jsx'
import { EmptyState } from '../../components/EmptyState.jsx'
import { IssueRow } from './list-row.jsx'
import { sanitizeRaw } from '../../utils.js'

export function IssueListView({ items, query, filterState, sortMode, statusMsg, filterKeys: FK, actions, t, visibleHeight, list, paging, width }) {
  return (
    <Box flexDirection="column" flexGrow={1}>
      <Box paddingX={1} height={1}>
        <Text wrap="truncate">
          <Text color={t.ui.dim}>filter: </Text>
          <Text color={filterState === 'open' ? t.issue.open : t.issue.closed} bold>{filterState}</Text>
          {sortMode === 'oldest' && <Text color={t.ci.pending} bold> ↑ oldest</Text>}
          <Text color={t.ui.dim}>  [{FK.filterOpen}] open  [{FK.filterClosed}] closed  [s] sort  [n] new</Text>
          {statusMsg && (
            <Text color={statusMsg.isError ? t.ci.fail : t.ci.pass}> {sanitizeRaw(statusMsg.msg)}{statusMsg.persist ? ' [any key]' : ''}</Text>
          )}
        </Text>
      </Box>
      <Box flexDirection="column" flexGrow={1}>
        <QueryBoundary
          query={query}
          skeleton={<IssueListSkeleton count={visibleHeight} />}
          empty={(
            <EmptyState
              title={`No ${filterState} issues found.`}
              actions={[{ key: firstActionKey('issue.filter-cycle', 'f', actions), label: 'cycle the open/closed filter' }, { key: firstActionKey('issue.new', 'n', actions), label: 'new issue' }, { key: firstActionKey('list.refresh', 'r', actions), label: 'refresh' }]}
            />
          )}
          footer={paging && (
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
        >
          {() => list.visibleItems.map((issue, i) => (
            <IssueRow
              key={issue.number}
              issue={issue}
              isSelected={list.scrollOffset + i === list.cursor}
              t={t}
              width={width}
            />
          ))}
        </QueryBoundary>
      </Box>
    </Box>
  )
}
