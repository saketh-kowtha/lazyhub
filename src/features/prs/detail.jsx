// @ts-nocheck
// TODO(#197): PR detail view has legacy Ink prop inference noise pending typed props.
/**
 * src/features/prs/detail.jsx — PR detail controller, navigation and dialogs
 * Scrollable view: j/k to scroll, gg/G top/bottom, / to search body
 */

import React, { useState, useContext, useMemo, useRef } from 'react'
import { Box, Text, useStdout } from 'ink'
import { useActionResolver, useKeymapInput } from '../../config/keymap.js'
import { useGh } from '../../hooks/useGh.js'
import {
  getPR,
  getRepoInfo, getPRChecks, getBranchProtection,
  enableAutoMerge, disableAutoMerge, mergePR, closePR,
  markPRReady, convertPRToDraft, editPRBase,
  reviewPR,
  rerunCheckRun, getCheckRunAnnotations,
} from '../../executor.js'
import { OptionPicker } from '../../components/dialogs/OptionPicker.jsx'
import { ConfirmDialog } from '../../components/dialogs/ConfirmDialog.jsx'
import { FormCompose } from '../../components/dialogs/FormCompose.jsx'
import { LogViewer } from '../../components/dialogs/LogViewer.jsx'
import { AppContext } from '../../context.js'
import { useKeyScope } from '../../keyscope.js'
import { useTheme } from '../../theme.js'
import { sanitize, TextInput } from '../../utils.js'
import { Spinner } from '../../components/Spinner.jsx'
import { FailureNotice } from '../../components/FailureNotice.jsx'
import { classifyGhFailure } from '../../executor.js'
import { PRDetailSkeleton } from '../../components/Skeleton.jsx'
import { openInEditor, editorLabel } from '../../editor.js'
import { loadConfig } from '../../config.js'
import { firstActionKey } from '../../config/actions.js'

import { usePendingWrite } from '../../hooks/usePendingWrite.js'
import { autoMergeOption, canToggleAutoMergeFromList, allowedMergeOptions, mergeMethodLabel } from './list-row.jsx'
import { LabelDialog, AssigneeDialog, ReviewerDialog } from './list-dialogs.jsx'
import { PRDetailHeader } from './detail/Header.jsx'
import { buildContentRows } from './detail/content-rows.jsx'
import { sortChecks } from './detail/Checks.jsx'

const _editorCfg = loadConfig().editor

const MERGE_OPTIONS_ADMIN = [
  { value: 'admin-merge',  label: mergeMethodLabel('admin-merge'),  description: 'Administrator override: merge even though protection rules are not met' },
  { value: 'admin-squash', label: mergeMethodLabel('admin-squash'), description: 'Administrator override: squash even though protection rules are not met' },
  { value: 'admin-rebase', label: mergeMethodLabel('admin-rebase'), description: 'Administrator override: rebase even though protection rules are not met' },
]

export function PRDetail({ prNumber, repo, baseRefName: rowBaseRefName, onBack, onOpenDiff, onOpenConflict, onOpenActions, onViewComments, onPaneState }) {
  useKeyScope('view')
  const { t } = useTheme()
  const { notifyDialog } = useContext(AppContext)
  const { stdout } = useStdout()
  const cols    = stdout?.columns || 80
  const termRows = stdout?.rows    || 24

  const { data: pr, loading, error, refetch } = useGh(getPR, [repo, prNumber])
  const { data: repoInfo } = useGh(getRepoInfo, [repo], { ttl: 300_000 })
  const { data: checks }   = useGh(getPRChecks, [repo, prNumber], { ttl: 30_000 })
  // The list row already knows the base branch: ask for protection now instead of after getPR (#452).
  const baseBranch = pr?.baseRefName || rowBaseRefName || ''
  const { data: protection } = useGh(getBranchProtection, [repo, baseBranch], { ttl: 300_000 })

  const [scrollY, setScrollY] = useState(0)
  const [dialog, setDialog]   = useState(null)
  const [adminMergeMsg, setAdminMergeMsg] = useState('')
  const [rerunCheck, setRerunCheck] = useState(null) // check awaiting re-run confirmation
  const [searching, setSearching] = useState(false)
  const [searchText, setSearchText] = useState('')
  // Typed characters (search text, base branch) must never trigger actions.
  useKeyScope('input', searching || dialog === 'base')
  const resolveAction = useActionResolver(['global', 'pr-detail'])
  const resolveChecksAction = useActionResolver(['pr-checks'])
  const [statusMsg, setStatusMsg] = useState(null)
  const [baseInput, setBaseInput] = useState('')
  const [checkCursor, setCheckCursor] = useState(null) // null = checks mode off, number = active
  const checkCursorRef = useRef(null)
  const [checkLogLines, setCheckLogLines] = useState([])
  const [checkLogLoading, setCheckLogLoading] = useState(false)

  const showStatus = (msg, isError = false, sticky = false) => {
    setStatusMsg({ msg, isError, persist: isError })
    if (!isError && !sticky) setTimeout(() => setStatusMsg(null), 3000)
  }
  const { run: runWrite } = usePendingWrite((msg) => showStatus(msg, false, true))

  React.useEffect(() => {
    notifyDialog(!!dialog)
    return () => notifyDialog(false)
  }, [dialog, notifyDialog])

  const contentRows = useMemo(
    () => pr ? buildContentRows(pr, checks, protection, cols, t, checkCursor) : [],
    [pr, checks, protection, cols, t, checkCursor]
  )

  const allChecksForNav = useMemo(() => sortChecks(checks, pr), [checks, pr])

  // Tell the footer which actions can run for this PR (registry preconditions).
  const hasChecks = allChecksForNav.length > 0
  React.useEffect(() => {
    if (!onPaneState || !pr) return undefined
    onPaneState({ actionCtx: { prOpen: pr.state === 'OPEN', isDraft: !!pr.isDraft, hasChecks } })
    return () => onPaneState({ actionCtx: undefined })
  }, [onPaneState, pr?.state, pr?.isDraft, hasChecks]) // eslint-disable-line react-hooks/exhaustive-deps

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

  useKeymapInput((input, key) => {
    if (statusMsg?.persist) { setStatusMsg(null) }

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
    const activeCheckCursor = checkCursor ?? checkCursorRef.current
    if (activeCheckCursor !== null) {
      const id = resolveChecksAction(input, key)
      const check = allChecksForNav[activeCheckCursor]
      if (id === 'check.exit') { checkCursorRef.current = null; setCheckCursor(null); return }
      if (id === 'cursor.down') {
        setCheckCursor(c => {
          const next = Math.min(allChecksForNav.length - 1, c + 1)
          checkCursorRef.current = next
          return next
        })
        return
      }
      if (id === 'cursor.up') {
        setCheckCursor(c => {
          const next = Math.max(0, c - 1)
          checkCursorRef.current = next
          return next
        })
        return
      }
      if (id === 'check.open-browser' && check) { openCheckInBrowser(check); return }
      if (id === 'check.log' && check) { openCheckLogs(check); return }
      if (id === 'check.rerun' && check?.id) { setRerunCheck(check); setDialog('rerun-check'); return }
      return
    }

    const id = resolveAction(input, key)
    const open = pr && pr.state === 'OPEN'

    if (id === 'list.refresh') { refetch(); return }
    if (id === 'pr.diff' && pr) { onOpenDiff(pr); return }
    if (id === 'pr.comments' && onViewComments) { onViewComments(); return }
    if (id === 'pr.open-browser' && pr?.url) {
      import('execa').then(({ execa }) => {
        const cmd = process.platform === 'darwin' ? 'open' : 'xdg-open'
        execa(cmd, [pr.url]).catch(() => {})
      })
      return
    }
    if (id === 'pr.approve' && open) { setDialog('approve-body'); return }
    if (id === 'pr.request-changes' && open) { setDialog('reqchanges-body'); return }

    // open the first changed file of this PR in the local editor
    if (id === 'pr.open-editor' && pr) {
      const files = pr.files || []
      if (files.length > 0) {
        openInEditor(files[0].path, 1, _editorCfg).catch(() => {})
      }
      return
    }

    if (id === 'pr.labels') { setDialog('labels'); return }
    if (id === 'pr.assignees') { setDialog('assignees'); return }
    if (id === 'pr.reviewers' && open) { setDialog('reviewers'); return }
    if (id === 'pr.conflicts' && open && onOpenConflict && pr.mergeable === 'CONFLICTING') {
      onOpenConflict()
      return
    }
    // on a clean PR → jump to Actions pane filtered to this branch
    if (id === 'pr.conflicts' && pr && onOpenActions && pr.mergeable === 'MERGEABLE') {
      onOpenActions(pr.headRefName)
      return
    }
    // enter checks navigation mode
    if (id === 'pr.checks') {
      if (allChecksForNav.length === 0) {
        showStatus('No CI checks for this PR')
        return
      }
      // Start at first failing check, or 0
      const firstFailing = allChecksForNav.findIndex(c => /failure|error/i.test(c.conclusion || c.status || c.state || ''))
      const startIdx = firstFailing >= 0 ? firstFailing : 0
      checkCursorRef.current = startIdx
      setCheckCursor(startIdx)
      // Scroll to checks section
      const checksRow = filteredRows.findIndex(r => r.id === 'checks-hdr')
      if (checksRow >= 0) setScrollY(Math.min(checksRow, maxScroll))
      return
    }
    if (id === 'list.search') { setSearching(true); setSearchText(''); return }
    if (id === 'pr.merge' && open) { setDialog('merge'); return }
    if (id === 'pr.close' && open) { setDialog('close'); return }
    if (id === 'pr.draft' && open) { setDialog('draft'); return }
    if (id === 'pr.base' && open) { setDialog('base'); return }
    if (id === 'pr.auto-merge' && open && !pr.isDraft) { setDialog('auto-merge'); return }
    // If a search filter is active, Esc clears it first (second Esc exits)
    if (id === 'app.back' && searchText) { setSearchText(''); setScrollY(0); return }
    if (id === 'app.back') { onBack(); return }

    if (id === 'cursor.top') { setScrollY(0); return }
    if (id === 'cursor.bottom') { setScrollY(maxScroll); return }
    if (id === 'cursor.down') { setScrollY(s => Math.min(maxScroll, s + 1)); return }
    if (id === 'cursor.up')   { setScrollY(s => Math.max(0, s - 1)); return }
  })

  // ── Loading / Error ────────────────────────────────────────────────────────

  if (loading) {
    return <PRDetailSkeleton />
  }

  if (error) {
    return (
      <Box flexDirection="column" flexGrow={1} paddingX={2} paddingY={1}>
        <FailureNotice failure={classifyGhFailure(error)} />
        <Text color={t.ui.dim}>[{firstActionKey('list.refresh', 'r')}] retry</Text>
      </Box>
    )
  }

  if (!pr) return null

  // ── Dialogs ────────────────────────────────────────────────────────────────

  if (dialog === 'merge') {
    // Show admin options when confirmed admin, or while repoInfo is still loading
    // The first allowed method is the default, so `m` then Enter merges it (the footer names the action).
    const methods = allowedMergeOptions(repoInfo)
    const baseOpts = canToggleAutoMergeFromList(pr) ? [...methods, autoMergeOption(pr)] : methods
    const mergeOpts = !repoInfo || repoInfo.viewerPermission === 'ADMIN'
      ? [...baseOpts, ...MERGE_OPTIONS_ADMIN]
      : baseOpts
    return (
      <OptionPicker
        title={`Merge PR #${pr.number}: ${sanitize(pr.title)}`}
        options={mergeOpts}
        promptText="Commit message (optional, Enter to skip)"
        promptKey="e"
        onSubmit={(val) => {
          const strategy = typeof val === 'object' ? val.value : val
          const msg = typeof val === 'object' ? val.text : undefined
          if (strategy === 'auto-merge') { setDialog('auto-merge'); return }
          setDialog(null)
          runWrite(`Merging #${pr.number}`, () => mergePR(repo, pr.number, strategy, msg, { allowAdmin: strategy.startsWith('admin-') })
            // Two-argument then: a refetch problem after a successful merge must not read as "Merge failed".
            .then(() => { showStatus(`✓ Merged PR #${pr.number}`); refetch() }, err => showStatus(`✗ Merge failed: ${sanitize(err.message)}`, true)))
        }}
        onCancel={() => setDialog(null)}
      />
    )
  }

  if (dialog === 'rerun-check' && rerunCheck) {
    return (
      <ConfirmDialog
        message={`Re-run check ${sanitize(rerunCheck.name || String(rerunCheck.id))}?`}
        onConfirm={() => {
          const check = rerunCheck
          setDialog(null)
          runWrite(`Re-running ${check.name}`, () => rerunCheckRun(repo, check.id)
            .then(() => showStatus(`↺ Re-run triggered for ${check.name}`))
            .catch(err => showStatus(`✗ Re-run failed: ${err.message}`, true)))
        }}
        onCancel={() => setDialog(null)}
      />
    )
  }

  if (dialog === 'auto-merge' && pr) {
    const disabling = !!pr.autoMergeRequest
    return (
      <ConfirmDialog
        message={`${disabling ? 'Disable' : 'Enable'} auto-merge on PR #${pr.number}: ${sanitize(pr.title)}?`}
        onConfirm={() => {
          setDialog(null)
          const request = () => disabling
            ? disableAutoMerge(repo, prNumber)
            : enableAutoMerge(repo, prNumber, repoInfo?.squashMergeAllowed ? 'squash' : 'merge')
          runWrite(`${disabling ? 'Disabling' : 'Enabling'} auto-merge on #${pr.number}`, () => request()
            .then(() => { showStatus(disabling ? '✓ Auto-merge disabled' : '⟳ Auto-merge enabled'); refetch() })
            .catch(err => { showStatus(`✗ Auto-merge failed: ${sanitize(err.message)}`, true); refetch() }))
        }}
        onCancel={() => setDialog(null)}
      />
    )
  }

  if (dialog === 'close') {
    return (
      <ConfirmDialog
        message={`Close PR #${pr.number}: ${sanitize(pr.title)}?`}
        destructive={true}
        onConfirm={async () => {
          setDialog(null)
          await runWrite(`Closing #${pr.number}`, async () => {
            try { await closePR(repo, pr.number); showStatus(`✓ Closed PR #${pr.number}`); refetch() }
            catch (err) { showStatus(`✗ Close failed: ${err.message}`, true) }
          })
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
          await runWrite(`Updating #${pr.number}`, async () => {
            try {
              if (action === 'ready') await markPRReady(repo, pr.number)
              else await convertPRToDraft(repo, pr.number)
              showStatus(action === 'ready' ? '✓ Marked ready for review' : '✓ Converted to draft')
              refetch()
            } catch (err) { showStatus(`✗ Failed: ${err.message}`, true) }
          })
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
              await runWrite(`Changing base of #${pr.number}`, async () => {
                try {
                  await editPRBase(repo, pr.number, newBase)
                  showStatus(`✓ Base branch changed to ${newBase}`)
                  refetch()
                } catch (err) { showStatus(`✗ Failed: ${err.message}`, true) }
              })
            }}
          />
        </Box>
        <Box marginTop={1}>
          <Text color={t.ui.dim}>[Enter] confirm  [Esc] cancel</Text>
        </Box>
      </Box>
    )
  }

  if (dialog === 'approve-body') {
    return (
      <FormCompose
        title={`Approve PR #${pr.number}`}
        fields={[{ name: 'body', label: 'Comment (optional)', type: 'text' }]}
        onSubmit={async (values) => {
          setDialog(null)
          await runWrite(`Approving #${pr.number}`, async () => {
            try {
              await reviewPR(repo, pr.number, 'approve', values.body || '')
              showStatus(`✓ Approved PR #${pr.number}`)
            } catch (err) { showStatus(`✗ ${err.message}`, true) }
          })
        }}
        onCancel={() => setDialog(null)}
      />
    )
  }

  if (dialog === 'reqchanges-body') {
    return (
      <FormCompose
        title={`Request changes on PR #${pr.number}`}
        fields={[{ name: 'body', label: 'Describe the changes needed', type: 'text' }]}
        onSubmit={async (values) => {
          setDialog(null)
          await runWrite(`Requesting changes on #${pr.number}`, async () => {
            try {
              await reviewPR(repo, pr.number, 'request-changes', values.body)
              showStatus(`✓ Requested changes on PR #${pr.number}`)
            } catch (err) { showStatus(`✗ ${err.message}`, true) }
          })
        }}
        onCancel={() => setDialog(null)}
      />
    )
  }

  if (dialog === 'labels') {
    return <LabelDialog repo={repo} pr={pr} runWrite={runWrite} onClose={() => { setDialog(null); refetch() }} onError={(err) => { setDialog(null); showStatus(`✗ Label update failed: ${sanitize(err.message)}`, true) }} />
  }

  if (dialog === 'assignees') {
    return <AssigneeDialog repo={repo} pr={pr} runWrite={runWrite} onClose={() => { setDialog(null); refetch() }} onError={(err) => { setDialog(null); showStatus(`✗ Assignee update failed: ${sanitize(err.message)}`, true) }} />
  }

  if (dialog === 'reviewers') {
    return <ReviewerDialog repo={repo} pr={pr} runWrite={runWrite} onClose={() => { setDialog(null); refetch() }} onError={(err) => { setDialog(null); showStatus(`✗ Reviewer update failed: ${sanitize(err.message)}`, true) }} />
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

  return (
    <Box flexDirection="column" flexGrow={1}>

      {loading && <Box paddingX={1}><Text color={t.ui.muted}>refreshing…</Text></Box>}

      {/* ── Fixed title header ── */}
      <PRDetailHeader pr={pr} />

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
                : <Text color={t.ui.dim}>[d] diff  [E] editor  [m] merge/auto-merge  [c] checks  [l] labels  [A] assignees  [R] reviewers</Text>
        }
        <Text color={t.ui.dim}>[/] search  [?] help  [Esc] back</Text>
      </Box>
    </Box>
  )
}
