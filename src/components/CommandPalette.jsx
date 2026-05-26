/**
 * CommandPalette.jsx — `:` command palette overlay.
 * Props:
 *   context  { pane, selectedItem, repo }
 *   onClose  ()
 *   onNavigate  ({ pane, view, itemNumber, filter })
 *   onTheme  (themeName)
 *   themes   string[]
 */

import React, { useState, useMemo } from 'react'
import { Box, Text, useInput } from 'ink'
import { useTheme } from '../theme.js'
import { useKeyScope } from '../keyscope.js'
import {
  mergePR, checkoutBranch, closePR, reviewPR,
  addLabels, removeLabels, requestReviewers,
} from '../executor.js'

// ─── Command registry ─────────────────────────────────────────────────────────
// Each command: { name, description, args?, needsPR?, fn(context, args) → Promise|void }

function buildCommands({ pane, selectedItem, repo, onNavigate, onTheme, themes, onClose }) {
  const pr = selectedItem
  const hasPR = pane === 'prs' && pr != null

  const cmds = []

  // Navigation
  cmds.push({
    name: 'goto pr',
    description: 'Go to PR by number  (e.g. :goto pr 42)',
    args: '<number>',
    fn: (_, args) => {
      const num = parseInt(args, 10)
      if (!isNaN(num)) onNavigate({ pane: 'prs', view: 'detail', itemNumber: num })
    },
  })
  cmds.push({
    name: 'goto issue',
    description: 'Go to issue by number  (e.g. :goto issue 17)',
    args: '<number>',
    fn: (_, args) => {
      const num = parseInt(args, 10)
      if (!isNaN(num)) onNavigate({ pane: 'issues', view: 'detail', itemNumber: num })
    },
  })

  // Filter
  for (const f of ['open', 'closed', 'merged', 'all']) {
    cmds.push({
      name: `filter ${f}`,
      description: `Filter ${pane === 'prs' ? 'PRs' : 'items'} to ${f}`,
      fn: () => onNavigate({ pane, filter: f }),
    })
  }

  // Theme
  for (const t of (themes || [])) {
    cmds.push({
      name: `theme ${t}`,
      description: `Switch to ${t} theme`,
      fn: () => onTheme(t),
    })
  }

  // PR-specific (only shown when a PR is selected)
  if (hasPR) {
    for (const strategy of ['merge', 'squash', 'rebase']) {
      cmds.push({
        name: `merge ${strategy}`,
        description: `Merge PR #${pr.number} via --${strategy}`,
        fn: () => mergePR(repo, pr.number, strategy),
      })
    }
    cmds.push({
      name: 'checkout',
      description: `Checkout branch ${pr.headRefName || ''}`,
      fn: () => checkoutBranch(repo, pr.number),
    })
    cmds.push({
      name: 'approve',
      description: `Approve PR #${pr.number}`,
      fn: () => reviewPR(repo, pr.number, 'APPROVE'),
    })
    cmds.push({
      name: 'close',
      description: `Close PR #${pr.number}`,
      fn: () => closePR(repo, pr.number),
    })
  }

  // Pane navigation
  for (const p of ['prs', 'issues', 'branches', 'actions', 'notifications']) {
    cmds.push({
      name: `pane ${p}`,
      description: `Switch to ${p} pane`,
      fn: () => onNavigate({ pane: p }),
    })
  }

  return cmds
}

// ─── Component ────────────────────────────────────────────────────────────────

export function CommandPalette({ context, onClose, onNavigate, onTheme, themes }) {
  useKeyScope('dialog')
  const { t } = useTheme()
  const [input, setInput] = useState('')
  const [cursor, setCursor] = useState(0)
  const [status, setStatus] = useState(null)

  const commands = useMemo(
    () => buildCommands({ ...context, onNavigate, onTheme, themes, onClose }),
    [context, onNavigate, onTheme, themes, onClose]
  )

  // Split input into command-prefix and trailing args
  const filtered = useMemo(() => {
    if (!input.trim()) return commands.slice(0, 8)
    const q = input.toLowerCase()
    return commands.filter(c => c.name.includes(q) || c.description.toLowerCase().includes(q)).slice(0, 8)
  }, [input, commands])

  useInput((raw, key) => {
    if (key.escape) { onClose(); return }
    if (key.upArrow) { setCursor(c => Math.max(0, c - 1)); return }
    if (key.downArrow) { setCursor(c => Math.min(filtered.length - 1, c + 1)); return }
    if (key.tab) {
      // Autocomplete command name into input
      if (filtered[cursor]) setInput(filtered[cursor].name + ' ')
      return
    }
    if (key.return) {
      const cmd = filtered[cursor]
      if (!cmd) return
      // Extract args = everything after the command name
      const argsPart = input.slice(cmd.name.length).trim()
      try {
        const result = cmd.fn(context, argsPart)
        if (result && typeof result.then === 'function') {
          setStatus('Running…')
          result
            .then(() => { setStatus('✓ Done'); setTimeout(onClose, 800) })
            .catch(err => { setStatus(`✗ ${err.message}`); setTimeout(onClose, 2000) })
        } else {
          onClose()
        }
      } catch (err) {
        setStatus(`✗ ${err.message}`)
        setTimeout(onClose, 2000)
      }
      return
    }
    if (key.backspace || key.delete) {
      setInput(s => s.slice(0, -1))
      setCursor(0)
      return
    }
    if (raw && !key.ctrl && !key.meta) {
      setInput(s => s + raw)
      setCursor(0)
    }
  })

  return (
    <Box flexDirection="column" borderStyle="double" borderColor={t.ui.selected} paddingX={1}>
      {/* Header + input */}
      <Box gap={1}>
        <Text color={t.ui.selected} bold>:</Text>
        <Text color={t.ui.selected}>{input}</Text>
        <Text color={t.ui.dim}>▍</Text>
        {status && <Text color={status.startsWith('✓') ? t.ci.pass : t.ci.fail}>{status}</Text>}
      </Box>

      {/* Command list */}
      {filtered.length > 0 && (
        <Box flexDirection="column">
          <Box><Text color={t.ui.dim}>{'─'.repeat(40)}</Text></Box>
          {filtered.map((cmd, i) => {
            const isCursor = i === cursor
            return (
              <Box key={cmd.name} gap={1}>
                <Text color={isCursor ? t.ui.selected : t.ui.muted}>{isCursor ? '▶' : ' '}</Text>
                <Text color={isCursor ? t.ui.selected : undefined} bold={isCursor} width={28}>
                  {cmd.name}{cmd.args ? ` ${cmd.args}` : ''}
                </Text>
                <Text color={t.ui.dim}>{cmd.description}</Text>
              </Box>
            )
          })}
        </Box>
      )}

      <Box marginTop={0}>
        <Text color={t.ui.dim}>[↑↓] nav  [Tab] complete  [Enter] run  [Esc] cancel</Text>
      </Box>
    </Box>
  )
}
