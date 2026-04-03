/**
 * src/features/prs/detail.jsx — PR detail pane
 * Scrollable view: j/k to scroll, gg/G top/bottom, / to search body
 */

import React, { useState, useContext, useMemo, useRef } from 'react'
import { Box, Text, useInput, useStdout } from 'ink'
import { format } from 'timeago.js'
import { useGh } from '../../hooks/useGh.js'
import {
  getPR, listLabels, listCollaborators, addLabels, removeLabels,
  getRepoInfo, getPRChecks, getBranchProtection,
  enableAutoMerge, disableAutoMerge, mergePR, closePR,
  markPRReady, convertPRToDraft, editPRBase,
  requestReviewers, removeReviewers,
  rerunCheckRun, getCheckRunAnnotations,
} from '../../executor.js'
import { MultiSelect } from '../../components/dialogs/MultiSelect.jsx'
import { OptionPicker } from '../../components/dialogs/OptionPicker.jsx'
import { ConfirmDialog } from '../../components/dialogs/ConfirmDialog.jsx'
import { LogViewer } from '../../components/dialogs/LogViewer.jsx'
import { AppContext } from '../../context.js'
import { useTheme } from '../../theme.js'
import { sanitize, getMarkdownRows, TextInput } from '../../utils.js'
import { Spinner } from '../../components/Spinner.jsx'
import { PRDetailSkeleton } from '../../components/Skeleton.jsx'
import { openInEditor, editorLabel } from '../../editor.js'
import { loadConfig } from '../../config.js'

const _editorCfg = loadConfig().editor

const MERGE_OPTIONS_BASE = [
  { value: 'merge',  label: '--merge',  description: 'Create a merge commit' },
  { value: 'squash', label: '--squash', description: 'Squash all commits into one' },
  { value: 'rebase', label: '--rebase', description: 'Rebase onto base branch' },
]
const MERGE_OPTIONS_ADMIN = [
  { value: 'admin-merge',  label: '--admin --merge',  description: 'Bypass branch protection + merge commit' },
  { value: 'admin-squash', label: '--admin --squash', description: 'Bypass branch protection + squash' },
  { value: 'admin-rebase', label: '--admin --rebase', description: 'Bypass branch protection + rebase' },
]

function reviewStatusIcon(state, t) {
  switch (state) {
    case 'APPROVED':          return { icon: '✓', color: t.ci.pass }
    case 'CHANGES_REQUESTED': return { icon: '✗', color: t.ci.fail }
    case 'COMMENTED':         return { icon: '●', color: t.ui.muted }
    default:                  return { icon: '○', color: t.ui.dim }
  }
}

function prStateBadge(pr, t) {
  if (pr.isDraft) return { icon: '⊘', color: t.pr.draft,   label: 'Draft'  }
  if (pr.state === 'OPEN' && pr.mergeable === 'CONFLICTING')
    return { icon: '●', color: t.pr.conflict || t.ci.pending, label: 'Conflict' }
  switch (pr.state) {
    case 'OPEN':   return { icon: '●', color: t.pr.open,   label: 'Open'   }
    case 'MERGED': return { icon: '●', color: t.pr.merged, label: 'Merged' }
    case 'CLOSED': return { icon: '●', color: t.pr.closed, label: 'Closed' }
    default:       return { icon: '●', color: t.ui.muted,  label: pr.state }
  }
}

// Build flat scrollable row array from PR data
function buildContentRows(pr, checks, protection, cols, t, checkCursor = null) {
  const rows = []
  const push = (id, el) => rows.push({ id, el })
  const sep  = (id) => push(id, <Box key={id} />)

  // ── Assignees / Labels ────────────────────────────────────────────────────
  if (pr.assignees?.length > 0 || pr.labels?.length > 0) {
    if (pr.assignees?.length > 0) {
      push('assignees', (
        <Box key="assignees" paddingX={1} gap={1}>
          <Text color={t.ui.dim}>Assigned</Text>
          {pr.assignees.map(a => (
            <Text key={a.login} color={t.ui.muted}>{a.login}</Text>
          ))}
        </Box>
      ))
    }
    if (pr.labels?.length > 0) {
      push('labels', (
        <Box key="labels" paddingX={1} gap={1}>
          {pr.labels.map(l => (
            <Box key={l.name} paddingX={1} borderStyle="round" borderColor={`#${l.color}`}>
              <Text color={`#${l.color}`}>{sanitize(l.name)}</Text>
            </Box>
          ))}
        </Box>
      ))
    }
    sep('sep-meta')
  }

  // ── Reviewers ─────────────────────────────────────────────────────────────
  // Deduplicate: last non-PENDING state wins per login; pending requests fill gaps
  const reviewStateMap = new Map()
  for (const r of (pr.reviews || [])) {
    if (r.author?.login) reviewStateMap.set(r.author.login, r.state)
  }
  for (const req of (pr.reviewRequests || [])) {
    const login = req.login || req.name
    if (login && !reviewStateMap.has(login)) reviewStateMap.set(login, 'PENDING')
  }
  const allReviewers = [...reviewStateMap.entries()].map(([login, state]) => ({ login, state }))
  if (allReviewers.length > 0) {
    push('rev-hdr', (
      <Box key="rev-hdr" paddingX={1}>
        <Text color={t.ui.dim} bold>Reviewers</Text>
      </Box>
    ))
    allReviewers.forEach(r => {
      const rs = reviewStatusIcon(r.state, t)
      push(`rev-${r.login}`, (
        <Box key={`rev-${r.login}`} paddingX={2} gap={1}>
          <Text color={rs.color}>{rs.icon}</Text>
          <Text color={t.ui.muted}>{r.login}</Text>
          {r.state !== 'PENDING' && (
            <Text color={rs.color} dimColor>{r.state.toLowerCase().replace(/_/g, ' ')}</Text>
          )}
        </Box>
      ))
    })
    sep('sep-rev')
  }

  // ── CI Checks ─────────────────────────────────────────────────────────────
  const rawChecks = (checks?.length > 0) ? checks : (pr.statusCheckRollup || [])
  // Sort: failing first, then pending, then passing/skipped
  const checkOrder = (c) => {
    const s = c.conclusion || c.status || c.state || ''
    if (/failure|error/i.test(s)) return 0
    if (/pending|in_progress|queued/i.test(s)) return 1
    if (/success/i.test(s)) return 2
    return 3
  }
  const allChecks = [...rawChecks].sort((a, b) => checkOrder(a) - checkOrder(b))
  if (allChecks.length > 0) {
    const passing = allChecks.filter(c => /success/i.test(c.conclusion || c.status || c.state || '')).length
    const failing = allChecks.filter(c => /failure|error/i.test(c.conclusion || c.status || c.state || '')).length
    const pending = allChecks.filter(c => /pending|in_progress|queued/i.test(c.conclusion || c.status || c.state || '')).length
    const skipped = allChecks.filter(c => /cancelled|skipped/i.test(c.conclusion || c.status || c.state || '')).length
    const checksActive = checkCursor !== null
    push('checks-hdr', (
      <Box key="checks-hdr" paddingX={1} gap={2}>
        <Text color={checksActive ? t.ui.selected : t.ui.dim} bold>Checks</Text>
        {passing > 0 && <Text color={t.ci.pass}>✓ {passing}</Text>}
        {failing > 0 && <Text color={t.ci.fail}>✗ {failing}</Text>}
        {pending > 0 && <Text color={t.ci.pending}>● {pending}</Text>}
        {skipped > 0 && <Text color={t.ui.dim}>⊘ {skipped}</Text>}
        {checksActive && <Text color={t.ui.dim}>[j/k] nav  [Enter/o] open  [R] rerun  [Esc] exit</Text>}
      </Box>
    ))
    allChecks.forEach((c, i) => {
      const status = c.conclusion || c.status || c.state || ''
      let icon, color
      if      (/success/i.test(status))                    { icon = '✓'; color = t.ci.pass }
      else if (/failure|error/i.test(status))              { icon = '✗'; color = t.ci.fail }
      else if (/pending|in_progress|queued/i.test(status)) { icon = '●'; color = t.ci.pending }
      else if (/cancelled|skipped/i.test(status))          { icon = '⊘'; color = t.ui.dim }
      else                                                  { icon = '○'; color = t.ui.dim }
      const name = (c.name || c.context || '').slice(0, 42)
      const isSelected = checksActive && checkCursor === i
      push(`check-${i}`, (
        <Box key={`check-${i}`} paddingX={2} gap={1} backgroundColor={isSelected ? t.ui.headerBg : undefined}>
          <Text color={color}>{icon}</Text>
          <Text color={isSelected ? t.ui.selected : t.ui.muted} wrap="truncate">{name}</Text>
          {isSelected && c.appName && <Text color={t.ui.dim}> ({c.appName})</Text>}
        </Box>
      ))
    })
    sep('sep-checks')
  }

  // ── Merge status ──────────────────────────────────────────────────────────
  const mergeItems = []
  if (pr.isDraft)                             mergeItems.push(<Text key="draft"    color={t.pr.draft}>⊘ Draft — not ready</Text>)
  if (pr.mergeable === 'CONFLICTING')         mergeItems.push(<Text key="conflict" color={t.ci.fail}>✗ Has conflicts</Text>)
  if (pr.mergeStateStatus === 'BLOCKED')      mergeItems.push(<Text key="blocked"  color={t.ci.fail}>✗ Blocked</Text>)
  if (pr.mergeStateStatus === 'BEHIND')       mergeItems.push(<Text key="behind"   color={t.ci.pending}>● Behind base</Text>)
  if (pr.mergeStateStatus === 'CLEAN')        mergeItems.push(<Text key="clean"    color={t.ci.pass}>✓ Ready to merge</Text>)
  if (pr.mergeStateStatus === 'UNSTABLE')     mergeItems.push(<Text key="unstable" color={t.ci.pending}>● Unstable</Text>)
  if (pr.mergeStateStatus === 'HAS_HOOKS')    mergeItems.push(<Text key="hooks"    color={t.ci.pass}>✓ Ready (hooks active)</Text>)
  if (pr.autoMergeRequest)                    mergeItems.push(
    <Text key="automerge" color={t.ci.pass}>⟳ Auto-merge on ({pr.autoMergeRequest.mergeMethod?.toLowerCase()})</Text>
  )
  push('merge-hdr', (
    <Box key="merge-hdr" paddingX={1} gap={2}>
      <Text color={t.ui.dim} bold>Merge</Text>
      {mergeItems}
    </Box>
  ))
  if (protection) {
    if (protection.requiredReviews > 0) {
      push('prot-reviews', (
        <Box key="prot-reviews" paddingX={2}>
          <Text color={t.ui.dim}>
            Requires {protection.requiredReviews} review{protection.requiredReviews > 1 ? 's' : ''}
            {protection.requireCodeOwnerReviews ? ' + CODEOWNERS' : ''}
          </Text>
        </Box>
      ))
    }
    if (protection.requireStatusChecks && protection.requiredChecks?.length > 0) {
      push('prot-checks', (
        <Box key="prot-checks" paddingX={2}>
          <Text color={t.ui.dim}>
            Required: {protection.requiredChecks.slice(0, 3).join(', ')}
            {protection.requiredChecks.length > 3 ? ` +${protection.requiredChecks.length - 3}` : ''}
          </Text>
        </Box>
      ))
    }
  }
  sep('sep-merge')

  // ── Description ───────────────────────────────────────────────────────────
  if (pr.body) {
    push('body-hdr', (
      <Box key="body-hdr" paddingX={1}>
        <Text color={t.ui.dim} bold>Description</Text>
      </Box>
    ))
    const mdRows = getMarkdownRows(pr.body, cols - 4, t)
    mdRows.forEach((row, i) => {
      push(`body-md-${i}`, row)
    })
  }

  return rows
}

export function PRDetail({ prNumber, repo, onBack, onOpenDiff, onOpenConflict, onOpenActions }) {
  const { t } = useTheme()
  const { notifyDialog } = useContext(AppContext)
  const { stdout } = useStdout()
  const cols    = stdout?.columns || 80
  const termRows = stdout?.rows    || 24

  const { data: pr, loading, error, refetch } = useGh(getPR, [repo, prNumber])
  const { data: repoInfo } = useGh(getRepoInfo, [repo], { ttl: 300_000 })
  const { data: checks }   = useGh(getPRChecks, [repo, prNumber], { ttl: 30_000 })
  const baseBranch = pr?.baseRefName || ''
  const { data: protection } = useGh(getBranchProtection, [repo, baseBranch], { ttl: 300_000 })

  const [scrollY, setScrollY] = useState(0)
  const [dialog, setDialog]   = useState(null)
  const [adminMergeMsg, setAdminMergeMsg] = useState('')
  const [searching, setSearching] = useState(false)
  const [searchText, setSearchText] = useState('')
  const [statusMsg, setStatusMsg] = useState(null)
  const [baseInput, setBaseInput] = useState('')
  const [checkCursor, setCheckCursor] = useState(null) // null = checks mode off, number = active
  const [checkLogLines, setCheckLogLines] = useState([])
  const [checkLogLoading, setCheckLogLoading] = useState(false)
  const lastKeyRef   = useRef(null)
  const lastKeyTimer = useRef(null)

  const showStatus = (msg, isError = false) => {
    setStatusMsg({ msg, isError, persist: isError })
    if (!isError) setTimeout(() => setStatusMsg(null), 3000)
  }

  React.useEffect(() => {
    notifyDialog(!!dialog)
    return () => notifyDialog(false)
  }, [dialog, notifyDialog])

  const contentRows = useMemo(
    () => pr ? buildContentRows(pr, checks, protection, cols, t, checkCursor) : [],
    [pr, checks, protection, cols, t, checkCursor]
  )

  // Sorted checks array (same ordering as in buildContentRows)
  const allChecksForNav = useMemo(() => {
    const raw = (checks?.length > 0) ? checks : (pr?.statusCheckRollup || [])
    const order = (c) => {
      const s = c.conclusion || c.status || c.state || ''
      if (/failure|error/i.test(s)) return 0
      if (/pending|in_progress|queued/i.test(s)) return 1
      if (/success/i.test(s)) return 2
      return 3
    }
    return [...raw].sort((a, b) => order(a) - order(b))
  }, [checks, pr])

  const filteredRows = useMemo(() => {
    if (!searchText) return contentRows
    const q = searchText.toLowerCase()
    return contentRows.filter(r => {
      if (!r.id.startsWith('body-')) return true
      // extract text from body row props
      const el = r.el
      const text = el?.props?.children?.props?.children
      if (typeof text === 'string') return text.toLowerCase().includes(q)
      return true
    })
  }, [contentRows, searchText])

  // Fixed header takes 3 rows, hint line 1, so content window is rows - 3 - 1 - 2(statusbar+footer)
  const visibleHeight = Math.max(3, termRows - 8)
  const maxScroll     = Math.max(0, filteredRows.length - visibleHeight)
  const visibleRows   = filteredRows.slice(scrollY, scrollY + visibleHeight)

  const openCheckInBrowser = (check) => {
    if (!check?.url) return
    import('execa').then(({ execa }) => {
      const cmd = process.platform === 'darwin' ? 'open' : 'xdg-open'
      execa(cmd, [check.url]).catch(() => {})
    })
  }

  const openCheckLogs = async (check) => {
    if (!check?.id) {
      openCheckInBrowser(check)
      return
    }
    setCheckLogLoading(true)
    setDialog('check-logs')
    try {
      const annotations = await getCheckRunAnnotations(repo, check.id)
      if (!annotations || annotations.length === 0) {
        // No annotations — fall back to opening in browser
        setDialog(null)
        setCheckLogLoading(false)
        openCheckInBrowser(check)
        return
      }
      const lines = annotations.map(a => {
        const loc = a.path ? `${a.path}:${a.line || '?'}` : ''
        const title = a.title ? `[${a.title}] ` : ''
        return `${a.level?.toUpperCase() || 'NOTE'} ${title}${loc}\n  ${a.message || ''}`
      }).join('\n').split('\n')
      setCheckLogLines(lines)
    } catch (err) {
      setCheckLogLines([`Error loading annotations: ${err.message}`])
    }
    setCheckLogLoading(false)
  }

  useInput((input, key) => {
    // Dismiss persistent error on any keypress
    if (statusMsg?.persist) { setStatusMsg(null); return }

    // Search mode captures all typing
    if (searching) {
      if (key.escape) { setSearching(false); setSearchText(''); return }
      if (key.return) { setSearching(false); return }
      if (key.backspace || key.delete) { setSearchText(s => s.slice(0, -1)); return }
      if (input && !key.ctrl && !key.meta) { setSearchText(s => s + input); return }
      return
    }

    if (dialog === 'base') {
      if (key.escape) { setDialog(null); setBaseInput(''); return }
      return
    }
    if (dialog) return

    // ── Checks navigation mode ─────────────────────────────────────────────
    if (checkCursor !== null) {
      if (key.escape) { setCheckCursor(null); return }
      if (input === 'j' || key.downArrow) {
        setCheckCursor(c => Math.min(allChecksForNav.length - 1, c + 1))
        return
      }
      if (input === 'k' || key.upArrow) {
        setCheckCursor(c => Math.max(0, c - 1))
        return
      }
      if ((key.return || input === 'o') && allChecksForNav[checkCursor]) {
        openCheckInBrowser(allChecksForNav[checkCursor])
        return
      }
      if (input === 'l' && allChecksForNav[checkCursor]) {
        openCheckLogs(allChecksForNav[checkCursor])
        return
      }
      if (input === 'R' && allChecksForNav[checkCursor]?.id) {
        const c = allChecksForNav[checkCursor]
        rerunCheckRun(repo, c.id)
          .then(() => showStatus(`↺ Re-run triggered for ${c.name}`))
          .catch(err => showStatus(`✗ Re-run failed: ${err.message}`, true))
        return
      }
      return
    }

    if (input === 'r') { refetch(); return }
    if (input === 'd' && pr) { onOpenDiff(pr); return }

    // E — open first changed file of this PR in the local editor
    if (input === 'E' && pr) {
      const files = pr.files || []
      if (files.length > 0) {
        openInEditor(files[0].path, 1, _editorCfg).catch(() => {})
      }
      return
    }

    if (input === 'l') { setDialog('labels'); return }
    if (input === 'A') { setDialog('assignees'); return }
    if (input === 'R' && pr && pr.state === 'OPEN') { setDialog('reviewers'); return }
    if (input === 'C' && pr && pr.state === 'OPEN' && pr.mergeable === 'CONFLICTING' && onOpenConflict) {
      onOpenConflict()
      return
    }
    // C on non-conflicting PR → jump to Actions pane filtered to this branch
    if (input === 'C' && pr && onOpenActions && pr.mergeable !== 'CONFLICTING') {
      onOpenActions(pr.headRefName)
      return
    }
    // c (lowercase) — enter checks navigation mode
    if (input === 'c' && allChecksForNav.length > 0) {
      // Start at first failing check, or 0
      const firstFailing = allChecksForNav.findIndex(c => /failure|error/i.test(c.conclusion || c.status || c.state || ''))
      setCheckCursor(firstFailing >= 0 ? firstFailing : 0)
      return
    }
    if (input === '/') { setSearching(true); setSearchText(''); return }
    if (input === 'm' && pr && pr.state === 'OPEN') { setDialog('merge'); return }
    if (input === 'X' && pr && pr.state === 'OPEN') { setDialog('close'); return }
    if (input === 'D' && pr && pr.state === 'OPEN') { setDialog('draft'); return }
    if (input === 'B' && pr && pr.state === 'OPEN') { setDialog('base'); return }
    if (input === 'M' && pr && pr.state === 'OPEN' && !pr.isDraft) {
      if (pr.autoMergeRequest) {
        disableAutoMerge(repo, prNumber)
          .then(() => { showStatus('✓ Auto-merge disabled'); refetch() })
          .catch(err => showStatus(`✗ Auto-merge failed: ${err.message}`, true))
      } else {
        enableAutoMerge(repo, prNumber, repoInfo?.squashMergeAllowed ? 'squash' : 'merge')
          .then(() => { showStatus('⟳ Auto-merge enabled'); refetch() })
          .catch(err => showStatus(`✗ Auto-merge failed: ${err.message}`, true))
      }
      return
    }
    // If a search filter is active, Esc clears it first (second Esc exits)
    if ((key.escape || input === 'q') && searchText) { setSearchText(''); setScrollY(0); return }
    if (key.escape || input === 'q') { onBack(); return }

    // gg → top
    if (input === 'g') {
      if (lastKeyRef.current === 'g') {
        clearTimeout(lastKeyTimer.current)
        lastKeyRef.current = null
        setScrollY(0)
        return
      }
      lastKeyRef.current = 'g'
      lastKeyTimer.current = setTimeout(() => { lastKeyRef.current = null }, 400)
      return
    }
    lastKeyRef.current = null

    if (input === 'G') { setScrollY(maxScroll); return }
    if (input === 'j' || key.downArrow) { setScrollY(s => Math.min(maxScroll, s + 1)); return }
    if (input === 'k' || key.upArrow)   { setScrollY(s => Math.max(0, s - 1)); return }
  })

  // ── Loading / Error ────────────────────────────────────────────────────────

  if (loading) {
    return <PRDetailSkeleton />
  }

  if (error) {
    return (
      <Box flexDirection="column" flexGrow={1} paddingX={2} paddingY={1}>
        <Text color={t.ci.fail}>⚠ Failed to load — [r] retry</Text>
        <Text color={t.ui.dim} dimColor>{error.message}</Text>
      </Box>
    )
  }

  if (!pr) return null

  // ── Dialogs ────────────────────────────────────────────────────────────────

  if (dialog === 'merge') {
    // Show admin options when confirmed admin, or while repoInfo is still loading
    const mergeOpts = !repoInfo || repoInfo.viewerPermission === 'ADMIN'
      ? [...MERGE_OPTIONS_BASE, ...MERGE_OPTIONS_ADMIN]
      : MERGE_OPTIONS_BASE
    return (
      <OptionPicker
        title={`Merge PR #${pr.number}: ${pr.title}`}
        options={mergeOpts}
        promptText="Commit message (optional)"
        onSubmit={(val) => {
          const strategy = typeof val === 'object' ? val.value : val
          const msg = typeof val === 'object' ? val.text : undefined
          setDialog(null)
          mergePR(repo, pr.number, strategy, msg)
            .then(() => refetch())
            .catch(err => showStatus(`✗ Merge failed: ${err.message}`, true))
        }}
        onCancel={() => setDialog(null)}
      />
    )
  }

  if (dialog === 'close') {
    return (
      <ConfirmDialog
        message={`Close PR #${pr.number}: ${pr.title}?`}
        destructive={true}
        onConfirm={async () => {
          setDialog(null)
          try { await closePR(repo, pr.number); refetch() }
          catch (err) { showStatus(`✗ Close failed: ${err.message}`, true) }
        }}
        onCancel={() => setDialog(null)}
      />
    )
  }

  if (dialog === 'draft') {
    const DRAFT_OPTIONS = pr.isDraft
      ? [{ value: 'ready', label: 'Mark ready for review', description: 'Remove draft status' }]
      : [
          { value: 'ready', label: 'Mark ready for review', description: 'Remove draft status' },
          { value: 'draft', label: 'Convert to draft', description: 'Mark as work in progress' },
        ]
    return (
      <OptionPicker
        title={`PR #${pr.number}: Change draft state`}
        options={DRAFT_OPTIONS}
        onSubmit={async (val) => {
          const action = typeof val === 'object' ? val.value : val
          setDialog(null)
          try {
            if (action === 'ready') await markPRReady(repo, pr.number)
            else await convertPRToDraft(repo, pr.number)
            showStatus(action === 'ready' ? '✓ Marked ready for review' : '✓ Converted to draft')
            refetch()
          } catch (err) { showStatus(`✗ Failed: ${err.message}`, true) }
        }}
        onCancel={() => setDialog(null)}
      />
    )
  }

  if (dialog === 'base') {
    return (
      <Box flexDirection="column" flexGrow={1} paddingX={2} paddingY={1}>
        <Text color={t.ui.selected} bold>Change base branch</Text>
        <Text color={t.ui.dim}>Current: {pr.baseRefName}</Text>
        <Box marginTop={1} gap={1}>
          <Text color={t.ui.muted}>New base: </Text>
          <TextInput
            value={baseInput}
            onChange={setBaseInput}
            placeholder={pr.baseRefName}
            focus={true}
            onEnter={async () => {
              const newBase = baseInput.trim()
              if (!newBase || newBase === pr.baseRefName) { setDialog(null); return }
              setDialog(null)
              try {
                await editPRBase(repo, pr.number, newBase)
                showStatus(`✓ Base branch changed to ${newBase}`)
                refetch()
              } catch (err) { showStatus(`✗ Failed: ${err.message}`, true) }
            }}
          />
        </Box>
        <Text color={t.ui.dim} marginTop={1}>[Enter] confirm  [Esc] cancel</Text>
      </Box>
    )
  }

  if (dialog === 'labels') {
    return <PRLabelDialog repo={repo} pr={pr} onClose={() => { setDialog(null); refetch() }} onError={(msg) => { setDialog(null); showStatus(msg, true) }} />
  }

  if (dialog === 'assignees') {
    return <PRAssigneeDialog repo={repo} pr={pr} onClose={() => { setDialog(null); refetch() }} onError={(msg) => { setDialog(null); showStatus(msg, true) }} />
  }

  if (dialog === 'reviewers') {
    return <PRReviewerDialog repo={repo} pr={pr} onClose={() => { setDialog(null); refetch() }} onError={(msg) => { setDialog(null); showStatus(msg, true) }} />
  }

  if (dialog === 'check-logs') {
    if (checkLogLoading) {
      return (
        <Box flexDirection="column" flexGrow={1} paddingX={1}>
          <Box gap={1}><Spinner /><Text color={t.ui.muted}>Loading annotations…</Text></Box>
        </Box>
      )
    }
    return (
      <LogViewer
        lines={checkLogLines}
        onClose={() => setDialog(null)}
      />
    )
  }

  // ── Detail view ────────────────────────────────────────────────────────────

  const badge = prStateBadge(pr, t)

  return (
    <Box flexDirection="column" flexGrow={1}>

      {/* ── Fixed title header ── */}
      <Box flexDirection="column" paddingX={1} paddingY={0}
        borderStyle="single" borderColor={t.ui.border}
        borderTop={false} borderLeft={false} borderRight={false} borderBottom={true}>
        <Box gap={1}>
          <Text color={badge.color} bold>{badge.icon}</Text>
          <Text color={t.ui.dim}>#{pr.number}</Text>
          <Text bold color={t.ui.selected} wrap="truncate">{sanitize(pr.title)}</Text>
        </Box>
        <Box gap={1}>
          <Text color={t.ui.muted}>{pr.author?.login}</Text>
          <Text color={t.ui.dim}>·</Text>
          <Text color={t.ui.dim}>{format(pr.updatedAt)}</Text>
          <Text color={t.ui.dim}>·</Text>
          <Text color={t.ui.muted}>{pr.baseRefName}</Text>
          <Text color={t.ui.dim}>←</Text>
          <Text color={t.ui.selected}>{pr.headRefName}</Text>
          <Text color={t.ui.dim}>·</Text>
          <Text color={t.ci.pass}>+{pr.additions || 0}</Text>
          <Text color={t.ci.fail}>-{pr.deletions || 0}</Text>
          <Text color={t.ui.dim}>{pr.changedFiles || 0} files</Text>
        </Box>
      </Box>

      {/* ── Search bar ── */}
      {(searching || searchText) && (
        <Box paddingX={1} gap={1}>
          <Text color={t.ui.dim}>/</Text>
          <Text color={t.ui.selected}>{searchText}</Text>
          {searching && <Text color={t.ui.dim}>█  [Enter] apply  [Esc] cancel</Text>}
          {!searching && searchText && (
            <Text color={t.ui.dim}>  [/] edit  [Esc / q] clear filter</Text>
          )}
        </Box>
      )}

      {/* ── Scrollable content ── */}
      <Box flexDirection="column" flexGrow={1} overflow="hidden">
        {visibleRows.map(row => row.el)}
      </Box>

      {/* ── Hint line ── */}
      <Box paddingX={1} justifyContent="space-between">
        {statusMsg
          ? <Text color={statusMsg.isError ? t.ci.fail : t.ci.pass}>{statusMsg.msg}{statusMsg.persist ? '  [any key to dismiss]' : ''}</Text>
          : checkCursor !== null
            ? <Text color={t.ui.selected}>[j/k] nav checks  [Enter/o] open  [l] annotations  [R] rerun  [Esc] exit checks</Text>
            : maxScroll > 0
              ? <Text color={t.ui.dim}>{scrollY + 1}–{Math.min(scrollY + visibleHeight, filteredRows.length)} / {filteredRows.length}  [j/k] scroll  [gg/G] top/bottom</Text>
              : pr?.mergeable === 'CONFLICTING'
                ? <Text color={t.pr.conflict || t.ci.pending}>[C] resolve conflicts  [c] checks  [d] diff  [m] merge  [l] labels  [A] assignees  [R] reviewers</Text>
                : <Text color={t.ui.dim}>[d] diff  [E] editor  [m] merge  [M] auto-merge  [c] checks  [l] labels  [A] assignees  [R] reviewers</Text>
        }
        <Text color={t.ui.dim}>[/] search  [?] help  [Esc] back</Text>
      </Box>
    </Box>
  )
}

// ─── Sub-dialogs ──────────────────────────────────────────────────────────────

function PRLabelDialog({ repo, pr, onClose, onError }) {
  const { t } = useTheme()
  const { data: allLabels, loading } = useGh(listLabels, [repo])
  if (loading) return <Box paddingX={1}><Text color={t.ui.muted}>Loading labels…</Text></Box>

  const items = (allLabels || []).map(l => ({
    id: l.name,
    name: l.name,
    color: l.color,
    selected: pr.labels?.some(pl => pl.name === l.name) ?? false,
  }))

  return (
    <MultiSelect
      items={items}
      onSubmit={async (selectedIds) => {
        const current = pr.labels?.map(l => l.name) || []
        const toAdd    = selectedIds.filter(id => !current.includes(id))
        const toRemove = current.filter(id => !selectedIds.includes(id))
        try {
          if (toAdd.length)    await addLabels(repo, pr.number, toAdd, 'pr')
          if (toRemove.length) await removeLabels(repo, pr.number, toRemove, 'pr')
        } catch (err) { onError?.(`✗ Label update failed: ${err.message}`) }
        onClose()
      }}
      onCancel={onClose}
    />
  )
}

function PRAssigneeDialog({ repo, pr, onClose, onError }) {
  const { t } = useTheme()
  const { data: collabs, loading } = useGh(listCollaborators, [repo])
  if (loading) return <Box paddingX={1}><Text color={t.ui.muted}>Loading collaborators…</Text></Box>

  const items = (collabs || []).map(c => ({
    id: c.login,
    name: c.login,
    selected: pr.assignees?.some(a => a.login === c.login) ?? false,
  }))

  return (
    <MultiSelect
      items={items}
      onSubmit={async (selectedIds) => {
        try {
          const { execa } = await import('execa')
          if (selectedIds.length > 0) {
            await execa('gh', ['pr', 'edit', String(pr.number), '--repo', repo,
              '--add-assignee', selectedIds.join(',')])
          }
        } catch (err) { onError?.(`✗ Assignee update failed: ${err.message}`) }
        onClose()
      }}
      onCancel={onClose}
    />
  )
}

function PRReviewerDialog({ repo, pr, onClose, onError }) {
  const { t } = useTheme()
  const { data: collabs, loading } = useGh(listCollaborators, [repo])
  if (loading) return <Box paddingX={1}><Text color={t.ui.muted}>Loading collaborators…</Text></Box>

  // Current pending review requests (not yet reviewed)
  const currentRequested = new Set(
    (pr.reviewRequests || []).map(r => r.login || r.name).filter(Boolean)
  )

  const items = (collabs || []).map(c => ({
    id: c.login,
    name: c.login,
    selected: currentRequested.has(c.login),
  }))

  return (
    <MultiSelect
      title="Request Reviewers"
      items={items}
      onSubmit={async (selectedIds) => {
        const current = [...currentRequested]
        const toAdd    = selectedIds.filter(id => !current.includes(id))
        const toRemove = current.filter(id => !selectedIds.includes(id))
        try {
          if (toAdd.length)    await requestReviewers(repo, pr.number, toAdd)
          if (toRemove.length) await removeReviewers(repo, pr.number, toRemove)
        } catch (err) { onError?.(`✗ Reviewer update failed: ${err.message}`) }
        onClose()
      }}
      onCancel={onClose}
    />
  )
}
