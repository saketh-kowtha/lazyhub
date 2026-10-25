/**
 * Compose the PR detail's flat scroll window. Stable row IDs anchor checks and
 * body search; description elements stay unwrapped for the existing text filter.
 */
import React from 'react'
import { Box, Text } from 'ink'
import { getMarkdownRows } from '../../../utils.js'
import { AssigneesRow, LabelsRow } from './Metadata.jsx'
import { ReviewersHeading, ReviewerRow } from './Reviewers.jsx'
import { sortChecks, ChecksHeading, CheckRow } from './Checks.jsx'
import { MergeStatusRow, RequiredReviewsRow, RequiredChecksRow } from './MergeStatus.jsx'

/** @typedef {{number?: number, title?: string, state?: string, isDraft?: boolean, mergeable?: string, mergeStateStatus?: string, autoMergeRequest?: {mergeMethod?: string}, assignees?: Array<{login: string}>, labels?: Array<{name: string, color: string}>, reviews?: Array<{author?: {login?: string}, state: string}>, reviewRequests?: Array<{login?: string, name?: string}>, statusCheckRollup?: Array<{name?: string, context?: string, conclusion?: string, status?: string, state?: string, appName?: string}>, body?: string}} PRDetailContent */
/** @typedef {{requiredReviews: number, requireCodeOwnerReviews?: boolean, requireStatusChecks?: boolean, requiredChecks?: string[]}} PRProtection */

/** @param {PRDetailContent} pr @param {Array<{name?: string, context?: string, conclusion?: string, status?: string, state?: string, appName?: string}> | null} checks @param {PRProtection | null} protection @param {number} cols @param {object} t @param {number | null} [checkCursor] */
export function buildContentRows(pr, checks, protection, cols, t, checkCursor = null) {
  const rows = []
  const push = (id, el) => rows.push({ id, el })
  const sep = (id) => push(id, <Box key={id} />)

  if (pr.assignees?.length > 0 || pr.labels?.length > 0) {
    if (pr.assignees?.length > 0) {
      push('assignees', React.createElement(AssigneesRow, { key: 'assignees', assignees: pr.assignees }))
    }
    if (pr.labels?.length > 0) {
      push('labels', React.createElement(LabelsRow, { key: 'labels', labels: pr.labels }))
    }
    sep('sep-meta')
  }

  // Keep the latest observed review per login; requests only fill missing logins.
  const reviewStateMap = new Map()
  for (const r of (pr.reviews || [])) {
    if (r.author?.login) reviewStateMap.set(r.author.login, r.state)
  }
  for (const req of (pr.reviewRequests || [])) {
    const login = req.login || req.name
    if (login && !reviewStateMap.has(login)) reviewStateMap.set(login, 'PENDING')
  }
  if (reviewStateMap.size > 0) {
    push('rev-hdr', React.createElement(ReviewersHeading, { key: 'rev-hdr' }))
    for (const [login, state] of reviewStateMap) {
      push(`rev-${login}`, React.createElement(ReviewerRow, { key: `rev-${login}`, reviewer: { login, state } }))
    }
    sep('sep-rev')
  }

  const allChecks = sortChecks(checks, pr)
  if (allChecks.length > 0) {
    push('checks-hdr', React.createElement(ChecksHeading, { key: 'checks-hdr', checks: allChecks, checkCursor }))
    allChecks.forEach((check, index) => {
      push(`check-${index}`, React.createElement(CheckRow, { key: `check-${index}`, check, index, checkCursor }))
    })
    sep('sep-checks')
  }

  push('merge-hdr', React.createElement(MergeStatusRow, { key: 'merge-hdr', pr }))
  if (protection) {
    if (protection.requiredReviews > 0) {
      push('prot-reviews', React.createElement(RequiredReviewsRow, { key: 'prot-reviews', protection }))
    }
    if (protection.requireStatusChecks && protection.requiredChecks?.length > 0) {
      push('prot-checks', React.createElement(RequiredChecksRow, { key: 'prot-checks', protection }))
    }
  }
  sep('sep-merge')

  if (pr.body) {
    push('body-hdr', (
      <Box key="body-hdr" paddingX={1}>
        <Text color={t.ui.dim} bold>Description</Text>
      </Box>
    ))
    getMarkdownRows(pr.body, cols - 4, t).forEach((row, i) => {
      push(`body-md-${i}`, row)
    })
  }
  return rows
}
