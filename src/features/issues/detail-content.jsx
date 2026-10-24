/**
 * Build the issue detail's scrollable labels, description and comment rows.
 */

import React from 'react'
import { Box, Text } from 'ink'
import { format } from 'timeago.js'
import { sanitize, getMarkdownRows } from '../../utils.js'

export function buildIssueContentRows(issue, termCols, t) {
  if (!issue) return []
  const rows = []

  // Labels
  if (issue.labels?.length > 0) {
    rows.push({ id: 'labels', el: (
      <Box key="labels" marginBottom={1} gap={1}>
        {issue.labels.map(l => (
          <Box key={l.name} paddingX={1} borderStyle="round" borderColor={`#${l.color}`}>
            <Text color={`#${l.color}`}>{sanitize(l.name)}</Text>
          </Box>
        ))}
      </Box>
    )})
  }

  // Body
  if (issue.body) {
    rows.push({ id: 'body-hdr', el: <Text color={t.ui.muted} bold>Description:</Text> })
    const mdRows = getMarkdownRows(issue.body.split('\n').map(sanitize).join('\n'), termCols - 4, t)
    mdRows.forEach((row, i) => rows.push({ id: `body-${i}`, el: row }))
  }

  // Comments
  if (issue.comments?.length > 0) {
    rows.push({ id: 'cmt-hdr', el: (
      <Box key="cmt-hdr" marginTop={1}>
        <Text color={t.ui.muted} bold>Comments ({issue.comments.length}):</Text>
      </Box>
    )})
    issue.comments.forEach((c, i) => {
      rows.push({ id: `cmt-${i}`, el: (
        <Box key={`cmt-${i}`} flexDirection="column" paddingX={1} marginBottom={1}>
          <Box gap={1}>
            <Text color={t.ui.selected}>{sanitize(c.author?.login)}</Text>
            <Text color={t.ui.dim}>{format(c.updatedAt || c.createdAt)}</Text>
          </Box>
          <Text color={t.diff.ctxFg}>{sanitize(c.body)}</Text>
        </Box>
      )})
    })
  }
  return rows
}
