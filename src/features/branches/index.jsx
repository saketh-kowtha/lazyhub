/**
 * src/features/branches/index.jsx — Branch list pane
 */

import React, { useState, useCallback, useEffect, useContext } from 'react'
import { Box, Text, useInput, useStdout } from 'ink'
import { useGh } from '../../hooks/useGh.js'
import { listBranches, deleteBranch, listPRs } from '../../executor.js'
import { ConfirmDialog } from '../../components/dialogs/ConfirmDialog.jsx'
import { FuzzySearch } from '../../components/dialogs/FuzzySearch.jsx'
import { AppContext } from '../../context.js'
import { t } from '../../theme.js'

export function BranchList({ repo, listHeight = 10, onPaneState }) {
  const { notifyDialog } = useContext(AppContext)
  const { stdout } = useStdout()
  const visibleHeight = listHeight || Math.max(5, (stdout?.rows || 24) - 8)

  const { data: branches, loading, error, refetch } = useGh(listBranches, [repo])
  const { data: prs } = useGh(listPRs, [repo])
  const [currentBranch, setCurrentBranch] = useState(null)

  useEffect(() => {
    import('execa').then(({ execa }) => {
      execa('git', ['branch', '--show-current'], { cwd: process.cwd() })
        .then(result => setCurrentBranch(result.stdout.trim()))
        .catch(() => {})
    })
  }, [])
  const [cursor, setCursor] = useState(0)
  const [scrollOffset, setScrollOffset] = useState(0)
  const [dialog, setDialog] = useState(null)
  const [statusMsg, setStatusMsg] = useState(null)

  const items = branches || []

  useEffect(() => {
    if (onPaneState) onPaneState({ loading, error, count: items.length })
  }, [loading, error, items.length]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    notifyDialog(!!dialog)
    return () => notifyDialog(false)
  }, [dialog, notifyDialog])

  const showStatus = (msg, isError = false) => {
    setStatusMsg({ msg, isError })
    setTimeout(() => setStatusMsg(null), 3000)
  }

  const moveCursor = useCallback((delta) => {
    setCursor(prev => {
      const next = Math.max(0, Math.min(items.length - 1, prev + delta))
      if (next < scrollOffset) setScrollOffset(next)
      if (next >= scrollOffset + visibleHeight) setScrollOffset(next - visibleHeight + 1)
      return next
    })
  }, [items.length, scrollOffset, visibleHeight])

  const selectedBranch = items[cursor]

  const hasOpenPR = selectedBranch && (prs || []).some(
    pr => pr.headRefName === selectedBranch.name && pr.state === 'OPEN'
  )

  useInput((input, key) => {
    if (dialog) return
    if (input === 'j' || key.downArrow) { moveCursor(1); return }
    if (input === 'k' || key.upArrow)  { moveCursor(-1); return }
    if (input === 'r') { refetch(); return }
    if (input === '/') { setDialog('fuzzy'); return }
    if (loading || items.length === 0) return

    if (input === ' ' || key.return) {
      if (selectedBranch) setDialog('checkout')
      return
    }

    if (input === 'D') {
      if (selectedBranch) setDialog('delete')
      return
    }

    if (input === 'p') {
      // Push current branch
      import('execa').then(({ execa }) => {
        execa('git', ['push', 'origin', 'HEAD'], { cwd: process.cwd() })
          .then(() => showStatus('Pushed'))
          .catch(err => showStatus(`Push failed: ${err.message}`, true))
      })
      return
    }
  })

  const visibleBranches = items.slice(scrollOffset, scrollOffset + visibleHeight)

  if (dialog === 'fuzzy') {
    return (
      <Box flexDirection="column" flexGrow={1}>
        <FuzzySearch
          items={items.map(b => ({ ...b, title: b.name }))}
          searchFields={['name', 'title']}
          onSubmit={(item) => {
            const idx = items.findIndex(b => b.name === item.name)
            if (idx !== -1) { setCursor(idx); setScrollOffset(Math.max(0, idx - 2)) }
            setDialog(null)
          }}
          onCancel={() => setDialog(null)}
        />
      </Box>
    )
  }

  if (dialog === 'checkout' && selectedBranch) {
    const isCurrent = selectedBranch.name === currentBranch
    return (
      <Box flexDirection="column" flexGrow={1}>
        <ConfirmDialog
          message={isCurrent
            ? `"${selectedBranch.name}" is already your current branch.`
            : `Checkout branch "${selectedBranch.name}"?`}
          destructive={false}
          onConfirm={async () => {
            setDialog(null)
            if (isCurrent) return
            try {
              const { execa } = await import('execa')
              await execa('git', ['checkout', selectedBranch.name], { cwd: process.cwd() })
              showStatus(`✓ Checked out ${selectedBranch.name}`)
            } catch (err) {
              showStatus(`Failed: ${err.message}`, true)
            }
          }}
          onCancel={() => setDialog(null)}
        />
      </Box>
    )
  }

  if (dialog === 'delete' && selectedBranch) {
    const msg = hasOpenPR
      ? `⚠ Branch "${selectedBranch.name}" has an open PR! Delete anyway?`
      : `Delete branch "${selectedBranch.name}"?`
    return (
      <Box flexDirection="column" flexGrow={1}>
        <ConfirmDialog
          message={msg}
          destructive={true}
          requireText={selectedBranch.name}
          onConfirm={async () => {
            setDialog(null)
            try {
              await deleteBranch(repo, selectedBranch.name)
              showStatus(`Deleted ${selectedBranch.name}`)
              refetch()
            } catch (err) {
              showStatus(`Failed: ${err.message}`, true)
            }
          }}
          onCancel={() => setDialog(null)}
        />
      </Box>
    )
  }

  return (
    <Box flexDirection="column" flexGrow={1}>
      {statusMsg && (
        <Box paddingX={1}>
          <Text color={statusMsg.isError ? t.ci.fail : t.ci.pass}>{statusMsg.msg}</Text>
        </Box>
      )}
      <Box flexDirection="column" flexGrow={1}>
        {visibleBranches.map((branch, i) => {
          const idx = scrollOffset + i
          const isSelected = idx === cursor
          const hasPR = (prs || []).some(pr => pr.headRefName === branch.name && pr.state === 'OPEN')
          const isCurrent = currentBranch && branch.name === currentBranch
          return (
            <Box key={branch.name} paddingX={1} backgroundColor={isSelected ? t.ui.headerBg : undefined}>
              <Text color={isSelected ? t.ui.selected : t.ui.muted}>
                {isSelected ? '▶ ' : '  '}
              </Text>
              {isCurrent && (
                <Text color={t.pr.open}>► </Text>
              )}
              <Text color={isSelected ? t.ui.selected : undefined} wrap="truncate" flexGrow={1}>
                {branch.name}
              </Text>
              {typeof branch.aheadBy === 'number' && typeof branch.behindBy === 'number' && (
                <Text color={t.ui.dim}> ↑{branch.aheadBy} ↓{branch.behindBy}</Text>
              )}
              {branch.protected && <Text color={t.ci.pending}> 🔒</Text>}
              {hasPR && <Text color={t.pr.open}> PR</Text>}
            </Box>
          )
        })}
        {!loading && items.length === 0 && (
          <Box paddingX={2} paddingY={1}>
            <Text color={t.ui.muted}>No branches found. [r] refresh</Text>
          </Box>
        )}
      </Box>
    </Box>
  )
}
