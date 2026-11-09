/** PR rows, expanded metadata and popover content; shared display summaries stay here. */
import React, { memo } from 'react'
import { Box, Text } from 'ink'
import { effectiveHintKey, getActionConfig } from '../../config/actions.js'
import { ListRow } from '../../ui/ListRow.jsx'
import { sanitize, shortAge, truncateToWidth, formatLogin, padEndWidth, padStartWidth } from '../../utils.js'

// ─── Badges ───────────────────────────────────────────────────────────────────
// Colour budget (#566): the state is the glyph (● open, ◐ draft, ⟳ auto-merge, ◆ merged, ○ closed,
// ▲ conflict) and the focused row takes the one accent. Red and yellow are kept for what needs
// attention: failing or pending CI, changes requested, a merge conflict.

function PRStateBadge({ pr, t, isSelected }) {
  const conflicting = pr.state === 'OPEN' && pr.mergeable === 'CONFLICTING'
  const quiet = isSelected ? t.ui.selected : t.ui.muted
  if (conflicting)  return <Text color={t.pr.conflict || t.ci.pending} bold>▲</Text>
  if (pr.isDraft)   return <Text color={quiet}>◐</Text>
  switch (pr.state) {
    case 'OPEN':
      if (pr.autoMergeRequest) return <Text color={isSelected ? t.ui.selected : undefined}>⟳</Text>
      return <Text color={isSelected ? t.ui.selected : undefined}>●</Text>
    case 'MERGED': return <Text color={quiet}>◆</Text>
    case 'CLOSED': return <Text color={quiet}>○</Text>
    default:       return <Text color={quiet}>●</Text>
  }
}

function CIBadge({ pr, t, isSelected }) {
  const checks = pr.statusCheckRollup
  let total; let failing; let pending
  if (checks && checks.length > 0) {
    total   = checks.length
    const states = checks.map(c => c.state || c.conclusion || c.status || '')
    failing = states.filter(s => /failure|error/i.test(s)).length
    pending = states.filter(s => /pending|in_progress|queued/i.test(s)).length
  } else if (pr.checkSummary?.total > 0) {
    // List rows carry only counters; the full check list loads for the focused row.
    ({ total, failing, pending } = pr.checkSummary)
  } else {
    return null
  }
  if (failing > 0) return <Text color={t.ci.fail} bold> ✗ {failing}/{total}</Text>
  if (pending > 0) return <Text color={t.ci.pending}> ● {pending}/{total}</Text>
  return <Text color={isSelected ? t.ui.selected : t.ui.muted}> ✓</Text>
}

function ReviewBadge({ pr, t, isSelected }) {
  const rd = pr.reviewDecision
  if (!rd || rd === 'REVIEW_REQUIRED') return <Text> </Text>
  if (rd === 'APPROVED')          return <Text color={isSelected ? t.ui.selected : t.ui.muted}> ✓</Text>
  if (rd === 'CHANGES_REQUESTED') return <Text color={t.review?.changes  || t.ci.fail} bold> ✗</Text>
  return <Text> </Text>
}

// Fixed columns: paddingX(2) + cursor(1) + badge(2) + num(7) + review(2) + CI_max(8) + author(13) + age(5) = 40; +4 buffer
export const PR_ROW_FIXED_COLS = 44

// Expanded rows and popovers use the same CI summary. The compact row badge
// retains its separate status fallback for legacy status-only check payloads.
function summarizeChecks(checks, t, summary) {
  if (!checks.length && summary?.total > 0) {
    const passing = summary.total - summary.failing - summary.pending
    return {
      failing: summary.failing,
      pending: summary.pending,
      passing,
      total: summary.total,
      ciColor: summary.failing ? t.ci.fail : summary.pending ? t.ci.pending : t.ui.muted,
    }
  }
  const failing = checks.filter(check => /failure|error/i.test(check.state || check.conclusion || '')).length
  const pending = checks.filter(check => /pending|in_progress|queued/i.test(check.state || check.conclusion || check.status || '')).length
  return {
    failing,
    pending,
    passing: checks.length - failing - pending,
    total: checks.length,
    ciColor: failing ? t.ci.fail : pending ? t.ci.pending : t.ui.muted,
  }
}

// ─── Expanded detail shown below selected PR ─────────────────────────────────

function PRExpandedDetail({ pr, t }) {
  const checks   = pr.statusCheckRollup || []
  const labels   = (pr.labels || []).slice(0, 5)
  const reviewers = (pr.reviewRequests || []).slice(0, 4)
  const bodyLine = (pr.body || '').trim().split('\n').find(l => l.trim()) || ''

  const { failing, pending, passing, total, ciColor } = summarizeChecks(checks, t, pr.checkSummary)
  const ciParts = []
  if (passing) ciParts.push(`✓ ${passing}`)
  if (pending) ciParts.push(`● ${pending}`)
  if (failing) ciParts.push(`✗ ${failing}`)
  if (total) ciParts.push(`/ ${total}`)

  const branch = [pr.headRefName, pr.baseRefName].filter(Boolean).map(sanitize).join(' → ')

  return (
    <Box flexDirection="column" paddingLeft={4}>
      {branch ? (
        <Text color={t.ui.muted} wrap="truncate">⌥  {branch}</Text>
      ) : null}
      {total > 0 && (
        <Text color={ciColor} wrap="truncate">   {ciParts.join('  ')}</Text>
      )}
      {labels.length > 0 && (
        <Text color={t.ui.selected} wrap="truncate">
          {'◆  ' + labels.map(l => sanitize(l.name)).join('  ·  ')}
        </Text>
      )}
      {reviewers.length > 0 && (
        <Text color={t.ui.muted} wrap="truncate">
          {'◇  ' + reviewers.map(r => '@' + sanitize(r.login || r.name || '')).join('  ')}
        </Text>
      )}
      {bodyLine ? (
        <Text color={t.ui.muted} italic wrap="truncate">
          {"   " + sanitize(bodyLine).slice(0, 120)}
        </Text>
      ) : null}
    </Box>
  )
}

// `maskTitle` blanks the title cell for rows a popover floats over: the popover
// covers only its own width, so the title's tail would otherwise peek out beside it.
export const PRRow = memo(({ pr, isSelected, t, titleWidth, expanded, maskTitle = false }) => {
  // Use display-width-aware helpers so CJK/emoji authors don't break borders
  const rawLogin    = sanitize(pr.author?.login)
  const authorLogin = padEndWidth(formatLogin(rawLogin, 11), 11)
  const ageStr      = padStartWidth(shortAge(pr.updatedAt), 4)
  const tw          = Math.max(8, titleWidth || 20)

  return (
    <Box flexDirection="column">
      <ListRow selected={isSelected}>
        <PRStateBadge pr={pr} t={t} isSelected={isSelected} />
        <Text color={isSelected ? t.ui.selected : t.ui.muted}> {'#' + String(pr.number).padEnd(5)}</Text>
        <Box width={tw} overflow="hidden">
          <Text
            color={isSelected ? t.ui.selected : undefined}
            bold={isSelected}
            italic={pr.isDraft}
            wrap="truncate"
          >
            {maskTitle ? ' ' : sanitize(pr.title)}
          </Text>
        </Box>
        <CIBadge pr={pr} t={t} isSelected={isSelected} />
        <ReviewBadge pr={pr} t={t} isSelected={isSelected} />
        <Text color={isSelected ? t.ui.selected : t.ui.muted}> @{authorLogin}</Text>
        <Text color={isSelected ? t.ui.selected : t.ui.muted}> {ageStr}</Text>
      </ListRow>
      {expanded && <PRExpandedDetail pr={pr} t={t} />}
    </Box>
  )
})

export { MERGE_OPTIONS, mergeMethodLabel, allowedMergeOptions } from './merge-methods.js'

export function canToggleAutoMergeFromList(pr) {
  return pr?.state === 'OPEN' && !pr?.isDraft
}

/** Merge-picker entry that opens the auto-merge confirm; no commit-message prompt. */
export function autoMergeOption(pr) {
  const disabling = !!pr?.autoMergeRequest
  return {
    value: 'auto-merge',
    label: disabling ? 'Disable auto-merge' : 'Enable auto-merge',
    description: disabling ? 'Stop merging automatically when checks pass' : 'Merge automatically when required checks pass',
    skipPrompt: true,
  }
}

// ─── PR detail popover content ────────────────────────────────────────────────

/** Default popover width in columns; clamped to terminal width at runtime. */
export const POPOVER_WIDTH = 52
/** Height in rows: title(1) + meta(1) + divider(1) + body(6) + divider(1) + summary(1) + divider(1) + hint(1) + border(2) = 15 */
export const POPOVER_HEIGHT = 15

const MIN_TITLE_COLS = 24
const MIN_PANEL_COLS = 36

/**
 * Where the preview panel goes: it takes the right-hand columns and the rows are narrowed
 * to the rest, so it never covers a PR. `fits` is false when the pane cannot hold both.
 * @param {{ listWidth: number, termRows: number, previewWidth?: number }} opts
 * @returns {{ width: number, fits: boolean }}
 */
export function previewPanelLayout({ listWidth, termRows, previewWidth }) {
  const wanted = Math.max(MIN_PANEL_COLS, Math.min(80, Number(previewWidth) || POPOVER_WIDTH))
  const width = Math.min(wanted, listWidth - PR_ROW_FIXED_COLS - MIN_TITLE_COLS)
  return { width, fits: termRows >= POPOVER_HEIGHT + 8 && width >= MIN_PANEL_COLS }
}

/**
 * The preview popover's hint bar, from the effective bindings so a rebind or unbind
 * is reflected and an unbound action is left out (#485). Esc closes the popover.
 * @param {Record<string, any>} [config] effective config
 * @returns {string} hint text
 */
export function previewHint(config = getActionConfig()) {
  const parts = []
  const open = effectiveHintKey('pr.open-selected', config)
  if (open) parts.push(`${open === 'Enter' ? '↩' : open} open`)
  for (const [id, label] of [['pr.approve', 'approve'], ['pr.merge', 'merge']]) {
    const key = effectiveHintKey(id, config)
    if (key) parts.push(`${key} ${label}`)
  }
  parts.push('Esc hide')
  return parts.join(' · ')
}

/**
 * Popover content component: shows PR title, meta, body excerpt, CI summary,
 * unresolved thread count, and action hints.
 *
 * @param {object} props
 * @param {object} props.pr  - PR object from the list (includes body, statusCheckRollup, etc.)
 * @param {object} props.t   - The active theme (useTheme().t).
 * @param {number} props.width  - Effective popover inner width (box width - 2 for borders).
 */
function PRDetailPopoverContent({ pr, t, width }) {
  const innerW = Math.max(10, width - 2)  // subtract left+right border

  // ── Meta line: state · @author → base · age
  const stateLabel = pr.isDraft ? 'draft' : (pr.state || '').toLowerCase()
  const stateColor = pr.isDraft ? t.pr.draft
    : pr.state === 'OPEN'   ? t.pr.open
    : pr.state === 'MERGED' ? t.pr.merged
    : t.pr.closed
  const author     = sanitize(pr.author?.login)
  const base       = sanitize(pr.baseRefName || 'main')
  const age        = shortAge(pr.updatedAt)

  // ── Body excerpt: first ~6 non-empty lines, truncated
  const bodyLines = (pr.body || '')
    .split('\n')
    .map(l => sanitize(l.trimEnd()))
    .filter(l => l.length > 0)
    .slice(0, 6)
  // The list row carries no body; it loads for the focused row (getPRPreview).
  if (pr.body === undefined) bodyLines.push(pr.previewError ? 'preview unavailable' : 'loading…')
  while (bodyLines.length < 6) bodyLines.push('')

  // ── CI summary
  const checks   = pr.statusCheckRollup || []
  const { failing, pending, total, ciColor } = summarizeChecks(checks, t, pr.checkSummary)
  const ciLabel  = total === 0 ? 'no checks'
    : failing ? `✗ ${failing} failing`
    : pending ? `● ${pending} pending`
    : `✓ ci-pass`

  // ── Unresolved threads (reviewThreads not in list payload; default 0)
  const unresolvedCount = 0

  const borderColor  = t.ui.borderActive

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={borderColor}
      width={width}
    >
      {/* Title */}
      <Box paddingX={1}>
        <Text color={t.ui.fg} bold wrap="truncate">
          {'#' + pr.number + ' ' + sanitize(pr.title || '')}
        </Text>
      </Box>
      {/* Meta */}
      <Box paddingX={1}>
        <Text color={stateColor}>{sanitize(stateLabel)}</Text>
        <Text color={t.ui.dim}> · </Text>
        <Text color={t.ui.muted}>@{formatLogin(author, 12)}</Text>
        <Text color={t.ui.dim}> → </Text>
        <Text color={t.ui.muted}>{truncateToWidth(base, 16)}</Text>
        <Text color={t.ui.dim}> · </Text>
        <Text color={t.ui.dim}>{age}</Text>
      </Box>
      {/* Divider */}
      <Box><Text color={t.ui.dim}>{'─'.repeat(innerW)}</Text></Box>
      {/* Body excerpt */}
      {bodyLines.map((line, idx) => (
        <Box key={idx} paddingX={1}>
          <Text color={t.ui.fg} wrap="truncate">
            {line || ' '}
          </Text>
        </Box>
      ))}
      {/* Divider */}
      <Box><Text color={t.ui.dim}>{'─'.repeat(innerW)}</Text></Box>
      {/* Summary */}
      <Box paddingX={1}>
        <Text color={ciColor}>{ciLabel}</Text>
        <Text color={t.ui.dim}> · </Text>
        <Text color={unresolvedCount > 0 ? t.ci.pending : t.ui.dim}>
          {unresolvedCount} unresolved
        </Text>
      </Box>
      {/* Divider */}
      <Box><Text color={t.ui.dim}>{'─'.repeat(innerW)}</Text></Box>
      {/* Hint bar */}
      <Box paddingX={1}>
        <Text color={t.ui.dim} wrap="truncate">
          {truncateToWidth(previewHint(), innerW)}
        </Text>
      </Box>
    </Box>
  )
}

// Prevent rerenders when other rows change focus (only rerender on PR data change)
export const PRDetailPopoverContentMemo = memo(PRDetailPopoverContent)
