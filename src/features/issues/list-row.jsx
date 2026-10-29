/**
 * Issue list row presentation and age/state badges.
 */

import React, { memo } from 'react'
import { Box, Text } from 'ink'
import { format } from 'timeago.js'
import { sanitize, formatLogin, padEndWidth } from '../../utils.js'

// ─── Age colour ───────────────────────────────────────────────────────────────

function ageColor(updatedAt, t) {
  if (!updatedAt) return t.ui.dim
  const days = (Date.now() - new Date(updatedAt).getTime()) / 86_400_000
  if (days < 3)  return t.ci.pass     // green  — fresh
  if (days < 7)  return undefined     // default — normal
  if (days < 14) return t.ci.pending  // yellow — getting stale
  return t.ci.fail                     // red    — stale
}

function IssueStateBadge({ issue, t }) {
  switch (issue.state) {
    case 'OPEN':   return <Text color={t.issue.open}>●</Text>
    case 'CLOSED': return <Text color={t.issue.closed}>●</Text>
    default:       return <Text color={t.ui.muted}>●</Text>
  }
}

export const IssueRow = memo(({ issue, isSelected, t }) => {
  const authorLogin   = padEndWidth(formatLogin(sanitize(issue.author?.login), 12), 12)
  const visibleLabels = (issue.labels || []).slice(0, 2)
  const extraLabels   = (issue.labels || []).length - 2
  const timeColor     = ageColor(issue.updatedAt, t)

  return (
    <Box paddingX={1} backgroundColor={isSelected ? t.ui.headerBg : undefined}>
      <IssueStateBadge issue={issue} t={t} />
      <Text> </Text>
      <Text color={t.ui.dim} bold>#{String(issue.number).padEnd(5)}</Text>
      <Text color={isSelected ? t.ui.selected : undefined} wrap="truncate" {...{ flexGrow: 1 }}>
        {sanitize(issue.title)}
      </Text>
      {visibleLabels.map(l => (
        <React.Fragment key={l.name}>
          <Text color={`#${l.color}`}> [{sanitize(l.name).slice(0, 14)}]</Text>
        </React.Fragment>
      ))}
      {extraLabels > 0 && (
        <Text color={t.ui.muted}> +{extraLabels}</Text>
      )}
      <Text color={t.ui.muted}> {authorLogin}</Text>
      <Text color={timeColor}> {format(issue.updatedAt)}</Text>
    </Box>
  )
})
