/** PR detail merge status and branch protection requirements. */
import React from 'react'
import { Box, Text } from 'ink'
import { useTheme } from '../../../theme.js'
import { sanitize } from '../../../utils.js'

/** @typedef {{isDraft?: boolean, mergeable?: string, mergeStateStatus?: string, autoMergeRequest?: {mergeMethod?: string}}} PRMergeStatus */

/** @param {{pr: PRMergeStatus}} props */
export function MergeStatusRow({ pr }) {
  const { t } = useTheme()
  const mergeItems = []
  if (pr.isDraft)                             mergeItems.push(React.createElement(Text, { key: 'draft', color: t.pr.draft }, '⊘ Draft — not ready'))
  if (pr.mergeable === 'CONFLICTING')         mergeItems.push(React.createElement(Text, { key: 'conflict', color: t.ci.fail }, '✗ Has conflicts'))
  if (pr.mergeStateStatus === 'BLOCKED')      mergeItems.push(React.createElement(Text, { key: 'blocked', color: t.ci.fail }, '✗ Blocked'))
  if (pr.mergeStateStatus === 'BEHIND')       mergeItems.push(React.createElement(Text, { key: 'behind', color: t.ci.pending }, '● Behind base'))
  if (pr.mergeStateStatus === 'CLEAN')        mergeItems.push(React.createElement(Text, { key: 'clean', color: t.ci.pass }, '✓ Ready to merge'))
  if (pr.mergeStateStatus === 'UNSTABLE')     mergeItems.push(React.createElement(Text, { key: 'unstable', color: t.ci.pending }, '● Unstable'))
  if (pr.mergeStateStatus === 'HAS_HOOKS')    mergeItems.push(React.createElement(Text, { key: 'hooks', color: t.ci.pass }, '✓ Ready (hooks active)'))
  if (pr.autoMergeRequest)                    mergeItems.push(React.createElement(Text, { key: 'automerge', color: t.ci.pass }, `⟳ Auto-merge on (${sanitize(pr.autoMergeRequest.mergeMethod?.toLowerCase())})`))
  return (
    <Box key="merge-hdr" paddingX={1} gap={2}>
      <Text color={t.ui.dim} bold>Merge</Text>
      {mergeItems}
    </Box>
  )
}

/** @param {{protection: {requiredReviews: number, requireCodeOwnerReviews?: boolean}}} props */
export function RequiredReviewsRow({ protection }) {
  const { t } = useTheme()
  return (
    <Box key="prot-reviews" paddingX={2}>
      <Text color={t.ui.dim}>
        Requires {protection.requiredReviews} review{protection.requiredReviews > 1 ? 's' : ''}
        {protection.requireCodeOwnerReviews ? ' + CODEOWNERS' : ''}
      </Text>
    </Box>
  )
}

/** @param {{protection: {requiredChecks: string[]}}} props */
export function RequiredChecksRow({ protection }) {
  const { t } = useTheme()
  return (
    <Box key="prot-checks" paddingX={2}>
      <Text color={t.ui.dim}>
        Required: {protection.requiredChecks.slice(0, 3).map(sanitize).join(', ')}
        {protection.requiredChecks.length > 3 ? ` +${protection.requiredChecks.length - 3}` : ''}
      </Text>
    </Box>
  )
}
