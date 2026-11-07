/**
 * Issue detail presentation: header, scrollable rows, reply form and footer.
 */

import React from 'react'
import { Box, Text } from 'ink'
import { format } from 'timeago.js'
import { sanitize, TextInput } from '../../utils.js'

export function IssueDetailView({ issue, t, visibleRows, maxScroll, scrollY, visibleHeight, contentRows, replyMode, replyText, setReplyText, doReply, statusMsg, statusIsError = false }) {
  const stateColor = issue.state === 'OPEN' ? t.issue.open : t.issue.closed

  return (
    <Box flexDirection="column" flexGrow={1} paddingX={1}>
      <Box flexDirection="column" borderStyle="single" borderColor={t.ui.border} paddingX={1}
        borderTop={false} borderLeft={false} borderRight={false} borderBottom={true}>
        <Box gap={1}>
          <Text color={stateColor}>{issue.state === 'OPEN' ? '●' : '✗'}</Text>
          <Text bold color={t.ui.selected} wrap="truncate">#{issue.number} {sanitize(issue.title)}</Text>
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

      {/* ── Scrollable content ── */}
      <Box flexDirection="column" flexGrow={1} overflow="hidden">
        {visibleRows.map(row => <React.Fragment key={row.id}>{row.el}</React.Fragment>)}
      </Box>

      {/* ── Scroll info ── */}
      {maxScroll > 0 && (
        <Box paddingX={1} marginBottom={1}>
          <Text color={t.ui.dim}>{scrollY + 1}–{Math.min(scrollY + visibleHeight, contentRows.length)} / {contentRows.length}</Text>
        </Box>
      )}

      {replyMode && (
        <Box flexDirection="column" borderStyle="round" borderColor={t.ui.selected} paddingX={1} marginBottom={1}>
          <Text color={t.ui.muted} bold>Reply:</Text>
          <TextInput
            value={replyText}
            onChange={setReplyText}
            focus={true}
            onEnter={doReply}
          />
          <Text color={t.ui.dim}>[Enter] send  [Esc] cancel</Text>
        </Box>
      )}

      {statusMsg && <Text color={statusIsError ? t.ci.fail : t.ci.pass}>{statusMsg}</Text>}
    </Box>
  )
}
