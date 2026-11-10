/**
 * src/features/branches/index.jsx — Branch list pane
 */

import { logSwallowed } from '../../contain.js'
import React, { useState, useCallback, useMemo, useEffect, useRef, memo } from 'react'
import { currentBranch as gitCurrentBranch, findLocalCheckout, noLocalCheckoutMessage } from '../../services/git.js'
import { Box, Text, useStdout } from 'ink'
import { useKeymapInput } from '../../config/keymap.js'
import { useGh } from '../../hooks/useGh.js'
import { useListController } from '../../hooks/useListController.js'
import { useMutation } from '../../hooks/useMutation.js'
import { listBranches, listOpenPRBranches } from '../../executor.js'
import { ghQueryKey } from '../../data/ghKeys.js'
import { deleteBranchMutation, pushBranchMutation, checkoutBranchMutation, createBranchMutation } from '../../data/mutations/branches.js'
import { QueryBoundary } from '../../components/QueryBoundary.jsx'
import { MutationStatus } from '../../components/MutationStatus.jsx'
import { ListRow } from '../../ui/ListRow.jsx'
import { ConfirmDialog } from '../../components/dialogs/ConfirmDialog.jsx'
import { FuzzySearch } from '../../components/dialogs/FuzzySearch.jsx'
import { useKeyScope } from '../../keyscope.js'
import { useTheme } from '../../theme.js'
import { TextInput, sanitize, sanitizePath } from '../../utils.js'
import { fitCell, paneWidth } from '../../ui/row-layout.js'
import { logger } from '../../utils-core.js'
import { BranchListSkeleton } from '../../components/Skeleton.jsx'
import { matchesAction } from '../../config/actions.js'

// One line per branch, never wider than the pane (#495): the markers and badges keep their
// columns and only the name is cut.
const BranchRow = memo(({ branch, isSelected, isCurrent, hasPR, width }) => {
  const { t } = useTheme()
  const lock = branch.protected ? 3 : 0
  const pr = hasPR ? 3 : 0
  const nameWidth = Math.max(4, width - 2 - 2 - (isCurrent ? 2 : 0) - lock - pr)
  return (
    <ListRow selected={isSelected}>
      <Text> </Text>
      {isCurrent && <Text color={isSelected ? t.ui.selected : undefined} bold>► </Text>}
      <Text color={isSelected ? t.ui.selected : undefined} bold={isSelected || isCurrent}>{fitCell(sanitizePath(branch.name), nameWidth)}</Text>
      {branch.protected && <Text color={isSelected ? t.ui.selected : t.ui.muted}> 🔒</Text>}
      {hasPR && <Text color={isSelected ? t.ui.selected : t.ui.muted} bold> PR</Text>}
    </ListRow>
  )
})

export function BranchList({ repo, listHeight = 10, innerWidth, onPaneState }) {
  useKeyScope('pane')
  const { t } = useTheme()
  const { stdout } = useStdout()
  const rowWidth = paneWidth(innerWidth, stdout)
  const visibleHeight = listHeight || Math.max(5, (stdout?.rows || 24) - 8)

  const query = useGh(listBranches, [repo])
  const { data: branches, loading, error, refetch, isStale } = query
  // Slim head-branch list for the PR marker only (#456), not the full PR list.
  const { data: prHeads } = useGh(listOpenPRBranches, [repo], { ttl: 120_000 })
  const openPRHeads = useMemo(() => new Set(Array.isArray(prHeads?.heads) ? prHeads.heads : []), [prHeads])
  const prMarkersTruncated = !!prHeads?.truncated
  useEffect(() => {
    if (prMarkersTruncated) logger.warn(`branches: open-PR walk for ${repo} hit its page ceiling; PR markers may be incomplete`)
  }, [prMarkersTruncated, repo])
  const [currentBranch, setCurrentBranch] = useState(null)
  // Local git only ever runs in a checkout of the repo being viewed (#471).
  // undefined = still resolving, null = no local checkout of `repo`, else { dir, remote }
  // where `remote` is the remote that points at `repo` (not always origin in a fork clone).
  const [local, setLocal] = useState(/** @type {{ dir: string, remote: string } | null | undefined} */ (undefined))
  useEffect(() => {
    let live = true
    setLocal(undefined)
    findLocalCheckout(repo).then(found => { if (live) setLocal(found) })
    return () => { live = false }
  }, [repo])
  const localDir = local === undefined ? undefined : (local?.dir ?? null)

  const refreshCurrentBranch = useCallback(() => {
    if (!localDir) { setCurrentBranch(null); return }
    gitCurrentBranch(localDir).then(setCurrentBranch).catch(err => logSwallowed('branches.current-branch', err))
  }, [localDir])

  useEffect(() => { refreshCurrentBranch() }, [refreshCurrentBranch])
  const [dialog, setDialog] = useState(null)
  const [newBranchName, setNewBranchName] = useState('')

  const items = branches || []
  const list = useListController({ items, height: visibleHeight, getId: b => b.name })

  useEffect(() => {
    if (onPaneState) onPaneState({ loading, error, count: items.length, isStale })
  }, [loading, error, items.length, isStale]) // eslint-disable-line react-hooks/exhaustive-deps

  useKeyScope('dialog', !!dialog)
  useEffect(() => {
    if (onPaneState) onPaneState({ dialogHint: dialog || null })
    return () => { if (onPaneState) onPaneState({ dialogHint: null }) }
  }, [dialog]) // eslint-disable-line react-hooks/exhaustive-deps

  // Every write runs through one useMutation (#453): pending line, double-submit guard,
  // sticky failure. `op` is { label, success, run, failPrefix? }.
  const del = useMutation(deleteBranchMutation(repo, ghQueryKey(listBranches, [repo])))
  const push = useMutation(pushBranchMutation)
  const checkout = useMutation(checkoutBranchMutation, { onSuccess: () => refreshCurrentBranch() })
  const create = useMutation(createBranchMutation, { onSuccess: () => refreshCurrentBranch() })
  const writes = [del, push, checkout, create]
  // Non-write notices ("no local checkout", "already on"): transient, errors stick until a key.
  const [notice, setNotice] = useState(/** @type {{ msg: string, isError: boolean, persist: boolean } | null} */ (null))
  const noticeTimer = useRef(/** @type {ReturnType<typeof setTimeout> | undefined} */ (undefined))
  useEffect(() => () => clearTimeout(noticeTimer.current), [])
  const showNotice = (msg, isError = false) => {
    clearTimeout(noticeTimer.current)
    setNotice({ msg, isError, persist: isError })
    if (!isError) noticeTimer.current = setTimeout(() => setNotice(null), 3000)
  }
  const status = writes.find(w => w.status)?.status || notice
  const dismissStatus = () => { for (const w of writes) w.dismiss(); setNotice(null) }

  const selectedBranch = list.selected

  // Local actions need a checkout of `repo`; otherwise say why they are off.
  const requireLocal = () => {
    if (localDir) return true
    showNotice(localDir === undefined
      ? 'Checking for a local checkout…'
      : noLocalCheckoutMessage(sanitize(repo)), localDir === null)
    return false
  }

  const hasOpenPR = !!selectedBranch && openPRHeads.has(selectedBranch.name)

  useKeymapInput((input, key) => {
    if (status?.persist) { dismissStatus(); return }
    if (dialog === 'new-branch') {
      if (key.escape) { setDialog(null); setNewBranchName(''); return }
      return
    }
    if (dialog) return
    if (list.handleKey(input, key)) return
    if (matchesAction('list.refresh', input, key)) { refetch(); return }
    if (matchesAction('list.search', input, key)) { setDialog('fuzzy'); return }
    if (matchesAction('branch.new', input, key)) { if (requireLocal()) { setNewBranchName(''); setDialog('new-branch') } return }

    if (loading || items.length === 0) return

    if (matchesAction('branch.checkout', input, key)) {
      if (selectedBranch && requireLocal()) {
        if (selectedBranch.name === currentBranch) {
          showNotice(`Already on "${sanitizePath(selectedBranch.name)}"`)
          return
        }
        setDialog('checkout')
      }
      return
    }

    if (matchesAction('branch.delete', input, key)) {
      if (selectedBranch) setDialog('delete')
      return
    }

    if (matchesAction('branch.push', input, key)) {
      // Push current branch
      if (!requireLocal()) return
      push.mutate({ dir: localDir, remote: local.remote })
      return
    }
  })

  if (dialog === 'fuzzy') {
    return (
      <Box flexDirection="column" flexGrow={1}>
        <FuzzySearch
          items={items.map(b => ({ ...b, title: sanitizePath(b.name) }))}
          searchFields={['name', 'title']}
          onSubmit={(item) => {
            const idx = items.findIndex(b => b.name === item.name)
            if (idx !== -1) list.moveTo(idx)
            setDialog(null)
          }}
          onCancel={() => setDialog(null)}
        />
      </Box>
    )
  }

  if (dialog === 'checkout' && selectedBranch) {
    return (
      <Box flexDirection="column" flexGrow={1}>
        <ConfirmDialog
          message={`Checkout branch "${sanitizePath(selectedBranch.name)}"?`}
          destructive={false}
          onConfirm={() => {
            setDialog(null)
            const name = sanitizePath(selectedBranch.name)
            checkout.mutate({ local, name: selectedBranch.name, display: name })
          }}
          onCancel={() => setDialog(null)}
        />
      </Box>
    )
  }

  if (dialog === 'delete' && selectedBranch) {
    const msg = hasOpenPR
      ? `⚠ Branch "${sanitizePath(selectedBranch.name)}" has an open PR! Delete remote branch anyway?`
      : `Delete remote branch "${sanitizePath(selectedBranch.name)}"? (local branch unaffected)`
    return (
      <Box flexDirection="column" flexGrow={1}>
        <ConfirmDialog
          message={msg}
          destructive={true}
          requireText={sanitizePath(selectedBranch.name)}
          onConfirm={() => {
            setDialog(null)
            const name = sanitizePath(selectedBranch.name)
            del.mutate({ name: selectedBranch.name, display: name })
          }}
          onCancel={() => setDialog(null)}
        />
      </Box>
    )
  }

  if (dialog === 'new-branch') {
    return (
      <Box flexDirection="column" flexGrow={1} paddingX={2} paddingY={1}>
        <Text color={t.ui.selected} bold>Create new branch</Text>
        <Box marginTop={1} gap={1}>
          <Text color={t.ui.muted}>Name: </Text>
          <TextInput
            value={newBranchName}
            onChange={setNewBranchName}
            placeholder="branch-name"
            focus={true}
            onEnter={async () => {
              const name = newBranchName.trim()
              if (!name) { setDialog(null); return }
              if (/[\s~^:?*\[\\]|\.\.|\.$|^-|\.lock$/.test(name)) {
                showNotice(`Invalid branch name: "${name}"`, true)
                setDialog(null)
                return
              }
              setDialog(null)
              create.mutate({ dir: localDir, name })
            }}
          />
        </Box>
        <Box marginTop={1}>
          <Text color={t.ui.dim}>[Enter] create  [Esc] cancel</Text>
        </Box>
      </Box>
    )
  }

  return (
    <Box flexDirection="column" flexGrow={1}>
      {prMarkersTruncated && (
        <Box paddingX={1}><Text color={t.ui.dim}>PR markers may be incomplete: only the first 5,000 open PRs were checked</Text></Box>
      )}
      <MutationStatus status={status} />
      <Box flexDirection="column" flexGrow={1}>
        <QueryBoundary
          query={query}
          skeleton={<BranchListSkeleton count={visibleHeight} />}
          empty="No branches found."
        >
          {() => list.visibleItems.map((branch, i) => (
            <BranchRow
              key={branch.name}
              branch={branch}
              isSelected={list.scrollOffset + i === list.cursor}
              isCurrent={!!currentBranch && branch.name === currentBranch}
              hasPR={openPRHeads.has(branch.name)}
              width={rowWidth}
            />
          ))}
        </QueryBoundary>
      </Box>
    </Box>
  )
}
