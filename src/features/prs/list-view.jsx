// @ts-check

/** PR list chrome, visible rows and popover placement; dialog state stays in PRList. */

import React from 'react'
import { Box, Text } from 'ink'
import { PRListSkeleton } from '../../components/Skeleton.jsx'
import { FailureNotice } from '../../components/FailureNotice.jsx'
import { EmptyState } from '../../components/EmptyState.jsx'
import { classifyGhFailure } from '../../executor.js'
import { sanitize, sanitizeRaw } from '../../utils.js'
import { firstActionKey } from '../../config/actions.js'
import { Popover } from '../../ui/Popover.jsx'
import {
  PRDetailPopoverContentMemo,
  PRRow,
  PR_ROW_FIXED_COLS,
  previewPanelLayout,
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
  searchText,
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
  paging,
  previewWidth,
}) {
  // The preview is a side panel: it takes the right-hand columns and the rows are narrowed
  // to the rest, so it never covers a PR. A pane too narrow for both shows rows only.
  const listWidth = innerWidth || termCols - 2
  const { width: panelWidth, fits: panelFits } = previewPanelLayout({ listWidth, termRows, previewWidth })
  const popoverVisible = !!selectedPR && !dialog && !popoverDismissed && panelFits
  const titleWidth = innerWidth ? innerWidth - PR_ROW_FIXED_COLS - (popoverVisible ? panelWidth : 0) : undefined
  const popoverAnchor = { x: listWidth - panelWidth, y: 1, width: 0, height: 1 }

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
        {searchText && (
          <>
            <Text color={t.ui.dim}>·</Text>
            <Text color={t.ci.pending} wrap="truncate">/ {sanitize(searchText)}</Text>
            <Text color={t.ui.dim}> [/] change</Text>
          </>
        )}
        {loading && items.length > 0 && <Text color={t.ui.dim}>⟳</Text>}
        {statusMsg
          ? <Text color={statusMsg.isError ? t.ci.fail : t.ci.pass}>{sanitizeRaw(statusMsg.msg)}{statusMsg.persist ? ' [any key]' : ''}</Text>
          : !popoverVisible && selectedPR && !dialog
            // The preview panel is not showing: keep the focused PR's full title readable here.
            ? <Text color={t.ui.muted} wrap="truncate">#{selectedPR.number} {sanitize(selectedPR.title)}</Text>
            : <Text color={t.ui.dim} wrap="truncate">
              {termCols >= 100 ? `[${filterKeys.filterOpen}]open [${filterKeys.filterClosed}]closed [${filterKeys.filterMerged}]merged ` : ''}[s]scope [@]author
            </Text>
        }
        {panelFits && <Text color={t.ui.dim}> [{firstActionKey('pr.preview', 'p')}]review</Text>}
      </Box>

      {error && (
        <Box paddingX={2} paddingY={1} flexDirection="column">
          <FailureNotice failure={classifyGhFailure(error)} />
          <Text color={t.ui.dim}>[{firstActionKey('list.refresh', 'r')}] retry</Text>
        </Box>
      )}

      {!loading && !error && items.length === 0 && (
        <EmptyState
          title={`No ${[...filterStates].join('/')} pull requests${scope === 'own' ? ' by you' : scope === 'reviewing' ? ' assigned for your review' : ''}.`}
          actions={[
            ...(scope === 'own' ? [{ key: firstActionKey('pr.scope-cycle', 's'), label: 'show all open PRs' }] : [{ key: firstActionKey('pr.filter-cycle', 'f'), label: 'change the open/closed/merged filter' }, { key: firstActionKey('pr.scope-cycle', 's'), label: 'change scope' }]),
            { key: firstActionKey('list.refresh', 'r'), label: 'refresh' },
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
            titleWidth={titleWidth}
            expanded={expansionEnabled && idx === cursor}
          />
        )
      })}

      {!error && items.length > 0 && (
        <Box paddingX={1} justifyContent="space-between">
          <Text color={paging?.error ? t.ci.fail : t.ui.dim}>
            {paging?.error
              ? `Could not load more PRs; showing ${items.length}${paging.total ? ` of ${paging.total}` : ''} [${firstActionKey('list.refresh', 'r')}] retry`
              : paging?.hasMore
                ? (paging.total != null ? `${items.length} of ${paging.total}` : `${items.length} loaded`) + (paging.loadingMore ? ' · loading more…' : '')
                : paging?.capped
                  ? `${items.length}${paging.total != null ? ` of ${paging.total}` : ' loaded'} (GitHub search returns at most ${paging.cap}; refine the ${paging.search ? 'search' : 'filter'} to reach older PRs)`
                  : `${items.length} of ${items.length} · end of list`}
          </Text>
          {items.length > effectiveHeight && (
            <Text color={t.ui.dim}>{scrollOffset + 1}–{Math.min(scrollOffset + effectiveHeight, items.length)}</Text>
          )}
        </Box>
      )}

      {popoverVisible && (
        <Popover
          anchor={popoverAnchor}
          popoverWidth={panelWidth}
          popoverHeight={POPOVER_HEIGHT}
          termCols={termCols}
          termRows={termRows}
          preferredSide="right"
          onClose={() => setPopoverDismissed(true)}
        >
          <PRDetailPopoverContentMemo
            pr={selectedPR}
            t={t}
            width={panelWidth}
          />
        </Popover>
      )}
    </Box>
  )
}
