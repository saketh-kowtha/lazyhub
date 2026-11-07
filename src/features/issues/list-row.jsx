/**
 * Issue list row presentation and age/state badges.
 */

import React, { memo } from 'react'
import { Box, Text } from 'ink'
import { format } from 'timeago.js'
import { sanitize, formatLogin } from '../../utils.js'
import { fitCell, cellWidth, planRow } from '../../ui/row-layout.js'

// Colour budget (#566): the state is the glyph (● open, ○ closed) and the focused row takes the one
// accent; everything else is muted. Labels are muted unless the row is focused.
function IssueStateBadge({ issue, t, isSelected }) {
  const quiet = isSelected ? t.ui.selected : t.ui.muted
  switch (issue.state) {
    case 'OPEN':   return <Text color={isSelected ? t.ui.selected : undefined}>●</Text>
    case 'CLOSED': return <Text color={quiet}>○</Text>
    default:       return <Text color={quiet}>●</Text>
  }
}

const NUM_COLS = 6
const AUTHOR_COLS = 12
const AGE_COLS = 13

export const IssueRow = memo(({ issue, isSelected, t, width = 78 }) => {
  const authorLogin   = fitCell(formatLogin(sanitize(issue.author?.login), AUTHOR_COLS), AUTHOR_COLS)
  const visibleLabels = (issue.labels || []).slice(0, 2).map(l => ({ color: l.color, text: `[${sanitize(l.name).slice(0, 14)}]` }))
  const extraLabels   = (issue.labels || []).length - 2
  const labelText     = visibleLabels.map(l => l.text).join(' ') + (extraLabels > 0 ? ` +${extraLabels}` : '')
  const quiet         = isSelected ? t.ui.selected : t.ui.muted
  // One line, never wider than the pane (#429): the number keeps its columns, the title takes
  // the rest, and labels, then author, then age are dropped when the pane is narrow.
  const labelCols = labelText ? cellWidth(labelText) + 1 : 0
  const { titleWidth, show } = planRow(width, {
    fixed: 2 + 1 + 2 + NUM_COLS,
    optional: [{ key: 'labels', width: labelCols }, { key: 'author', width: AUTHOR_COLS + 1 }, { key: 'age', width: AGE_COLS + 1 }],
  })

  return (
    <Box paddingX={1} height={1} backgroundColor={isSelected ? t.ui.headerBg : undefined}>
      <Text color={isSelected ? t.ui.selected : undefined}>{isSelected ? '▎' : ' '}</Text>
      <IssueStateBadge issue={issue} t={t} isSelected={isSelected} />
      <Text> </Text>
      <Text color={quiet} bold>{fitCell(`#${issue.number}`, NUM_COLS)}</Text>
      <Text color={isSelected ? t.ui.selected : undefined} bold={isSelected}>{fitCell(sanitize(issue.title), titleWidth)}</Text>
      {show.labels && labelCols > 0 && visibleLabels.map(l => (
        <React.Fragment key={l.text}><Text color={quiet}> {l.text}</Text></React.Fragment>
      ))}
      {show.labels && extraLabels > 0 && <Text color={quiet}> +{extraLabels}</Text>}
      {show.author && <Text color={quiet}> {authorLogin}</Text>}
      {show.age && <Text color={quiet}> {fitCell(format(issue.updatedAt), AGE_COLS)}</Text>}
    </Box>
  )
})
