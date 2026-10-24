/**
 * PR detail title, state badge and branch summary.
 */
import React from 'react'
import { Box, Text } from 'ink'
import { format } from 'timeago.js'
import { useTheme } from '../../../theme.js'
import { sanitize } from '../../../utils.js'

/** @typedef {{number: number, title?: string, state?: string, isDraft?: boolean, mergeable?: string, author?: {login?: string}, updatedAt?: string | Date, baseRefName?: string, headRefName?: string, additions?: number, deletions?: number, changedFiles?: number}} PRDetailHeaderData */

/** @param {PRDetailHeaderData} pr @param {object} t */
function prStateBadge(pr, t) {
  if (pr.isDraft) return { icon: '⊘', color: t.pr.draft,   label: 'Draft'  }
  if (pr.state === 'OPEN' && pr.mergeable === 'CONFLICTING')
    return { icon: '●', color: t.pr.conflict || t.ci.pending, label: 'Conflict' }
  switch (pr.state) {
    case 'OPEN':   return { icon: '●', color: t.pr.open,   label: 'Open'   }
    case 'MERGED': return { icon: '●', color: t.pr.merged, label: 'Merged' }
    case 'CLOSED': return { icon: '●', color: t.pr.closed, label: 'Closed' }
    default:       return { icon: '●', color: t.ui.muted,  label: sanitize(pr.state) }
  }
}

/** @param {{pr: PRDetailHeaderData}} props */
export function PRDetailHeader({ pr }) {
  const { t } = useTheme()
  const badge = prStateBadge(pr, t)
  return (
    <Box flexDirection="column" paddingX={1} paddingY={0}
      borderStyle="single" borderColor={t.ui.border}
      borderTop={false} borderLeft={false} borderRight={false} borderBottom={true}>
      <Box gap={1}>
        <Text color={badge.color} bold>{badge.icon}</Text>
        <Text color={t.ui.dim}>#{pr.number}</Text>
        <Text bold color={t.ui.selected} wrap="truncate">{sanitize(pr.title)}</Text>
      </Box>
      <Box gap={1}>
        <Text color={t.ui.muted}>{sanitize(pr.author?.login)}</Text>
        <Text color={t.ui.dim}>·</Text>
        <Text color={t.ui.dim}>{format(pr.updatedAt)}</Text>
        <Text color={t.ui.dim}>·</Text>
        <Text color={t.ui.muted}>{sanitize(pr.baseRefName)}</Text>
        <Text color={t.ui.dim}>←</Text>
        <Text color={t.ui.selected}>{sanitize(pr.headRefName)}</Text>
        <Text color={t.ui.dim}>·</Text>
        <Text color={t.ci.pass}>+{pr.additions || 0}</Text>
        <Text color={t.ci.fail}>-{pr.deletions || 0}</Text>
        <Text color={t.ui.dim}>{pr.changedFiles || 0} files</Text>
      </Box>
    </Box>
  )
}
