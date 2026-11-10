/**
 * Issue detail presentation: header, timeline window, compose box and status (#565).
 */

import React from 'react'
import { Box, Text } from 'ink'
import { format } from 'timeago.js'
import { sanitize, sanitizeRaw, TextInput } from '../../utils.js'

export function IssueDetailView({
  issue, t, visibleRows, cursorEntry, maxScroll, scrollY, visibleHeight, rowCount,
  loadedCount, totalCount, conversationLoading, conversationError, fetching = false, refreshFailed = false, refreshKey = 'r', loadingMore, moreFailed, incomplete,
  newCount, showNewKey, compose, replyText, setReplyText, submitCompose, confirmDelete, statusMsg, statusIsError = false,
}) {
  const stateColor = issue.state === 'OPEN' ? t.issue.open : t.issue.closed
  const editing = compose?.type === 'edit'

  return (
    <Box flexDirection="column" flexGrow={1} paddingX={1}>
      <Box flexDirection="column" borderStyle="single" borderColor={t.ui.border} paddingX={1}
        borderTop={false} borderLeft={false} borderRight={false} borderBottom={true}>
        <Box gap={1}>
          <Text color={stateColor}>{issue.state === 'OPEN' ? '●' : '✗'}</Text>
          <Text bold color={t.ui.selected} wrap="truncate">#{issue.number} {sanitize(issue.title)}</Text>
          {/* Reserved cell: background activity never shifts the layout. */}
          <Text color={t.ui.dim}>{fetching ? '⟳' : ' '}</Text>
        </Box>
        <Box gap={2}>
          <Text color={t.ui.muted}>by {sanitize(issue.author?.login)}</Text>
          <Text color={t.ui.dim}>{format(issue.updatedAt)}</Text>
          {issue.assignees?.length > 0 && (
            <Box gap={1}>
              {issue.assignees.map(a => (
                <Box key={a.login}>
                  <Text color={t.ui.muted}>@{sanitize(a.login)}</Text>
                </Box>
              ))}
            </Box>
          )}
          {issue.milestone?.title && (
            <Text color={t.ui.dim}>⚑ {sanitize(issue.milestone.title)}</Text>
          )}
        </Box>
      </Box>

      {/* ── Scrollable timeline ── */}
      <Box flexDirection="column" flexGrow={1} overflow="hidden">
        {visibleRows.map(row => (
          <Box key={row.id}>
            <Text color={t.ui.selected}>{row.entry === cursorEntry ? '▎' : ' '}</Text>
            {row.el}
          </Box>
        ))}
        {conversationLoading && <Text color={t.ui.muted}>  Loading conversation…</Text>}
        {conversationError && <Text color={t.ci.fail}>  Could not load the conversation: {sanitizeRaw(conversationError)}</Text>}
      </Box>

      {/* ── Counts and scroll info ── */}
      {(maxScroll > 0 || totalCount > 0) && (
        <Box paddingX={1} gap={2}>
          {totalCount > 0 && (
            <Text color={t.ui.dim}>
              {`${loadedCount} of ${totalCount} timeline items`}
              {incomplete ? '  (incomplete: GitHub repeated a page cursor)' : ''}
              {loadingMore ? '  (loading more…)' : ''}
              {moreFailed ? '  (load failed, r to retry)' : ''}
            </Text>
          )}
          {maxScroll > 0 && <Text color={t.ui.dim}>{scrollY + 1}–{Math.min(scrollY + visibleHeight, rowCount)} / {rowCount}</Text>}
        </Box>
      )}

      {/* Outside the scrolling rows, so a new comment never moves what is being read. */}
      {newCount > 0 && (
        <Box paddingX={1}>
          <Text color={t.ci.pending} bold>{`↓ ${newCount} new comment${newCount === 1 ? '' : 's'}  [${showNewKey}] show`}</Text>
        </Box>
      )}

      {confirmDelete && (
        <Box flexDirection="column" borderStyle="round" borderColor={t.ci.fail} paddingX={1} marginBottom={1}>
          <Text color={t.ci.fail} bold>Delete your comment?</Text>
          <Text color={t.ui.dim} wrap="truncate">  "{sanitize(String(confirmDelete.body || '').split('\n')[0]).slice(0, 60)}"</Text>
          <Text color={t.ui.dim}>[y] delete  [n / Esc / Enter] keep it</Text>
        </Box>
      )}

      {compose && (
        <Box flexDirection="column" borderStyle="round" borderColor={t.ui.selected} paddingX={1} marginBottom={1}>
          <Text color={t.ui.muted} bold>{editing ? 'Edit comment:' : 'Reply:'}</Text>
          <TextInput
            value={replyText}
            onChange={setReplyText}
            focus={true}
            onEnter={submitCompose}
          />
          <Text color={t.ui.dim}>[Enter] send  [Ctrl+E] open editor  [Esc] cancel</Text>
        </Box>
      )}

      {refreshFailed && !statusMsg && <Text color={t.ci.fail}>{`⚠ Could not refresh, showing the last loaded data  [${refreshKey}] retry`}</Text>}
      {statusMsg && <Text color={statusIsError ? t.ci.fail : t.ci.pass}>{sanitizeRaw(statusMsg)}</Text>}
    </Box>
  )
}
