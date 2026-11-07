/**
 * Issue list row presentation and age/state badges.
 */

import React, { memo } from 'react'
import { Box, Text } from 'ink'
import { format } from 'timeago.js'
import { sanitize, safeHex, formatLogin } from '../../utils.js'
import { fitCell, cellWidth, planRow } from '../../ui/row-layout.js'

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

const NUM_COLS = 6
const AUTHOR_COLS = 12
const AGE_COLS = 13

export const IssueRow = memo(({ issue, isSelected, t, width = 78 }) => {
  const authorLogin   = fitCell(formatLogin(sanitize(issue.author?.login), AUTHOR_COLS), AUTHOR_COLS)
  const visibleLabels = (issue.labels || []).slice(0, 2).map(l => ({ color: safeHex(l.color), text: `[${sanitize(l.name).slice(0, 14)}]` }))
  const extraLabels   = (issue.labels || []).length - 2
  const labelText     = visibleLabels.map(l => l.text).join(' ') + (extraLabels > 0 ? ` +${extraLabels}` : '')
  const timeColor     = ageColor(issue.updatedAt, t)
  // One line, never wider than the pane (#429): the number keeps its columns, the title takes
  // the rest, and labels, then author, then age are dropped when the pane is narrow.
  const labelCols = labelText ? cellWidth(labelText) + 1 : 0
  const { titleWidth, show } = planRow(width, {
    fixed: 2 + 2 + NUM_COLS,
    optional: [{ key: 'labels', width: labelCols }, { key: 'author', width: AUTHOR_COLS + 1 }, { key: 'age', width: AGE_COLS + 1 }],
  })

  return (
    <Box paddingX={1} height={1} backgroundColor={isSelected ? t.ui.headerBg : undefined}>
      <IssueStateBadge issue={issue} t={t} />
      <Text> </Text>
      <Text color={t.ui.dim} bold>{fitCell(`#${issue.number}`, NUM_COLS)}</Text>
      <Text color={isSelected ? t.ui.selected : undefined}>{fitCell(sanitize(issue.title), titleWidth)}</Text>
      {show.labels && labelCols > 0 && visibleLabels.map(l => (
        <React.Fragment key={l.text}><Text color={l.color}> {l.text}</Text></React.Fragment>
      ))}
      {show.labels && extraLabels > 0 && <Text color={t.ui.muted}> +{extraLabels}</Text>}
      {show.author && <Text color={t.ui.muted}> {authorLogin}</Text>}
      {show.age && <Text color={timeColor}> {fitCell(format(issue.updatedAt), AGE_COLS)}</Text>}
    </Box>
  )
})
