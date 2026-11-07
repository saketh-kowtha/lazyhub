/**
 * src/features/issues/timeline-rows.jsx — the issue description, comments and events as
 * single-line rows (#565). One row is one terminal line, so the controller can scroll by line
 * and still know which item each line belongs to. Every GitHub string goes through sanitize().
 */

import React from 'react'
import { Box, Text } from 'ink'
import { sanitize, sanitizeBlock, shortAge, displayWidth, getMarkdownRows } from '../../utils.js'
import { wrapLine } from './timeline-state.js'

const ROLE = {
  OWNER: 'owner', MEMBER: 'member', COLLABORATOR: 'collaborator', CONTRIBUTOR: 'contributor',
  FIRST_TIME_CONTRIBUTOR: 'first-time contributor', FIRST_TIMER: 'first-timer', MANNEQUIN: 'mannequin',
}
const CLOSE_REASON = { COMPLETED: 'completed', NOT_PLANNED: 'not planned', DUPLICATE: 'duplicate' }
const MINIMIZED = { SPAM: 'spam', ABUSE: 'abuse', OFF_TOPIC: 'off-topic', OUTDATED: 'outdated', RESOLVED: 'resolved', DUPLICATE: 'duplicate' }

/** Author association badge text ('' when GitHub gives none worth showing). */
export const roleOf = association => ROLE[association] || ''

const ref = (s, repo) => {
  if (!s) return ''
  const where = s.repo && repo && s.repo !== repo ? `${s.repo}#${s.number}` : `#${s.number}`
  return `${where}${s.title ? ` ${s.title}` : ''}`
}

/**
 * One-line description of a timeline event, already sanitized.
 * @param {any} e  an item with kind 'event'
 * @param {string} [repo]  owner/name, to say "o/other#3" for cross-repository references
 */
export function eventText(e, repo = '') {
  const who = e.actor ? `@${sanitize(e.actor)}` : 'Someone'
  switch (e.type) {
    case 'labeled': return `${who} added the ${sanitize(e.label)} label`
    case 'unlabeled': return `${who} removed the ${sanitize(e.label)} label`
    case 'assigned': return e.assignee && e.assignee === e.actor ? `${who} self-assigned this` : `${who} assigned @${sanitize(e.assignee)}`
    case 'unassigned': return e.assignee && e.assignee === e.actor ? `${who} unassigned themselves` : `${who} unassigned @${sanitize(e.assignee)}`
    case 'closed': {
      const reason = CLOSE_REASON[e.stateReason] ? ` as ${CLOSE_REASON[e.stateReason]}` : ''
      const by = e.closer?.type === 'pr' ? ` via ${sanitize(ref(e.closer, repo))}` : e.closer?.type === 'commit' ? ` in ${sanitize(e.closer.oid)}` : ''
      return `${who} closed this${reason}${by}`
    }
    case 'reopened': return `${who} reopened this`
    case 'renamed': return `${who} changed the title "${sanitize(e.from)}" to "${sanitize(e.to)}"`
    case 'cross-referenced': return `${who} mentioned this in ${sanitize(ref(e.source, repo)) || 'another item'}${e.willClose ? ' (will close this)' : ''}`
    case 'connected': return `${who} linked ${sanitize(ref(e.source, repo)) || 'a pull request'}`
    case 'disconnected': return `${who} unlinked ${sanitize(ref(e.source, repo)) || 'a pull request'}`
    default: return `${who} ${sanitize(e.type)}`
  }
}

/** "+1 2  heart 1" for a comment's reactions ('' when none). */
export const reactionsText = reactions => (reactions || []).map(r => `${sanitize(r.label)} ${r.count}`).join('  ')

/**
 * Rows for the whole timeline.
 * Index 0 of the item map is the issue description; item i of `items` is entry i + 1.
 * @param {object} args
 * @param {any} args.issue  header from getIssueHeader
 * @param {any[]} args.items  loaded timeline items
 * @param {number} args.width  usable columns
 * @param {any} args.t  theme tokens
 * @param {string} [args.repo]
 * @returns {{rows: {id: string, entry: number, el: any}[], starts: number[]}}
 */
export function buildTimelineRows({ issue, items, width, t, repo = '' }) {
  const rows = []
  const starts = []
  const bodyWidth = Math.max(10, width - 4)
  const push = (entry, id, el) => rows.push({ id: `${entry}:${id}`, entry, el })

  // Entry 0: labels and the description.
  starts.push(0)
  if (issue?.labels?.length > 0) {
    push(0, 'labels', (
      <Text wrap="truncate">
        {issue.labels.map(l => <React.Fragment key={l.name}><Text color={t.ui.muted}>{`[${sanitize(l.name)}] `}</Text></React.Fragment>)}
      </Text>
    ))
  }
  if (issue?.body) {
    push(0, 'hdr', <Text color={t.ui.muted} bold>Description:</Text>)
    const md = getMarkdownRows(issue.body, bodyWidth, t)
    md.forEach((row, i) => push(0, `b${i}`, row))
  } else {
    push(0, 'hdr', <Text color={t.ui.dim}>No description provided.</Text>)
  }
  push(0, 'sp', <Text> </Text>)

  items.forEach((item, idx) => {
    const entry = idx + 1
    starts.push(rows.length)
    if (item.kind === 'event') {
      push(entry, 'ev', (
        <Box gap={1}>
          <Text color={t.ui.dim}>·</Text>
          <Text color={t.ui.muted} wrap="truncate">{eventText(item, repo)}</Text>
          <Text color={t.ui.dim}>{shortAge(item.createdAt)}</Text>
        </Box>
      ))
      return
    }
    const role = roleOf(item.authorAssociation)
    push(entry, 'hdr', (
      <Box gap={1}>
        <Text color={t.diff.threadBorder}>┃</Text>
        <Text color={t.ui.selected} bold>@{sanitize(item.author)}</Text>
        {role ? <Text color={t.ui.dim}>{role}</Text> : null}
        <Text color={t.ui.dim}>{shortAge(item.createdAt)}</Text>
        {item.lastEditedAt ? <Text color={t.ui.dim}>(edited)</Text> : null}
        {item.isMinimized ? <Text color={t.ci.pending}>{`hidden: ${MINIMIZED[item.minimizedReason] || sanitize(String(item.minimizedReason || 'hidden').toLowerCase())}`}</Text> : null}
      </Box>
    ))
    if (item.isMinimized) {
      push(entry, 'min', <Text color={t.ui.dim} wrap="truncate">{'┃ This comment is hidden. Open the issue in the browser to read it.'}</Text>)
    } else {
      sanitizeBlock(item.body).split('\n').forEach((line, li) => {
        wrapLine(line, bodyWidth, displayWidth).forEach((chunk, ci) => {
          push(entry, `l${li}.${ci}`, (
            <Box><Text color={t.diff.threadBorder}>{'┃ '}</Text><Text color={t.diff.ctxFg} wrap="truncate">{chunk}</Text></Box>
          ))
        })
      })
    }
    const reactions = reactionsText(item.reactions)
    if (reactions) push(entry, 'react', <Box><Text color={t.diff.threadBorder}>{'┃ '}</Text><Text color={t.ui.dim} wrap="truncate">{reactions}</Text></Box>)
    push(entry, 'sp', <Text> </Text>)
  })
  return { rows, starts }
}
