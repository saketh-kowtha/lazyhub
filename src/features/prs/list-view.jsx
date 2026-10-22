// @ts-check

import React from 'react'
import { Box, Text } from 'ink'
import { PRListSkeleton } from '../../components/Skeleton.jsx'
import { FailureNotice } from '../../components/FailureNotice.jsx'
import { EmptyState } from '../../components/EmptyState.jsx'
import { classifyGhFailure } from '../../executor.js'
import { Popover, calcPopoverPosition } from '../../ui/Popover.jsx'
import {
  PRDetailPopoverContentMemo,
  PRRow,
  PR_ROW_FIXED_COLS,
  POPOVER_WIDTH,
  POPOVER_HEIGHT,
} from './list-row.jsx'

export function PRListView({
  items,
  loading,
  error,
  filterStates,
  scope,
  sortMode,
  authorFilter,
  statusMsg,
  config,
  filterKeys,
  t,
  height,
  effectiveHeight,
  visiblePRs,
  scrollOffset,
  cursor,
  innerWidth,
  termCols,
  termRows,
  selectedPR,
  dialog,
  popoverDismissed,
  setPopoverDismissed,
  expansionEnabled,
  scheme,
}) {
  const popoverRowIndex = cursor - scrollOffset
  const popoverAnchor = {
    x: 1,
    y: 1 + popoverRowIndex,
    width: innerWidth ? innerWidth - 2 : termCols - 2,
    height: 1,
  }
  const effectivePopoverWidth = Math.min(POPOVER_WIDTH, termCols - 4)
  // Rows the popover floats over (list-relative y = 1 + row index).  Their titles
  // are blanked so no orphan fragments show to the popover's right.
  const popoverVisible = !!selectedPR && !dialog && !popoverDismissed
  const popoverTop = popoverVisible
    ? calcPopoverPosition({
        anchor: popoverAnchor,
        popoverWidth: effectivePopoverWidth,
        popoverHeight: POPOVER_HEIGHT,
        termCols,
        termRows,
        preferredSide: 'right',
      }).top
    : 0
  const isCovered = (rowIndex) =>
    popoverVisible && rowIndex !== popoverRowIndex &&
    1 + rowIndex >= popoverTop && 1 + rowIndex < popoverTop + POPOVER_HEIGHT

  return (
    <Box flexDirection="column" flexGrow={1}>
      <Box paddingX={1} gap={1} overflow="hidden">
        <Box gap={0} flexShrink={0}>
          {[['open', t.pr.open], ['closed', t.pr.closed], ['merged', t.pr.merged]].map(([state, color], i) => (
            <React.Fragment key={state}>
              {i > 0 && <Text color={t.ui.dim}>/</Text>}
              <Text color={filterStates.has(state) ? color : t.ui.dim} bold={filterStates.has(state)}>{state}</Text>
            </React.Fragment>
          ))}
        </Box>
        <Box flexShrink={0}><Text color={t.ui.dim}>·</Text></Box>
        <Box flexShrink={0}>
          <Text color={sortMode === 'oldest' ? t.ci.pending : scope === 'own' ? t.ui.selected : scope === 'reviewing' ? t.ci.pending : t.ui.muted} bold>
            {sortMode === 'oldest' ? '↑ oldest' : scope === 'own' ? 'mine' : scope === 'reviewing' ? 'reviewing' : 'all'}
          </Text>
        </Box>
        {authorFilter && (
          <>
            <Text color={t.ui.dim}>·</Text>
            <Text color={t.ci.pending}>@{authorFilter}</Text>
            <Text color={t.ui.dim}> [@] change</Text>
          </>
        )}
        {loading && items.length > 0 && <Text color={t.ui.dim}>⟳</Text>}
        {statusMsg
          ? <Text color={statusMsg.isError ? t.ci.fail : t.ci.pass}>{statusMsg.msg}{statusMsg.persist ? ' [any key]' : ''}</Text>
          : <Text color={t.ui.dim} wrap="truncate">
              {termCols >= 100 ? `[${filterKeys.filterOpen}]open [${filterKeys.filterClosed}]closed [${filterKeys.filterMerged}]merged ` : ''}[s]scope [@]author
            </Text>
        }
        {items.length >= config.pageSize && <Text color={t.ui.dim}> ({items.length})</Text>}
      </Box>

      {error && (
        <Box paddingX={2} paddingY={1} flexDirection="column">
          <FailureNotice failure={classifyGhFailure(error)} />
          <Text color={t.ui.dim}>[r] retry</Text>
        </Box>
      )}

      {!loading && !error && items.length === 0 && (
        <EmptyState
          title={`No ${[...filterStates].join('/')} pull requests${scope === 'own' ? ' by you' : scope === 'reviewing' ? ' assigned for your review' : ''}.`}
          actions={[
            ...(scope === 'own' ? [{ key: 's', label: 'show all open PRs' }] : [{ key: 'f', label: 'change the open/closed/merged filter' }, { key: 's', label: 'change scope' }]),
            { key: 'r', label: 'refresh' },
          ]}
        />
      )}

      {loading && items.length === 0 && <PRListSkeleton count={height} />}

      {visiblePRs.map((pr, i) => {
        const idx = scrollOffset + i
        return (
          <PRRow
            key={`${pr.number}`}
            pr={pr}
            isSelected={idx === cursor}
            t={t}
            titleWidth={innerWidth ? innerWidth - PR_ROW_FIXED_COLS : undefined}
            expanded={expansionEnabled && idx === cursor}
            maskTitle={isCovered(i)}
          />
        )
      })}

      {(items.length > effectiveHeight || items.length >= 100) && (
        <Box paddingX={1} justifyContent="space-between">
          <Text color={t.ui.dim}>
            {scrollOffset + 1}–{Math.min(scrollOffset + effectiveHeight, items.length)} / {items.length}
          </Text>
          {items.length >= 100 && !loading && <Text color={t.ui.dim}>scroll down for more</Text>}
        </Box>
      )}

      {popoverVisible && (
        <Popover
          anchor={popoverAnchor}
          popoverWidth={effectivePopoverWidth}
          popoverHeight={POPOVER_HEIGHT}
          termCols={termCols}
          termRows={termRows}
          preferredSide="right"
          onClose={() => setPopoverDismissed(true)}
        >
          <PRDetailPopoverContentMemo
            pr={selectedPR}
            t={t}
            scheme={scheme}
            width={effectivePopoverWidth}
          />
        </Popover>
      )}
    </Box>
  )
}
