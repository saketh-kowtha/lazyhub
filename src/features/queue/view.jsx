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
 * START HERE (#177 phase 2, mockup docs/mockups/review-queue-start-here.md): the first group ranks
 * every loaded row by the fixed keys in rank.js, under Needs you / Waiting on others / Stale
 * headings; the strip's `rank` line names every key that placed the focused row. Rows carry compact
 * signal badges (size, CI red, merge conflict, a cached collision-radar result, bot author, draft);
 * a badge with no source data is hidden.
 *
 * EVIDENCE SEAM (#127): `onOpen(item)` receives the full evidence record of the focused row and
 * today the app routes it to the existing PR detail. The read-only evidence view replaces that one
 * callback (app-views.jsx, `onOpenPR` of the queue view) and gets the record without refetching.
 */
import React, { useEffect, useMemo, useState } from 'react'
import { Box, Text, useStdout } from 'ink'
import { useTheme } from '../../theme.js'
import { useKeyScope } from '../../keyscope.js'
import { useActionResolver, useKeymapInput } from '../../config/keymap.js'
import { classifyGhFailure } from '../../executor.js'
import { openUrl } from '../../services/platform.js'
import { displayWidth, truncateEllipsis, sanitize, sanitizePath, shortAge } from '../../utils.js'
import { fitCell } from '../../ui/row-layout.js'
import { ageWords, ciCell, groupQueue, rowWhy, truncationSummary, whyLine } from './model.js'
import { useReviewQueue } from './useReviewQueue.js'
import { chooseScope, currentScope, loadScopes, nextScope, resetQueueScope } from './scope.js'
import { STALE_DAYS_DEFAULT, SECTIONS, badgesFor, fitBadges, rankLine, rankOrderText, rankQueue, sizeOf } from './rank.js'
import { cachedCollisions } from './signals.js'
import { loadConfig as loadTomlConfig } from '../../config/loader.js'
import { logSwallowed } from '../../contain.js'

/** Width from which the status sidebar is drawn; below it the groups are one chip line. */
export const SIDEBAR_MIN_COLS = 118
const SIDEBAR_WIDTH = 28
/** Width of the "why  " / "rank " labels on the strip; the strip is rank(1) + signals(1) + why(2). */
const WHY_PREFIX = 5
/** The ranked group: every loaded row, in the order of rank.js. */
export const START_GROUP = Object.freeze({ id: 'start', glyph: '◆', label: 'Start here', chip: 'Start', tone: 'muted' })

/** `[queue].stale_days` from the config, or the default. */
function configuredStaleDays() {
  try {
    const v = /** @type {any} */ (loadTomlConfig()).queue?.stale_days
    return Number.isInteger(v) && v > 0 ? v : STALE_DAYS_DEFAULT
  } catch (error) {
    logSwallowed('queue.stale_days', error)
    return STALE_DAYS_DEFAULT
  }
}

// The cursor and group survive opening a PR and coming back (#177 acceptance: return with the
// cursor intact). The row is remembered by PR identity so a refresh that reorders keeps it.
/** @type {{group: string|null, key: string|null}} */
let selectionMemory = { group: null, key: null }

/** Forget the remembered group and row (tests). */
export function resetQueueSelection() { selectionMemory = { group: null, key: null }; resetQueueScope() }

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
      {groups.filter(g => g.id === START_GROUP.id).map(g => (
        <Box key={g.id} height={1}>
          <Text color={g.id === current ? t.ui.selected : t.ui.muted} bold={g.id === current} wrap="truncate">
            {g.id === current ? '▶' : ' '} {g.glyph} {fitCell(g.label, 19)}{String(g.items.length).padStart(3)}
          </Text>
        </Box>
      ))}
      <Text color={t.ui.dim}>STATUS</Text>
      {groups.filter(g => g.id !== START_GROUP.id).map(g => (
        <Box key={g.id} height={1}>
          <Text color={g.id === current ? t.ui.selected : tones[g.tone]} bold={g.id === current} wrap="truncate">
            {g.id === current ? '▶' : ' '} {g.glyph} {fitCell(g.label, 19)}{String(g.items.length).padStart(3)}
          </Text>
        </Box>
      ))}
      <Text color={t.ui.dim}>{' '}</Text>
      <Text color={t.ui.dim} wrap="truncate">{`  total ${groups.filter(g => g.id !== START_GROUP.id).reduce((n, g) => n + g.items.length, 0)} loaded`}</Text>
    </Box>
  )
}

/**
 * Size label plus signal badges for one row, fitted to `width` (least important dropped first, as "+N").
 * The CI badge is left out where the CI column is drawn.
 */
function BadgeCell({ item, width, withCi }) {
  const tones = useTones()
  const badges = badgesFor(item, { collisions: cachedCollisions(item) }).filter(b => withCi || b.id !== 'ci')
  const size = sizeOf(item).label
  const { shown, dropped } = fitBadges(size, badges, width, displayWidth)
  const used = displayWidth([size, ...shown.map(b => b.text), ...(dropped ? [`+${dropped}`] : [])].join(' '))
  return (
    <Text>
      <Text color={tones.muted}>{size}</Text>
      {shown.map(b => <Text key={b.id} color={tones[b.tone]}>{` ${sanitize(b.text)}`}</Text>)}
      {dropped > 0 && <Text color={tones.muted}>{` +${dropped}`}</Text>}
      {' '.repeat(Math.max(0, width - used))}
    </Text>
  )
}

/** Title columns kept before the badge cell shrinks to the size label. */
const MIN_TITLE = 14

function Rows({ lines, cursor, offset, rows, width, wide }) {
  const { t } = useTheme()
  const tones = useTones()
  const items = lines.filter(l => l.kind === 'item').map(l => l.item)
  // marker(2) + ref + gap + title + gap + [ci(7) + gap] + badges + gap + why + gap + age(4)
  const refOf = item => (wide ? sanitizePath(item.identity.repo) : sanitizePath(item.identity.repo).split('/').pop()) + `#${item.identity.number}`
  const refWidth = Math.min(wide ? 26 : 18, Math.max(10, ...items.map(i => refOf(i).length)))
  const whyWidth = wide ? Math.min(40, Math.floor(width * 0.26)) : Math.min(26, Math.floor(width * 0.34))
  const ciWidth = wide ? 8 : 0
  // Size plus one badge and a "+N" fit; the strip's sig line lists them all. The title outranks the
  // badges (secondary metadata goes first, DESIGN_REFERENCES): when it would get too narrow the
  // cell keeps only the size.
  const fixed = 2 + refWidth + 1 + 1 + ciWidth + 1 + whyWidth + 1 + 4
  const badgeWidth = width - fixed - (wide ? 9 : 8) >= MIN_TITLE ? (wide ? 9 : 8) : 2
  const titleWidth = Math.max(8, width - fixed - badgeWidth)
  return (
    <Box flexDirection="column">
      {lines.slice(offset, offset + rows).map((line, i) => {
        if (line.kind === 'header') {
          return (
            <Box key={`h:${line.id}`} height={1} overflow="hidden">
              <Text color={t.ui.dim} bold wrap="truncate">{`  ${line.label.toUpperCase()} ${line.count}${line.note ? `  ${line.note}` : ''}`}</Text>
            </Box>
          )
        }
        const item = line.item
        const selected = offset + i === cursor
        const ci = ciCell(item)
        return (
          <Box key={keyOf(item)} height={1} overflow="hidden">
            <Text wrap="truncate">
              <Text color={t.ui.selected} bold>{selected ? '▶ ' : '  '}</Text>
              <Text color={t.ui.dim}>{fitCell(refOf(item), refWidth)} </Text>
              <Text color={selected ? t.ui.selected : undefined} bold={selected}>{fitCell(sanitize(item.untrusted?.title || ''), titleWidth)} </Text>
              {wide && <Text color={tones[ci.tone]}>{fitCell(ci.text, ciWidth)}</Text>}
              <BadgeCell item={item} width={badgeWidth} withCi={!wide} />
              <Text> </Text>
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
 * The queue for one scope. The scope (this repo, account, an org or a repository set, #177) picks
 * the search filter; it is held here so opening a PR and coming back keeps it, and the screen
 * below is keyed by it so each scope has its own rows, loading state and freshness.
 * @param {object} props
 * @param {(item: object) => void} props.onOpen the evidence seam: receives the focused row's evidence record
 * @param {number} [props.innerWidth] columns inside the pane border
 * @param {number} [props.listHeight] rows available to the pane
 * @param {object} [props.queueOptions] passed to useReviewQueue (tests)
 * @param {import('./scope.js').QueueScope[]} [props.scopes] replaces the scopes built from the launch repo and config (tests)
 * @param {number} [props.staleDays] replaces `[queue].stale_days` (tests)
 */
export function ReviewQueue({ scopes: given, staleDays: givenStale, ...rest }) {
  const scopes = useMemo(() => given || loadScopes(), [given])
  const staleDays = useMemo(() => givenStale || configuredStaleDays(), [givenStale])
  const [scopeId, setScopeId] = useState(() => currentScope(scopes).id)
  const scope = scopes.find(s => s.id === scopeId) || currentScope(scopes)
  const cycle = () => {
    const next = nextScope(scopes, scope.id)
    chooseScope(next)
    setScopeId(next.id)
  }
  return <QueueScreen key={scope.id} {...rest} scope={scope} scopes={scopes} staleDays={staleDays} onCycleScope={cycle} />
}

/**
 * The scope row: what is shown, that it is read-only, and what the scope key shows next. It must
 * fit one line: the scope name and "read-only" always stay; when the width runs out the
 * explanation goes first, then the "s: next" hint (the footer has it), and only then the scope
 * name is cut. Same least-important-first rule as the row layout (R10, #488).
 */
export function scopeLine(scope, scopes, width = Infinity) {
  const name = scope.kind === 'account' ? 'scope: account' : `scope: ${scope.label}`
  const why = scope.kind === 'account' ? 'review requests and PRs you opened' : `(${scope.note})`
  const hint = scopes.length === 1 ? 'no org or set in [queue] config' : `s: ${nextScope(scopes, scope.id).label}`
  const build = (/** @type {string[]} */ ...parts) => parts.filter(Boolean).join(' · ')
  const joinWhy = scope.kind === 'account' ? [name, why] : [`${name} ${why}`]
  for (const candidate of [build(...joinWhy, 'read-only', hint), build(name, 'read-only', hint), build(name, 'read-only')]) {
    if (displayWidth(sanitize(candidate)) <= width) return candidate
  }
  // Even the bare form does not fit: cut the scope name, never "read-only".
  return `${truncateEllipsis(sanitize(name), Math.max(8, width - displayWidth(' · read-only')))} · read-only`
}

/** Every signal of a row in words, size first; the row shows the short forms. */
export function signalLine(item) {
  const badges = badgesFor(item, { collisions: cachedCollisions(item) })
  return [sizeOf(item).words, ...badges.map(b => b.words)].join(' · ')
}

/**
 * The list lines of one group: the Start here group gets a heading per section (with its count);
 * other groups are their rows. Returns the lines and, per row key, the line it is on.
 */
function groupLines(group, ranked, staleDays) {
  if (group.id !== START_GROUP.id) return group.items.map(item => ({ kind: 'item', item }))
  const lines = []
  for (const section of SECTIONS) {
    const inSection = ranked.filter(r => r.section === section.id)
    if (inSection.length === 0) continue
    lines.push({ kind: 'header', id: section.id, label: section.label, count: inSection.length, note: section.id === 'stale' ? `no update in more than ${staleDays}d` : '' })
    for (const r of inSection) lines.push({ kind: 'item', item: r.item })
  }
  return lines
}

function QueueScreen({ onOpen, innerWidth, listHeight, queueOptions, scope, scopes, staleDays = STALE_DAYS_DEFAULT, onCycleScope }) {
  const { t } = useTheme()
  const { stdout } = useStdout()
  useKeyScope('pane')
  const cols = innerWidth || (stdout?.columns || 80) - 2
  const wide = cols >= SIDEBAR_MIN_COLS
  const queue = useReviewQueue({ ...queueOptions, scope })
  const resolve = useActionResolver('queue-list')

  // Ages are counted from when the rows were read, so the order holds still between refreshes.
  const rankedAt = queue.fetchedAtMs || 0
  const ranked = useMemo(() => rankQueue(queue.items, { now: rankedAt || Date.now(), staleDays }), [queue.items, rankedAt, staleDays])
  const rankByKey = useMemo(() => new Map(ranked.map(r => [keyOf(r.item), r])), [ranked])
  const groups = useMemo(() => [{ ...START_GROUP, items: ranked.map(r => r.item) }, ...groupQueue(queue.items)], [ranked, queue.items])
  const [selection, setSelection] = useState(() => selectionMemory)
  const remember = next => { selectionMemory = next; setSelection(next) }

  // Until the user picks a group, show the first one with rows (the order is the precedence).
  const firstFilled = groups.find(g => g.items.length > 0) || groups[0]
  const group = groups.find(g => g.id === selection.group) || firstFilled
  const items = group.items
  const found = selection.key ? items.findIndex(i => keyOf(i) === selection.key) : -1
  const idx = items.length === 0 ? 0 : Math.max(0, found)
  const focused = items[idx] || null
  const lines = useMemo(() => groupLines(group, ranked, staleDays), [group, ranked, staleDays])
  const cursor = focused ? lines.findIndex(l => l.kind === 'item' && l.item === focused) : 0

  // Pin the row under the cursor by identity once it is drawn, so a page or refresh that ranks rows
  // above it does not move the cursor to another PR.
  const focusedKey = focused ? keyOf(focused) : null
  useEffect(() => {
    if (focusedKey && selection.key !== focusedKey && found < 0) remember({ group: group.id, key: focusedKey })
  }, [focusedKey]) // eslint-disable-line react-hooks/exhaustive-deps

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
      case 'queue.scope': onCycleScope(); return
      case 'list.refresh': queue.refresh(); return
      case 'queue.more': queue.loadMore(); return
      case 'queue.open': if (focused && onOpen) { remember({ group: group.id, key: keyOf(focused) }); onOpen(focused) } return
      case 'queue.browser': if (focused?.identity?.url) openUrl(focused.identity.url); return
      default:
    }
  })

  // Chrome: title(1) + scope(1) + [chips(1)] + notes(1) + strip (rule + rank + signals + 2 why lines)
  const chrome = 8 + (wide ? 0 : 1)
  const rows = Math.max(3, (listHeight || 20) - chrome)
  const offset = Math.max(0, Math.min(cursor - Math.floor(rows / 2), lines.length - rows))
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
        <Text color={t.ui.muted}>{`No open pull request requests your review or was opened by you ${scope.kind === 'account' ? 'on' : `in ${sanitize(scope.label)} on`} ${sanitize(meta?.host || 'this host')}.`}</Text>
        <Text color={t.ui.muted}>{scopes.length > 1 ? `s changes the scope (next: ${sanitize(nextScope(scopes, scope.id).label)}); r checks again.` : 'Review requests from other repositories appear here as GitHub reports them; press r to check again.'}</Text>
      </Box>
    )
  } else if (items.length === 0) {
    body = <Text color={t.ui.muted}>{`Nothing in "${group.label}" among the ${queue.items.length} loaded. ] and [ switch group.`}</Text>
  } else {
    body = <Rows lines={lines} cursor={cursor} offset={offset} rows={rows} width={wide ? cols - SIDEBAR_WIDTH - 1 : cols} wide={wide} />
  }

  return (
    <Box flexDirection="column" flexGrow={1} paddingX={1} overflow="hidden">
      <Box height={1} overflow="hidden" justifyContent="space-between">
        <Text wrap="truncate">
          <Text color={t.ui.selected} bold>Review queue</Text>
          <Text color={t.ui.dim}>{`  ${meta ? `${scope.kind === 'account' ? `account @${sanitizePath(String(meta.account))}` : sanitize(scope.label)} · ${sanitize(meta.host)}` : 'loading'}`}</Text>
        </Text>
        <Text color={t.ui.dim} wrap="truncate">{queue.loading || queue.loadingMore ? '⟳ updating' : updated ? `⟳ updated ${updated}` : ''}</Text>
      </Box>
      <Box height={1} overflow="hidden">
        <Text color={t.ui.dim} wrap="truncate">{sanitize(scopeLine(scope, scopes, cols - 2))}</Text>
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
      <Box height={5} flexDirection="column" overflow="hidden" borderStyle="single" borderColor={t.ui.border} borderLeft={false} borderRight={false} borderBottom={false}>
        <Box height={1} overflow="hidden">
          <Text color={t.ui.muted} wrap="truncate">
            <Text color={t.ui.dim}>rank </Text>{focused && rankByKey.get(focusedKey) ? sanitize(rankLine(rankByKey.get(focusedKey), ranked.length, cols - 2 - WHY_PREFIX, displayWidth)) : rankOrderText(staleDays)}
          </Text>
        </Box>
        <Box height={1} overflow="hidden">
          <Text color={t.ui.muted} wrap="truncate">
            <Text color={t.ui.dim}>sig  </Text>{focused ? sanitize(signalLine(focused)) : ''}
          </Text>
        </Box>
        <Box height={2} overflow="hidden">
          <Text color={t.ui.muted} wrap="wrap">
            <Text color={t.ui.dim}>why  </Text>{focused ? sanitize(whyLine(focused, now, 2 * (cols - 2) - WHY_PREFIX - 4)) : 'select a row to see why it is here'}
          </Text>
        </Box>
      </Box>
    </Box>
  )
}
