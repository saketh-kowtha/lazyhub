// @ts-nocheck
/**
 * features/queue/view.jsx - the review queue (#177), read-only.
 * Mockup: docs/mockups/review-queue-account-wide.md, variant B (status sidebar + list; a chip
 * line instead of the sidebar below 118 columns).
 *
 * Every row says WHY it is in the queue (the attention reason that placed it in its group) and the
 * `why` strip under the list lists every reason with the head commit, CI counts and when the facts
 * were read. There is no score and no safe/unsafe verdict. Nothing here writes to GitHub; approving
 * happens from PR detail (maintainer decision 2026-10-22).
 *
 * EVIDENCE SEAM (#127): `onOpen(item)` receives the full evidence record of the focused row and
 * today the app routes it to the existing PR detail. The read-only evidence view replaces that one
 * callback (app-views.jsx, `onOpenPR` of the queue view) and gets the record without refetching.
 */
import React, { useMemo, useState } from 'react'
import { Box, Text, useStdout } from 'ink'
import { useTheme } from '../../theme.js'
import { useKeyScope } from '../../keyscope.js'
import { useActionResolver, useKeymapInput } from '../../config/keymap.js'
import { classifyGhFailure } from '../../executor.js'
import { openUrl } from '../../services/platform.js'
import { sanitize, sanitizePath, shortAge } from '../../utils.js'
import { fitCell } from '../../ui/row-layout.js'
import { ageWords, ciCell, groupQueue, rowWhy, truncationSummary, whyLine } from './model.js'
import { useReviewQueue } from './useReviewQueue.js'

/** Width from which the status sidebar is drawn; below it the groups are one chip line. */
export const SIDEBAR_MIN_COLS = 118
const SIDEBAR_WIDTH = 28

// The cursor and group survive opening a PR and coming back (#177 acceptance: return with the
// cursor intact). The row is remembered by PR identity so a refresh that reorders keeps it.
/** @type {{group: string|null, key: string|null}} */
let selectionMemory = { group: null, key: null }

/** Forget the remembered group and row (tests). */
export function resetQueueSelection() { selectionMemory = { group: null, key: null } }

const keyOf = item => `${item.identity.repo}#${item.identity.number}`

function useTones() {
  const { t } = useTheme()
  return {
    warning: t.ci.pending, fail: t.ci.fail, error: t.review?.changes || t.ci.fail, pass: t.ci.pass,
    muted: t.ui.muted, pending: t.ci.pending,
  }
}

function Chips({ groups, current }) {
  const { t } = useTheme()
  const tones = useTones()
  return (
    <Box height={1} overflow="hidden">
      <Text wrap="truncate">
        {groups.map(g => (
          <Text key={g.id} color={g.id === current ? t.ui.selected : tones[g.tone]} bold={g.id === current}>
            {g.id === current ? '[' : ' '}{g.glyph} {g.chip} {g.items.length}{g.id === current ? ']' : ' '}{' '}
          </Text>
        ))}
      </Text>
    </Box>
  )
}

function StatusSidebar({ groups, current, height }) {
  const { t } = useTheme()
  const tones = useTones()
  return (
    <Box flexDirection="column" width={SIDEBAR_WIDTH} flexShrink={0} height={height} overflow="hidden">
      <Text color={t.ui.dim}>STATUS</Text>
      {groups.map(g => (
        <Box key={g.id} height={1}>
          <Text color={g.id === current ? t.ui.selected : tones[g.tone]} bold={g.id === current} wrap="truncate">
            {g.id === current ? '▶' : ' '} {g.glyph} {fitCell(g.label, 19)}{String(g.items.length).padStart(3)}
          </Text>
        </Box>
      ))}
      <Text color={t.ui.dim}>{' '}</Text>
      <Text color={t.ui.dim} wrap="truncate">{`  total ${groups.reduce((n, g) => n + g.items.length, 0)} loaded`}</Text>
    </Box>
  )
}

function Rows({ items, idx, offset, rows, width, wide }) {
  const { t } = useTheme()
  const tones = useTones()
  // marker(2) + ref + gap + title + gap + [ci(7) + gap] + why + gap + age(4)
  const refWidth = Math.min(wide ? 26 : 18, Math.max(10, ...items.map(i => `${sanitizePath(i.identity.repo)}#${i.identity.number}`.length)))
  const whyWidth = wide ? Math.min(40, Math.floor(width * 0.34)) : Math.min(30, Math.floor(width * 0.4))
  const ciWidth = wide ? 8 : 0
  const titleWidth = Math.max(8, width - (2 + refWidth + 1 + 1 + ciWidth + whyWidth + 1 + 4))
  return (
    <Box flexDirection="column">
      {items.slice(offset, offset + rows).map((item, i) => {
        const selected = offset + i === idx
        const ci = ciCell(item)
        const ref = `${wide ? sanitizePath(item.identity.repo) : sanitizePath(item.identity.repo).split('/').pop()}#${item.identity.number}`
        return (
          <Box key={keyOf(item)} height={1} overflow="hidden">
            <Text wrap="truncate">
              <Text color={t.ui.selected} bold>{selected ? '▶ ' : '  '}</Text>
              <Text color={t.ui.dim}>{fitCell(ref, refWidth)} </Text>
              <Text color={selected ? t.ui.selected : undefined} bold={selected}>{fitCell(sanitize(item.untrusted?.title || ''), titleWidth)} </Text>
              {wide && <Text color={tones[ci.tone]}>{fitCell(ci.text, ciWidth)}</Text>}
              <Text color={t.ui.muted}>{fitCell(sanitize(rowWhy(item)), whyWidth)} </Text>
              <Text color={t.ui.dim}>{fitCell(shortAge(item.facts?.updated_at?.value === 'unknown' ? null : item.facts?.updated_at?.value), 4)}</Text>
            </Text>
          </Box>
        )
      })}
    </Box>
  )
}

/**
 * @param {object} props
 * @param {(item: object) => void} props.onOpen the evidence seam: receives the focused row's evidence record
 * @param {number} [props.innerWidth] columns inside the pane border
 * @param {number} [props.listHeight] rows available to the pane
 * @param {object} [props.queueOptions] passed to useReviewQueue (tests)
 */
export function ReviewQueue({ onOpen, innerWidth, listHeight, queueOptions }) {
  const { t } = useTheme()
  const { stdout } = useStdout()
  useKeyScope('pane')
  const cols = innerWidth || (stdout?.columns || 80) - 2
  const wide = cols >= SIDEBAR_MIN_COLS
  const queue = useReviewQueue(queueOptions)
  const resolve = useActionResolver('queue-list')

  const groups = useMemo(() => groupQueue(queue.items), [queue.items])
  const [selection, setSelection] = useState(() => selectionMemory)
  const remember = next => { selectionMemory = next; setSelection(next) }

  // Until the user picks a group, show the first one with rows (the order is the precedence).
  const firstFilled = groups.find(g => g.items.length > 0) || groups[0]
  const group = groups.find(g => g.id === selection.group) || firstFilled
  const items = group.items
  const found = selection.key ? items.findIndex(i => keyOf(i) === selection.key) : -1
  const idx = items.length === 0 ? 0 : Math.max(0, found)
  const focused = items[idx] || null

  const move = delta => {
    if (items.length === 0) return
    const next = Math.max(0, Math.min(items.length - 1, idx + delta))
    remember({ group: group.id, key: keyOf(items[next]) })
  }
  const moveGroup = delta => {
    const at = groups.findIndex(g => g.id === group.id)
    const next = groups[(at + delta + groups.length) % groups.length]
    remember({ group: next.id, key: next.items[0] ? keyOf(next.items[0]) : null })
  }

  useKeymapInput((input, key) => {
    const action = resolve(input, key)
    switch (action) {
      case 'cursor.down': move(1); return
      case 'cursor.up': move(-1); return
      case 'cursor.top': if (items.length) remember({ group: group.id, key: keyOf(items[0]) }); return
      case 'cursor.bottom': if (items.length) remember({ group: group.id, key: keyOf(items[items.length - 1]) }); return
      case 'queue.next-group': moveGroup(1); return
      case 'queue.prev-group': moveGroup(-1); return
      case 'list.refresh': queue.refresh(); return
      case 'queue.more': queue.loadMore(); return
      case 'queue.open': if (focused && onOpen) { remember({ group: group.id, key: keyOf(focused) }); onOpen(focused) } return
      case 'queue.browser': if (focused?.identity?.url) openUrl(focused.identity.url); return
      default:
    }
  })

  // Chrome: title(1) + scope(1) + [chips(1)] + notes(1) + why strip (rule + 2 lines)
  const chrome = 6 + (wide ? 0 : 1)
  const rows = Math.max(3, (listHeight || 20) - chrome)
  const offset = Math.max(0, Math.min(idx - Math.floor(rows / 2), items.length - rows))
  const failure = queue.error ? classifyGhFailure(queue.error, { cached: queue.items.length > 0 }) : null
  const now = Date.now()
  const updated = queue.fetchedAtMs ? ageWords(now - queue.fetchedAtMs) : null
  const notes = truncationSummary(queue.truncation)
  const meta = queue.meta
  const rate = meta?.rate_limit

  let body
  if (queue.loading && queue.items.length === 0) {
    body = <Text color={t.ui.dim}>Loading the review queue…</Text>
  } else if (failure && queue.items.length === 0) {
    body = <Text color={t.ci.fail}>{`✗ ${failure.cause}`}{failure.fix ? `  Fix: ${failure.fix}` : ''}</Text>
  } else if (queue.items.length === 0) {
    body = (
      <Box flexDirection="column">
        <Text>Nothing needs your attention here.</Text>
        <Text color={t.ui.muted}>No open pull request requests your review or was opened by you on {sanitize(meta?.host || 'this host')}.</Text>
        <Text color={t.ui.muted}>Review requests from other repositories appear here as GitHub reports them; press r to check again.</Text>
      </Box>
    )
  } else if (items.length === 0) {
    body = <Text color={t.ui.muted}>{`Nothing in "${group.label}" among the ${queue.items.length} loaded. ] and [ switch group.`}</Text>
  } else {
    body = <Rows items={items} idx={idx} offset={offset} rows={rows} width={wide ? cols - SIDEBAR_WIDTH - 1 : cols} wide={wide} />
  }

  return (
    <Box flexDirection="column" flexGrow={1} paddingX={1} overflow="hidden">
      <Box height={1} overflow="hidden" justifyContent="space-between">
        <Text wrap="truncate">
          <Text color={t.ui.selected} bold>Review queue</Text>
          <Text color={t.ui.dim}>{`  ${meta ? `account @${sanitizePath(String(meta.account))} · ${sanitize(meta.host)}` : 'loading'}`}</Text>
        </Text>
        <Text color={t.ui.dim} wrap="truncate">{queue.loading || queue.loadingMore ? '⟳ updating' : updated ? `⟳ updated ${updated}` : ''}</Text>
      </Box>
      <Box height={1} overflow="hidden">
        <Text color={t.ui.dim} wrap="truncate">scope: account · review requests and PRs you opened · read-only</Text>
      </Box>
      {!wide && <Chips groups={groups} current={group.id} />}
      <Box flexDirection="row" flexGrow={1} height={rows} overflow="hidden">
        {wide && <StatusSidebar groups={groups} current={group.id} height={rows} />}
        <Box flexDirection="column" flexGrow={1} overflow="hidden">{body}</Box>
      </Box>
      <Box height={1} overflow="hidden">
        <Text wrap="truncate" color={failure || notes || rate?.low === true ? t.ci.pending : t.ui.dim}>
          {failure && queue.items.length > 0
            ? `⚠ refresh failed: ${failure.cause} Showing rows read ${updated || 'earlier'}.`
            : notes
              ? `⚠ ${notes} · + loads more`
              : rate?.low === true
                ? '⚠ GitHub rate limit is nearly used up; refresh is slower to recover.'
                : items.length > 0 ? `${idx + 1} of ${items.length} in ${group.label}` : ''}
        </Text>
      </Box>
      <Box height={3} overflow="hidden" borderStyle="single" borderColor={t.ui.border} borderLeft={false} borderRight={false} borderBottom={false}>
        <Text color={t.ui.muted} wrap="wrap">
          <Text color={t.ui.dim}>why  </Text>{focused ? sanitize(whyLine(focused, now)) : 'select a row to see why it is here'}
        </Text>
      </Box>
    </Box>
  )
}
