/**
 * Issue detail presentation: header, scrollable rows, reply form and footer.
 */

import React from 'react'
import { Box, Text } from 'ink'
import { format } from 'timeago.js'
import { firstActionKey } from '../../config/actions.js'
import { sanitize, TextInput } from '../../utils.js'

export function IssueDetailView({ issue, t, visibleRows, maxScroll, scrollY, visibleHeight, contentRows, replyMode, replyText, setReplyText, doReply, statusMsg }) {
  const stateColor = issue.state === 'OPEN' ? t.issue.open : t.issue.closed

  return (
    <Box flexDirection="column" flexGrow={1} paddingX={1}>
      <Box marginBottom={1} flexDirection="column" borderStyle="single" borderColor={t.ui.border} paddingX={1}>
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
          <Text color={t.ui.dim}>{scrollY + 1}–{Math.min(scrollY + visibleHeight, contentRows.length)} / {contentRows.length}  [j/k] scroll  [gg/G] top/bottom</Text>
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

      {statusMsg && <Text color={t.ci.pass}>{statusMsg}</Text>}

      <Box paddingX={1} gap={2} borderStyle="single" borderTop={true} borderBottom={false} borderLeft={false} borderRight={false} borderColor={t.ui.border}>
        <Text color={t.ui.dim}>{`[${firstActionKey('issue.reply', 'c')}] reply  [${firstActionKey('issue.labels', 'l')}] labels  [${firstActionKey('issue.assignees', 'A')}] assignees  [Esc] back`}</Text>
      </Box>
    </Box>
  )
}
