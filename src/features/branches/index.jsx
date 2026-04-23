/**
 * src/features/branches/index.jsx — Branch list pane
 */

import React, { useState, useCallback, useEffect, useContext, useRef, memo } from 'react'
import { Box, Text, useInput, useStdout } from 'ink'
import { useGh } from '../../hooks/useGh.js'
import { listBranches, deleteBranch, listPRs } from '../../executor.js'
import { ConfirmDialog } from '../../components/dialogs/ConfirmDialog.jsx'
import { FuzzySearch } from '../../components/dialogs/FuzzySearch.jsx'
import { AppContext } from '../../context.js'
import { useTheme } from '../../theme.js'
import { TextInput } from '../../utils.js'
import { BranchListSkeleton } from '../../components/Skeleton.jsx'

const BranchRow = memo(({ branch, isSelected, isCurrent, hasPR, t }) => {
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
})

export function BranchList({ repo, listHeight = 10, onPaneState }) {
  const { t } = useTheme()
  const { notifyDialog } = useContext(AppContext)
  const { stdout } = useStdout()
  const visibleHeight = listHeight || Math.max(5, (stdout?.rows || 24) - 8)

  const { data: branches, loading, error, refetch } = useGh(listBranches, [repo])
  const { data: prs } = useGh(listPRs, [repo, { state: 'open', limit: 100 }], { ttl: 120_000 })
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
  const [newBranchName, setNewBranchName] = useState('')
  const lastKeyRef   = useRef(null)
  const lastKeyTimer = useRef(null)

  const items = branches || []

  useEffect(() => {
    if (onPaneState) onPaneState({ loading, error, count: items.length })
  }, [loading, error, items.length]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    notifyDialog(!!dialog)
    return () => notifyDialog(false)
  }, [dialog, notifyDialog])

  useEffect(() => () => { clearTimeout(lastKeyTimer.current) }, [])

  const showStatus = (msg, isError = false) => {
    setStatusMsg({ msg, isError, persist: isError })
    if (!isError) setTimeout(() => setStatusMsg(null), 3000)
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
    if (statusMsg?.persist) { setStatusMsg(null); return }
    if (dialog === 'new-branch') {
      if (key.escape) { setDialog(null); setNewBranchName(''); return }
      return
    }
    if (dialog) return
    if (input === 'j' || key.downArrow) { moveCursor(1); return }
    if (input === 'k' || key.upArrow)  { moveCursor(-1); return }
    if (input === 'r') { refetch(); return }
    if (input === '/') { setDialog('fuzzy'); return }
    if (input === 'n') { setNewBranchName(''); setDialog('new-branch'); return }

    // gg → top
    if (input === 'g') {
      if (lastKeyRef.current === 'g') {
        clearTimeout(lastKeyTimer.current)
        lastKeyRef.current = null
        setCursor(0); setScrollOffset(0)
        return
      }
      lastKeyRef.current = 'g'
      lastKeyTimer.current = setTimeout(() => { lastKeyRef.current = null }, 400)
      return
    }
    lastKeyRef.current = null

    // G → bottom
    if (input === 'G') {
      if (items.length > 0) {
        const last = items.length - 1
        setCursor(last); setScrollOffset(Math.max(0, last - visibleHeight + 1))
      }
      return
    }

    if (loading || items.length === 0) return

    if (input === ' ' || key.return) {
      if (selectedBranch) {
        if (selectedBranch.name === currentBranch) {
          showStatus(`Already on "${selectedBranch.name}"`)
          return
        }
        setDialog('checkout')
      }
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
    return (
      <Box flexDirection="column" flexGrow={1}>
        <ConfirmDialog
          message={`Checkout branch "${selectedBranch.name}"?`}
          destructive={false}
          onConfirm={async () => {
            setDialog(null)
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
      ? `⚠ Branch "${selectedBranch.name}" has an open PR! Delete remote branch anyway?`
      : `Delete remote branch "${selectedBranch.name}"? (local branch unaffected)`
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
                showStatus(`Invalid branch name: "${name}"`, true)
                setDialog(null)
                return
              }
              setDialog(null)
              try {
                const { execa } = await import('execa')
                await execa('git', ['checkout', '-b', name], { cwd: process.cwd() })
                showStatus(`✓ Created and checked out ${name}`)
                refetch()
              } catch (err) { showStatus(`Failed: ${err.message}`, true) }
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
      {statusMsg && (
        <Box paddingX={1}>
          <Text color={statusMsg.isError ? t.ci.fail : t.ci.pass}>{statusMsg.msg}{statusMsg.persist ? ' [any key]' : ''}</Text>
        </Box>
      )}
      <Box flexDirection="column" flexGrow={1}>
        {loading && items.length === 0 && (
          <BranchListSkeleton count={visibleHeight} />
        )}
        {visibleBranches.map((branch, i) => {
          const idx = scrollOffset + i
          const isSelected = idx === cursor
          const hasPR = (prs || []).some(pr => pr.headRefName === branch.name && pr.state === 'OPEN')
          const isCurrent = currentBranch && branch.name === currentBranch
          return (
            <BranchRow
              key={branch.name}
              branch={branch}
              isSelected={isSelected}
              isCurrent={isCurrent}
              hasPR={hasPR}
              t={t}
            />
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
