/**
 * app.jsx — root Ink layout + renderApp() entry point.
 *
 * Layout (≥100 cols):
 *   ┌─ sidebar 18 ─┐┌─ list (flex) ──────────────────┐┌─ detail 40 ─┐
 *   │              ││                                 ││             │
 *   └──────────────┘└─────────────────────────────────┘└─────────────┘
 *     status bar (1 row)
 *     footer keys (1 row)
 *
 * Layout (<100 cols, ≥80):  sidebar + list only
 * Layout (<80 cols):        list only (sidebar replaced by tab header)
 */

import React, { useState, useRef, useCallback, useEffect } from 'react'
import { render, Box, Text, useInput, useApp, useStdout } from 'ink'
import { ThemeProvider, useTheme, readRawThemeCfg } from './theme.js'
import { KeyScopeProvider, useActiveScope, useKeyScope } from './keyscope.js'
import { loadConfig, CONFIG_PATH } from './config.js'
import { useLayout } from './hooks/useLayout.js'
import { AppContext } from './context.js'
import { logger } from './utils.js'
import { emitIPC, startIPC } from './ipc.js'
import { Sidebar } from './components/Sidebar.jsx'
import { TabStrip } from './components/TabStrip.jsx'
import { Toaster } from './components/Toaster.jsx'
import { StatusBar } from './components/StatusBar.jsx'
import { FooterKeys } from './components/FooterKeys.jsx'
import { PRList } from './features/prs/list.jsx'
import { PRDetail } from './features/prs/detail.jsx'
import { PRDiff } from './features/prs/diff.jsx'
import { PRComments } from './features/prs/comments.jsx'
import { ConflictView } from './features/prs/ConflictView.jsx'
import { IssueList } from './features/issues/list.jsx'
import { IssueDetail } from './features/issues/detail.jsx'
import { BranchList } from './features/branches/index.jsx'
import { ActionList } from './features/actions/index.jsx'
import { SettingsPane } from './features/settings/index.jsx'
import { LogPane } from './features/logs/index.jsx'
import { NotificationList } from './features/notifications/index.jsx'
import { CustomPane } from './components/CustomPane.jsx'
import { ErrorBoundary } from './components/ErrorBoundary.jsx'
import { AIAssistant } from './components/AIAssistant.jsx'
import { CommandPalette } from './components/CommandPalette.jsx'
import { openInEditor } from './editor.js'
import { THEME_NAMES } from './theme.js'

const _config = loadConfig()

// ─── Pane registry ───────────────────────────────────────────────────────────

const PANES = _config.panes

const BUILTIN_PANE_LABELS = {
  prs:           'Pull Requests',
  issues:        'Issues',
  branches:      'Branches',
  actions:       'Actions',
  notifications: 'Notifications',
}

const BUILTIN_PANE_ICONS = {
  prs:           '⎇',
  issues:        '◎',
  branches:      '⑂',
  actions:       '⚡',
  notifications: '◈',
}


// Merge built-in + custom so label/icon lookups work uniformly
const PANE_LABELS = { ...BUILTIN_PANE_LABELS }
const PANE_ICONS  = { ...BUILTIN_PANE_ICONS }
for (const [id, def] of Object.entries(_config.customPanes || {})) {
  PANE_LABELS[id] = def.label
  PANE_ICONS[id]  = def.icon
}

// ─── Keyboard reference — shown by ? in every view ───────────────────────────

const GLOBAL_KEYS = [
  { key: 'Ctrl+A',           label: 'AI assistant' },
  { key: 'Tab / Shift+Tab', label: 'cycle panes forward / back' },
  { key: 'r',               label: 'refresh (bypass cache)' },
  { key: 'o',               label: 'open current item in browser' },
  { key: '/',               label: 'fuzzy search current list' },
  { key: '?',               label: 'toggle this help overlay' },
  { key: 'S',               label: 'settings' },
  { key: 'q / Esc',         label: 'back one level / quit at root' },
]

// Per-pane keys shown when view === 'list'
const PANE_KEYS = {
  prs: [
    { key: 'j / k  ↑↓',     label: 'navigate rows' },
    { key: 'gg / G',         label: 'jump to top / bottom' },
    { key: 'Enter',          label: 'open PR detail' },
    { key: 'd',              label: 'open diff view' },
    { key: 'f',              label: 'cycle filter: open → closed → merged' },
    { key: 'm',              label: 'merge  (pick --merge/--squash/--rebase)' },
    { key: 'a',              label: 'approve PR' },
    { key: 'x',              label: 'request changes' },
    { key: 'l',              label: 'edit labels' },
    { key: 'A',              label: 'edit assignees' },
    { key: 'R',              label: 'request reviewers' },
    { key: 'c',              label: 'checkout branch locally' },
    { key: 'y',              label: 'copy PR URL to clipboard' },
    { key: 'o',              label: 'open in browser' },
  ],
  issues: [
    { key: 'j / k  ↑↓',     label: 'navigate rows' },
    { key: 'gg / G',         label: 'jump to top / bottom' },
    { key: 'Enter',          label: 'open issue detail' },
    { key: 'f',              label: 'cycle filter: open → closed' },
    { key: 'n',              label: 'create new issue' },
    { key: 'x',              label: 'close issue (confirm dialog)' },
    { key: 'l',              label: 'edit labels' },
    { key: 'A',              label: 'edit assignees' },
    { key: 'y',              label: 'copy issue URL to clipboard' },
    { key: 'o',              label: 'open in browser' },
  ],
  branches: [
    { key: 'j / k  ↑↓',     label: 'navigate rows' },
    { key: 'gg / G',         label: 'jump to top / bottom' },
    { key: 'Space / Enter',  label: 'checkout branch' },
    { key: 'n',              label: 'create new branch (prompt)' },
    { key: 'D',              label: 'delete branch (confirm dialog)' },
    { key: 'p',              label: 'push current branch' },
  ],
  actions: [
    { key: 'j / k  ↑↓',     label: 'navigate rows' },
    { key: 'gg / G',         label: 'jump to top / bottom' },
    { key: 'Enter / l',      label: 'open log viewer' },
    { key: 'R',              label: 're-run failed jobs' },
    { key: 'X',              label: 'cancel run (confirm dialog)' },
  ],
  notifications: [
    { key: 'j / k  ↑↓',     label: 'navigate rows' },
    { key: 'gg / G',         label: 'jump to top / bottom' },
    { key: 'Enter',          label: 'open notification (routes to correct pane)' },
    { key: 'm',              label: 'mark current as read' },
    { key: 'M',              label: 'mark ALL as read (confirm dialog)' },
  ],
}

// Per-view keys shown when not in list view
const VIEW_KEYS = {
  diff: [
    { key: 'j / k',          label: 'scroll lines' },
    { key: 'gg / G',         label: 'jump to top / bottom' },
    { key: '[ / ]',          label: 'prev / next file' },
    { key: 'n / N',          label: 'prev / next comment thread' },
    { key: 'm',              label: 'merge PR (pick strategy)' },
    { key: 'c',              label: 'comment on cursor line' },
    { key: 'v',              label: 'view all comments (tab to comments)' },
    { key: 'r',              label: 'refresh diff' },
    { key: 'Esc',            label: 'back (to detail or list)' },
  ],
  detail: [
    { key: 'd',              label: 'open diff view' },
    { key: 'v',              label: 'open comments view' },
    { key: 'm',              label: 'merge PR' },
    { key: 'M',              label: 'toggle auto-merge' },
    { key: 'a',              label: 'approve PR' },
    { key: 'x',              label: 'request changes' },
    { key: 'X',              label: 'close PR' },
    { key: 'D',              label: 'toggle draft / ready' },
    { key: 'B',              label: 'change base branch' },
    { key: 'l',              label: 'edit labels' },
    { key: 'A',              label: 'edit assignees' },
    { key: 'r',              label: 'refresh' },
    { key: 'o',              label: 'open in browser' },
    { key: 'Esc',            label: 'back to list' },
  ],
  comments: [
    { key: 'j / k',          label: 'navigate threads' },
    { key: 'gg / G',         label: 'jump to top / bottom' },
    { key: 'r',              label: 'reply to current thread' },
    { key: 'R',              label: 'resolve current thread' },
    { key: 'J',              label: 'jump to this line in diff' },
    { key: 'f',              label: 'filter: open only / all / by author' },
    { key: 'Esc',            label: 'back to diff' },
  ],
}

// Dialog-specific hints appended when a dialog is active
const DIALOG_KEYS = {
  fuzzy: [
    { key: 'type',           label: 'filter in real-time' },
    { key: '↑↓ / j k',      label: 'navigate results' },
    { key: 'Enter',          label: 'select item' },
    { key: 'Esc',            label: 'cancel' },
  ],
  merge: [
    { key: '↑↓ / j k',      label: 'pick merge strategy' },
    { key: 'Enter',          label: 'confirm strategy' },
    { key: 'Tab',            label: 'next field (commit message)' },
    { key: 'Ctrl+G',         label: 'execute merge' },
    { key: 'Esc',            label: 'cancel' },
  ],
  multiselect: [
    { key: 'type',           label: 'filter options' },
    { key: '↑↓ / j k',      label: 'navigate' },
    { key: 'Space',          label: 'toggle selection' },
    { key: 'Enter',          label: 'confirm' },
    { key: 'Esc',            label: 'cancel' },
  ],
  confirm: [
    { key: 'y / Enter',      label: 'confirm action' },
    { key: 'n / Esc',        label: 'cancel' },
  ],
  compose: [
    { key: 'Tab',            label: 'next field' },
    { key: 'Ctrl+E',         label: 'open $EDITOR for body' },
    { key: 'Ctrl+G',         label: 'submit' },
    { key: 'Esc',            label: 'cancel' },
  ],
  logs: [
    { key: 'j / k',          label: 'scroll' },
    { key: 'gg / G',         label: 'top / bottom' },
    { key: 'f',              label: 'filter by step name' },
    { key: 'R',              label: 're-run workflow' },
    { key: 'Esc',            label: 'close log viewer' },
  ],
  comment: [
    { key: '←→',             label: 'pick comment type' },
    { key: 'Ctrl+E',         label: 'open $EDITOR for body' },
    { key: 'Ctrl+G',         label: 'submit comment' },
    { key: 'Esc',            label: 'cancel' },
  ],
}

// ─── Help overlay — shown on ? from any view ─────────────────────────────────

function HelpOverlay({ pane, view, onClose }) {
  useKeyScope('overlay')
  const { t } = useTheme()
  const { stdout } = useStdout()
  const cols = stdout?.columns || 80
  useInput((input, key) => {
    if (key.escape || key.return || input === '?') onClose()
  })

  const isListView = view === 'list'
  const contextKeys = isListView ? (PANE_KEYS[pane] || []) : (VIEW_KEYS[view] || [])
  const contextLabel = isListView
    ? `${PANE_ICONS[pane] || '○'}  ${PANE_LABELS[pane] || pane} list`
    : `${view.charAt(0).toUpperCase()}${view.slice(1)} view`

  const narrow = cols < 90

  return (
    <Box flexDirection="column" paddingX={2} paddingY={1} borderStyle="round" borderColor={t.ui.selected}>
      {/* ── Header ── */}
      <Box marginBottom={1} justifyContent="space-between">
        <Box gap={1}>
          <Text color={t.ui.selected} bold>⌨  Keyboard Reference</Text>
          <Text color={t.ui.dim}>— {contextLabel}</Text>
        </Box>
        <Text color={t.ui.dim}>[Esc/Enter/?] close</Text>
      </Box>

      <Box flexDirection="row" gap={4}>
        {/* Context-specific keys */}
        <Box flexDirection="column" width={40}>
          <Box marginBottom={0} borderStyle="single" borderTop={false} borderLeft={false} borderRight={false} borderBottom={true} borderColor={t.ui.dim}>
            <Text color={t.ui.muted} bold>{contextLabel}</Text>
          </Box>
          <Box flexDirection="column" marginTop={1}>
            {contextKeys.length > 0 ? contextKeys.map(k => (
              <Box key={k.key} gap={2}>
                <Text color={t.ui.selected} bold width={18}>{k.key}</Text>
                <Text color={t.ui.muted}>{k.label}</Text>
              </Box>
            )) : <Text color={t.ui.dim}>No specific keys</Text>}
          </Box>
        </Box>

        {/* Global keys — hidden on narrow terminals */}
        {!narrow && (
          <Box flexDirection="column" width={38}>
            <Box marginBottom={0} borderStyle="single" borderTop={false} borderLeft={false} borderRight={false} borderBottom={true} borderColor={t.ui.dim}>
              <Text color={t.ui.muted} bold>Global (any view)</Text>
            </Box>
            <Box flexDirection="column" marginTop={1}>
              {GLOBAL_KEYS.map(k => (
                <Box key={k.key} gap={2}>
                  <Text color={t.ui.selected} bold width={18}>{k.key}</Text>
                  <Text color={t.ui.muted}>{k.label}</Text>
                </Box>
              ))}
            </Box>
          </Box>
        )}
      </Box>

      {/* ── Config + docs hint ── */}
      <Box marginTop={1} flexDirection="column" paddingTop={1} borderStyle="single" borderBottom={false} borderLeft={false} borderRight={false} borderColor={t.ui.border}>
        <Box gap={1}>
          <Text color={t.ui.dim}>Config:</Text>
          <Text color={t.ui.selected}>~/.config/lazyhub/config.json</Text>
          {!narrow && <Box flexGrow={1} />}
          {!narrow && <Text color={t.ui.dim}>Docs:</Text>}
          {!narrow && <Text color={t.ui.selected}>https://saketh-kowtha.github.io/lgh</Text>}
        </Box>
      </Box>
    </Box>
  )
}

// ─── PR summary panel (right side) ───────────────────────────────────────────

function PRSummaryPanel({ pr }) {
  const { t } = useTheme()
  if (!pr) return (
    <Box flexDirection="column" paddingX={2} paddingY={2}>
      <Text color={t.ui.dim}>↑  hover a PR to preview</Text>
    </Box>
  )

  const stateBadge = pr.isDraft
    ? { icon: '⊘', label: 'Draft',  color: t.pr.draft  }
    : pr.state === 'MERGED' ? { icon: '⎇', label: 'Merged', color: t.pr.merged }
    : pr.state === 'CLOSED' ? { icon: '✕', label: 'Closed', color: t.pr.closed }
    : { icon: '●', label: 'Open',   color: t.pr.open   }

  const labels    = pr.labels?.slice(0, 4) || []
  const reviewers = pr.reviewRequests?.slice(0, 3) || []

  const ciChecks = pr.statusCheckRollup || []
  const failing  = ciChecks.filter(c => /failure|error/i.test(c.state || c.conclusion || '')).length
  const pending  = ciChecks.filter(c => /pending|in_progress/i.test(c.state || c.conclusion || c.status || '')).length
  const ciColor  = failing ? t.ci.fail : pending ? t.ci.pending : ciChecks.length ? t.ci.pass : null
  const ciLabel  = failing ? `✗ ${failing} failing` : pending ? `● ${pending} pending` : ciChecks.length ? '✓ passing' : null

  return (
    <Box flexDirection="column" paddingX={1} paddingY={1} gap={1}>
      {/* Title */}
      <Text color={t.ui.selected} bold wrap="truncate">{pr.title}</Text>

      {/* State + author */}
      <Box gap={1}>
        <Text color={stateBadge.color} bold>{stateBadge.icon} {stateBadge.label}</Text>
        <Text color={t.ui.dim}>·</Text>
        <Text color={t.ui.muted}>{pr.author?.login || '—'}</Text>
      </Box>

      {/* Branch */}
      {pr.headRefName && (
        <Box gap={1}>
          <Text color={t.ui.dim}>⑂</Text>
          <Text color={t.ui.muted} wrap="truncate">{pr.headRefName}</Text>
        </Box>
      )}

      {/* CI */}
      {ciLabel && (
        <Box gap={1}>
          <Text color={t.ui.dim}>⚡</Text>
          <Text color={ciColor}>{ciLabel}</Text>
        </Box>
      )}

      {/* Labels */}
      {labels.length > 0 && (
        <Box flexDirection="column" gap={0}>
          <Text color={t.ui.dim}>Labels</Text>
          {labels.map(l => (
            <Box key={l.name} paddingLeft={1} gap={1}>
              <Text color={t.ui.dim}>◆</Text>
              <Text color={t.ui.muted}>{l.name}</Text>
            </Box>
          ))}
        </Box>
      )}

      {/* Reviewers */}
      {reviewers.length > 0 && (
        <Box flexDirection="column" gap={0}>
          <Text color={t.ui.dim}>Reviewers</Text>
          {reviewers.map(r => (
            <Box key={r.login} paddingLeft={1} gap={1}>
              <Text color={t.ui.dim}>◇</Text>
              <Text color={t.ui.muted}>{r.login}</Text>
            </Box>
          ))}
        </Box>
      )}

      <Box flexGrow={1} />
      <Text color={t.ui.dim}>Enter detail  ·  d diff  ·  ? help</Text>
    </Box>
  )
}

// ─── Pane header ──────────────────────────────────────────────────────────────

function PaneHeader({ pane, count, loading, error }) {
  const { t } = useTheme()
  return (
    <Box paddingX={1} paddingY={0} gap={1}
         borderStyle="single" borderTop={false} borderLeft={false} borderRight={false}
         borderColor={t.ui.divider}>
      <Text color={t.ui.selected} bold>{PANE_ICONS[pane] || '◈'}  {PANE_LABELS[pane] || pane}</Text>
      {count != null && !loading && <Text color={t.ui.dim}>{count}</Text>}
      {loading && <Text color={t.ui.muted}>loading…</Text>}
      {error   && <Text color={t.ci.fail}>⚠  {error?.message || 'fetch error'} · r retry</Text>}
    </Box>
  )
}

// ─── Main App ─────────────────────────────────────────────────────────────────

function App({ repo }) {
  const { t, setTheme } = useTheme()
  const { exit } = useApp()
  const activeScope = useActiveScope()
  const layout = useLayout()
  const { cols: columns, rows, sidebarWidth, previewWidth, borderStyle, compactFooter, showSidebar, showPreview, listHeight } = layout

  // ─── Mouse support ────────────────────────────────────────────────────────
  const [mouseEnabled, setMouseEnabled] = useState(
    _config.mouse === true || process.env.LAZYHUB_MOUSE === '1'
  )

  useEffect(() => {
    if (!mouseEnabled) return
    // Enable mouse button + scroll tracking (X10 + SGR mode)
    process.stdout.write('\x1b[?1000h\x1b[?1002h\x1b[?1015h\x1b[?1006h')
    // Parse mouse events from raw stdin data — runs before readline/Ink sees the bytes
    const handleData = (buf) => {
      const str = buf.toString()
      // SGR mouse: ESC [ < Cb ; Cx ; Cy M/m
      const sgr = str.match(/\x1b\[<(\d+);(\d+);(\d+)([Mm])/)
      if (!sgr) return
      const btn = parseInt(sgr[1])
      // Scroll up = btn 64, scroll down = btn 65
      if (btn === 64) { process.stdin.emit('keypress', 'k', { name: 'k', sequence: 'k', ctrl: false, meta: false, shift: false }) }
      if (btn === 65) { process.stdin.emit('keypress', 'j', { name: 'j', sequence: 'j', ctrl: false, meta: false, shift: false }) }
    }
    process.stdin.prependListener('data', handleData)
    return () => {
      process.stdout.write('\x1b[?1000l\x1b[?1002l\x1b[?1015l\x1b[?1006l')
      process.stdin.off('data', handleData)
    }
  }, [mouseEnabled])

  const [pane, setPane]             = useState(_config.defaultPane)
  const [view, setView]             = useState('list')
  const [selectedItem, setSelectedItem] = useState(null)
  const [showHelp, setShowHelp]         = useState(false)
  const [showAI, setShowAI]             = useState(false)
  const [paneState, setPaneState]       = useState({})
  const [appMode, setAppMode]           = useState('NORMAL')
  const [toasts, setToasts]             = useState([])
  const [showPalette, setShowPalette]   = useState(false)
  const [leaderActive, setLeaderActive] = useState(false)
  const leaderTimerRef = useRef(null)

  const addToast = useCallback(({ message, variant = 'info' }) => {
    const id = Date.now() + Math.random()
    setToasts(prev => [...prev.slice(-2), { id, message, variant }])
    if (variant !== 'error') {
      const ttl = variant === 'success' ? 2500 : variant === 'warning' ? 4000 : 3000
      setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), ttl)
    }
  }, [])

  const dialogActiveRef    = useRef(false)
  const savedListPosition  = useRef({})
  const pendingNavigationRef = useRef(null)
  const paneStateMapRef    = useRef(new Map())
  const notifyDialog = useCallback((active) => { dialogActiveRef.current = active }, [])
  const openHelp     = useCallback(() => setShowHelp(true), [])
  const openAI       = useCallback(() => setShowAI(true), [])

  const appCtx = { notifyDialog, openHelp, openAI, setMouseEnabled, addToast, paneStateMap: paneStateMapRef.current }

  // ─── IPC state broadcast ──────────────────────────────────────────────────
  useEffect(() => {
    const ipcState = {
      repo:        process.env.GHUI_REPO || null,
      pane,
      view,
      prNumber:    (pane === 'prs' && selectedItem) ? selectedItem.number : null,
      issueNumber: (pane === 'issues' && selectedItem) ? selectedItem.number : null,
    }
    emitIPC('view-changed', ipcState)
  }, [pane, view, selectedItem])

  // ─── Layout (via useLayout hook) ─────────────────────────────────────────
  const showDetailPanel  = false
  const detailPanelWidth = 0

  // ─── AI navigate callback ─────────────────────────────────────────────────
  const handleAINavigate = useCallback(({ pane: tp, itemNumber, filter } = {}) => {
    setShowAI(false)
    const validPane = PANES.includes(tp) ? tp : null
    if (validPane) {
      setPane(validPane)
      setView('list')
      setSelectedItem(null)
      savedListPosition.current = {}
      pendingNavigationRef.current = { itemNumber, filter }
    }
  }, [PANES]) // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Global key handler ───────────────────────────────────────────────────
  useInput((input, key) => {
    // Ctrl+A: open AI assistant (always fires regardless of scope)
    if (key.ctrl && input === 'a') { setShowAI(true); return }

    // Dismiss sticky error toasts on any key
    if (toasts.some(t => t.variant === 'error')) {
      setToasts(prev => prev.filter(t => t.variant !== 'error'))
      return
    }

    // Only handle global keys when no higher-priority scope has captured input.
    // Scope stack: global(0) < pane(1) < view(2) < overlay(3) < dialog(4) < input(5)
    // At pane level, Tab/number/? are still valid (list pane doesn't block them).
    // At view/overlay/dialog/input, we must defer.
    const highScope = activeScope !== 'global' && activeScope !== 'pane' && activeScope !== 'list'
    if (highScope || dialogActiveRef.current) return

    if (input === '?') { setShowHelp(v => !v); return }

    // Help overlay eats everything else
    if (showHelp) { setShowHelp(false); return }

    if (key.tab) {
      const idx = PANES.indexOf(pane)
      setPane(PANES[key.shift
        ? (idx - 1 + PANES.length) % PANES.length
        : (idx + 1) % PANES.length
      ])
      savedListPosition.current = {}
      paneStateMapRef.current.clear()
      setSelectedItem(null); setView('list')
      setActionsBranch(null)
      return
    }

    // 1–9: jump directly to pane by position
    const numKey = parseInt(input, 10)
    if (!isNaN(numKey) && numKey >= 1 && numKey <= PANES.length) {
      const target = PANES[numKey - 1]
      if (target && target !== pane) {
        setPane(target)
        paneStateMapRef.current.clear()
        setSelectedItem(null); setView('list')
        setActionsBranch(null)
      }
      return
    }

    if (input === 'S') { setView('settings'); setSelectedItem(null); return }
    if (input === 'E') { openInEditor(CONFIG_PATH, 1, _config.editor).catch(() => {}); return }
    if (input === 'L' && process.env.LAZYHUB_DEBUG === '1') { setView('logs'); setSelectedItem(null); return }

    // V — toggle visual (batch-select) mode skeleton
    if (input === 'V' && view === 'list') {
      setAppMode(m => m === 'VISUAL' ? 'NORMAL' : 'VISUAL')
      return
    }

    // : — command palette
    if (input === ':') {
      setShowPalette(true)
      setAppMode('COMMAND')
      return
    }

    // Space — leader key (1500ms window)
    if (input === ' ') {
      if (leaderActive) return // already waiting — ignore double-space
      setLeaderActive(true)
      clearTimeout(leaderTimerRef.current)
      leaderTimerRef.current = setTimeout(() => {
        setLeaderActive(false)
      }, 1500)
      return
    }

    // Leader chords (only when leaderActive)
    if (leaderActive) {
      clearTimeout(leaderTimerRef.current)
      setLeaderActive(false)
      if (input === 't') { setShowPalette(true); setAppMode('COMMAND'); return }
      if (input === 'a') { setShowAI(true); return }
      if (input === '?') { setShowHelp(true); return }
      if (input === 'r') { /* recent PRs — future */ return }
      return
    }

    if (input === 'q' || key.escape) {
      if (showHelp)              { setShowHelp(false); return }
      if (view === 'settings')   { setView('list'); return }
      if (view === 'logs')       { setView('list'); return }
      if (view === 'comments')   { setView('diff'); return }
      if (view === 'conflict')   { setView('detail'); return }
      if (view === 'diff')       { setView(selectedItem?._fromList ? 'list' : 'detail'); return }
      if (view === 'detail')     { setSelectedItem(null); setView('list'); return }
      exit()
    }
  })

  // ─── Navigation callbacks ─────────────────────────────────────────────────
  const goToDetail   = useCallback((item) => {
    setSelectedItem(item); setView('detail')
  }, [])
  const goToDiff       = useCallback((item) => { setSelectedItem({ ...item, _fromList: view === 'list' }); setView('diff') }, [view])
  const goToComments   = useCallback(() => setView('comments'), [])
  const goToConflict   = useCallback(() => setView('conflict'), [])
  const [actionsBranch, setActionsBranch] = useState(null)
  const goToActions    = useCallback((branch) => {
    setActionsBranch(branch || null)
    setPane('actions')
    setSelectedItem(null)
    setView('list')
  }, [])
  const goBack         = useCallback(() => {
    if (view === 'comments') { setView('diff'); return }
    if (view === 'conflict') { setView('detail'); return }
    if (view === 'diff')     { setView(selectedItem?._fromList ? 'list' : 'detail'); return }
    setSelectedItem(null); setView('list')
  }, [view, selectedItem])

  const onPaneState = useCallback((s) => setPaneState(prev => ({ ...prev, ...s })), [])

  // Clear visual mode whenever we leave list view
  useEffect(() => {
    if (view !== 'list' && appMode === 'VISUAL') setAppMode('NORMAL')
  }, [view, appMode])

  // ─── AI assistant overlay ─────────────────────────────────────────────────
  if (showAI) {
    return (
      <AppContext.Provider value={appCtx}>
        <Box flexDirection="column" height={rows} overflow="hidden">
          <Box flexDirection="row" flexGrow={1} overflow="hidden">
            {showSidebar && (
              <Sidebar currentPane={pane} visiblePanes={PANES} width={sidebarWidth} borderStyle={borderStyle}
                paneLabels={PANE_LABELS} paneIcons={PANE_ICONS} repo={repo}
                onSelect={(p) => { setPane(p); setShowAI(false); setSelectedItem(null); setView('list') }}
                height={rows - (compactFooter ? 2 : 3)}
              />
            )}
            <ErrorBoundary>
              <AIAssistant
                repo={repo}
                pane={pane}
                selectedItem={selectedItem}
                onClose={() => setShowAI(false)}
                onNavigate={handleAINavigate}
                aiConfig={_config.ai}
                rows={rows - 2}
              />
            </ErrorBoundary>
          </Box>
          <StatusBar repo={repo} pane={pane} count={paneState.count} scopeIndicator={['global','pane','list'].includes(activeScope) ? null : activeScope.toUpperCase()} mode={appMode} />
          <FooterKeys hidden={compactFooter} keys={[{ key: 'Esc', label: 'close AI' }, { key: 'j/k', label: 'scroll' }, { key: 'Enter', label: 'send' }]} />
        </Box>
      </AppContext.Provider>
    )
  }

  // ─── Command palette overlay ──────────────────────────────────────────────
  if (showPalette) {
    return (
      <AppContext.Provider value={appCtx}>
        <Box flexDirection="column" height={rows} overflow="hidden">
          <Box flexDirection="row" flexGrow={1} overflow="hidden" justifyContent="center" alignItems="flex-start" paddingY={2}>
            <Box width={Math.min(columns - 4, 80)}>
              <CommandPalette
                context={{ pane, selectedItem, repo }}
                onClose={() => { setShowPalette(false); setAppMode('NORMAL') }}
                onNavigate={(opts) => {
                  setShowPalette(false); setAppMode('NORMAL')
                  handleAINavigate(opts)
                }}
                onTheme={(name) => { setShowPalette(false); setAppMode('NORMAL'); setTheme(name) }}
                themes={THEME_NAMES}
              />
            </Box>
          </Box>
          <StatusBar repo={repo} pane={pane} count={paneState.count} scopeIndicator={null} mode="COMMAND" />
          <FooterKeys hidden={compactFooter} keys={[{ key: '↑↓', label: 'nav' }, { key: 'Tab', label: 'complete' }, { key: 'Enter', label: 'run' }, { key: 'Esc', label: 'cancel' }]} />
        </Box>
      </AppContext.Provider>
    )
  }

  // ─── Help overlay — rendered first so ? works from every view ────────────
  if (showHelp) {
    return (
      <AppContext.Provider value={appCtx}>
        <Box flexDirection="column" height={rows} overflow="hidden">
          <Box flexDirection="row" flexGrow={1} overflow="hidden">
            {showSidebar && (
              <Sidebar currentPane={pane} visiblePanes={PANES} width={sidebarWidth} borderStyle={borderStyle}
                paneLabels={PANE_LABELS} paneIcons={PANE_ICONS} repo={repo}
                onSelect={(p) => { setPane(p); setShowHelp(false); setSelectedItem(null); setView('list') }}
                height={rows - (compactFooter ? 2 : 3)}
              />
            )}
          <Box flexDirection="column" flexGrow={1} overflow="hidden"
              justifyContent="center" alignItems="center">
            <HelpOverlay pane={pane} view={view} onClose={() => setShowHelp(false)} />
          </Box>
          </Box>
          <StatusBar repo={repo} pane={pane} count={paneState.count} scopeIndicator={['global','pane','list'].includes(activeScope) ? null : activeScope.toUpperCase()} mode={appMode} />
          <FooterKeys hidden={compactFooter} keys={[{ key: '? / Esc / Enter', label: 'close help' }]} />
        </Box>
      </AppContext.Provider>
    )
  }

  // ─── Full-screen views ────────────────────────────────────────────────────
  if (view === 'conflict' && selectedItem) {
    return (
      <AppContext.Provider value={appCtx}>
        <Box flexDirection="column" height={rows}>
          <Box flexDirection="row" flexGrow={1} overflow="hidden">
            <ErrorBoundary>
              <ConflictView
                pr={selectedItem}
                repo={repo}
                onBack={goBack}
                onResolved={() => setView('detail')}
              />
            </ErrorBoundary>
          </Box>
          <StatusBar repo={repo} pane={pane} scopeIndicator={['global','pane','list'].includes(activeScope) ? null : activeScope.toUpperCase()} mode={appMode} />
          <FooterKeys hidden={compactFooter} keys={[
            { key: 'j/k', label: 'navigate' },
            { key: 'e/Enter', label: 'open editor' },
            { key: 'Space', label: 'stage/unstage' },
            { key: 'c', label: 'commit + push' },
            { key: 'Esc', label: 'back' },
          ]} />
        </Box>
      </AppContext.Provider>
    )
  }

  if (view === 'diff' && selectedItem) {
    return (
      <AppContext.Provider value={appCtx}>
        <Box flexDirection="column" height={rows} overflow="hidden">
          <ErrorBoundary>
            <PRDiff
              prNumber={selectedItem.number}
              repo={repo}
              onBack={goBack}
              onViewComments={goToComments}
            />
          </ErrorBoundary>
        </Box>
      </AppContext.Provider>
    )
  }

  if (view === 'comments' && selectedItem) {
    return (
      <AppContext.Provider value={appCtx}>
        <Box flexDirection="column" height={rows} overflow="hidden">
          <ErrorBoundary>
            <PRComments
              prNumber={selectedItem.number}
              repo={repo}
              onBack={goBack}
              onJumpToDiff={() => setView('diff')}
            />
          </ErrorBoundary>
        </Box>
      </AppContext.Provider>
    )
  }

  if (view === 'logs') {
    return (
      <AppContext.Provider value={appCtx}>
        <Box flexDirection="column" height={rows}>
          <Box flexDirection="row" flexGrow={1}>
            {showSidebar && (
              <Sidebar currentPane={pane} visiblePanes={PANES} width={sidebarWidth} borderStyle={borderStyle}
                paneLabels={PANE_LABELS} paneIcons={PANE_ICONS} repo={repo}
                onSelect={(p) => { setPane(p); setSelectedItem(null); setView('list') }}
                height={rows - (compactFooter ? 2 : 3)}
              />
            )}
            <ErrorBoundary>
              <LogPane onBack={() => setView('list')} />
            </ErrorBoundary>
          </Box>
          <StatusBar repo={repo} pane="logs" scopeIndicator={['global','pane','list'].includes(activeScope) ? null : activeScope.toUpperCase()} mode={appMode} />
          <FooterKeys hidden={compactFooter} keys={[
            { key: 'j/k', label: 'navigate' },
            { key: 'Enter', label: 'detail' },
            { key: 'f', label: 'level' },
            { key: '/', label: 'search' },
            { key: 'Esc', label: 'back' }
          ]} />
        </Box>
      </AppContext.Provider>
    )
  }

  if (view === 'settings') {
    return (
      <AppContext.Provider value={appCtx}>
        <Box flexDirection="column" height={rows}>
          <Box flexDirection="row" flexGrow={1}>
            {showSidebar && (
              <Sidebar currentPane={pane} visiblePanes={PANES} width={sidebarWidth} borderStyle={borderStyle}
                paneLabels={PANE_LABELS} paneIcons={PANE_ICONS} repo={repo}
                onSelect={(p) => { setPane(p); setSelectedItem(null); setView('list') }}
                height={rows - (compactFooter ? 2 : 3)}
              />
            )}
            <ErrorBoundary>
              <SettingsPane onBack={() => setView('list')} />
            </ErrorBoundary>
          </Box>
          <StatusBar repo={repo} pane="settings" scopeIndicator={['global','pane','list'].includes(activeScope) ? null : activeScope.toUpperCase()} mode={appMode} />
          <FooterKeys hidden={compactFooter} keys={[
            { key: 'j/k', label: 'navigate' },
            { key: 'Enter', label: 'select' },
            { key: '?', label: 'help' },
            { key: 'Esc', label: 'back' }
          ]} />
        </Box>
      </AppContext.Provider>
    )
  }

  if (view === 'detail' && selectedItem) {
    const DetailPane = pane === 'issues' ? IssueDetail : PRDetail
    const detailFooter = pane === 'prs'
      ? [
          { key: 'j/k', label: 'scroll' }, { key: 'd', label: 'diff' },
          { key: 'm', label: 'merge' }, { key: 'a', label: 'approve' },
          { key: '?', label: 'more keys' }, { key: 'Esc', label: 'back' },
        ]
      : [
          { key: 'j/k', label: 'scroll' }, { key: 'l', label: 'labels' },
          { key: 'A', label: 'assignees' },
          { key: '?', label: 'more keys' }, { key: 'Esc', label: 'back' },
        ]

    return (
      <AppContext.Provider value={appCtx}>
        <Box flexDirection="column" height={rows}>
          <Box flexDirection="column" flexGrow={1}>
            <ErrorBoundary>
              <DetailPane
                {...(pane === 'issues'
                  ? { issueNumber: selectedItem.number }
                  : { prNumber: selectedItem.number })}
                repo={repo}
                onBack={goBack}
                onOpenDiff={goToDiff}
                onOpenConflict={pane === 'prs' ? goToConflict : undefined}
                onOpenActions={pane === 'prs' ? goToActions : undefined}
                onViewComments={pane === 'prs' ? goToComments : undefined}
              />
            </ErrorBoundary>
          </Box>
          <StatusBar repo={repo} pane={pane} count={paneState.count} scopeIndicator={['global','pane','list'].includes(activeScope) ? null : activeScope.toUpperCase()} mode={appMode} />
          <FooterKeys hidden={compactFooter} keys={detailFooter} />
        </Box>
      </AppContext.Provider>
    )
  }

  // ─── List view ────────────────────────────────────────────────────────────
  function renderListPane() {
    switch (pane) {
      case 'prs': return (
        <PRList repo={repo} listHeight={listHeight}
          innerWidth={columns - (showSidebar ? sidebarWidth : 0) - 2}
          onSelectPR={goToDetail}
          onOpenDiff={goToDiff} onPaneState={onPaneState} />
      )
      case 'issues': return (
        <IssueList repo={repo} listHeight={listHeight}
          onSelectIssue={goToDetail} onPaneState={onPaneState} />
      )
      case 'branches':     return <BranchList repo={repo} listHeight={listHeight} onPaneState={onPaneState} />
      case 'actions':      return <ActionList repo={repo} listHeight={listHeight} onPaneState={onPaneState} initialBranch={actionsBranch} />
      case 'notifications': return (
        <NotificationList repo={repo} listHeight={listHeight} onPaneState={onPaneState}
          onNavigateTo={(notif) => {
            const type = notif.subject?.type
            if (type === 'PullRequest') setPane('prs')
            else if (type === 'Issue')  setPane('issues')
            setView('list')
          }} />
      )
      default: {
        // Custom user-defined pane
        const customDef = (_config.customPanes || {})[pane]
        if (customDef) {
          return <CustomPane paneDef={customDef} repo={repo} listHeight={listHeight} onPaneState={onPaneState} />
        }
        return <Box paddingX={1}><Text color={t.ui.muted}>Unknown pane: {pane}</Text></Box>
      }
    }
  }

  // Map dialog names (emitted by list panes) to footer hint sets
  const DIALOG_HINT_MAP = {
    'fuzzy':         DIALOG_KEYS.fuzzy,
    'author-search': DIALOG_KEYS.fuzzy,
    'merge':         DIALOG_KEYS.merge,
    'labels':        DIALOG_KEYS.multiselect,
    'assignees':     DIALOG_KEYS.multiselect,
    'reviewers':     DIALOG_KEYS.multiselect,
    'approve-body':  DIALOG_KEYS.compose,
    'reqchanges-body': DIALOG_KEYS.compose,
    'new-pr':        DIALOG_KEYS.compose,
    'close-pr':      DIALOG_KEYS.confirm,
    'checkout':      DIALOG_KEYS.confirm,
    'new-issue':     DIALOG_KEYS.compose,
    'close-issue':   DIALOG_KEYS.confirm,
    'new-branch':    DIALOG_KEYS.fuzzy,
    'delete-branch': DIALOG_KEYS.confirm,
    'cancel-run':    DIALOG_KEYS.confirm,
    'mark-all':      DIALOG_KEYS.confirm,
    'logs':          DIALOG_KEYS.logs,
  }

  const listFooter = (() => {
    if (paneState.dialogHint && DIALOG_HINT_MAP[paneState.dialogHint]) {
      return DIALOG_HINT_MAP[paneState.dialogHint]
    }
    // Group 1: navigation  Group 2: actions  Group 3: meta (? handled separately)
    const g1 = [{ key: 'j/k', label: 'nav', group: 1 }, { key: 'Tab', label: 'pane', group: 1 }]
    const g3 = [{ key: 'r', label: 'refresh', group: 3 }, { key: 'S', label: 'settings', group: 3 }, { key: '?', label: 'help' }]
    if (pane === 'prs')    return [...g1, { key: 'Enter', label: 'open', group: 2 }, { key: 'd', label: 'diff', group: 2 }, { key: 'f', label: 'filter', group: 2 }, { key: 'm', label: 'merge', group: 2 }, ...g3]
    if (pane === 'issues') return [...g1, { key: 'Enter', label: 'open', group: 2 }, { key: 'n', label: 'new', group: 2 }, ...g3]
    if (pane === 'branches') return [...g1, { key: 'Enter', label: 'checkout', group: 2 }, { key: 'n', label: 'new', group: 2 }, { key: 'D', label: 'delete', group: 2 }, ...g3]
    if (pane === 'actions') return [...g1, { key: 'Enter', label: 'logs', group: 2 }, { key: 'R', label: 're-run', group: 2 }, ...g3]
    return [...g1, ...g3]
  })()

  const paneSwitch = (p) => { setPane(p); setSelectedItem(null); setView('list'); setAppMode('NORMAL') }

  return (
    <AppContext.Provider value={appCtx}>
      <Box flexDirection="column" height={rows} overflow="hidden">
        {/* Compact mode: horizontal tab strip replaces sidebar */}
        {!showSidebar && (
          <TabStrip panes={PANES} currentPane={pane} paneLabels={PANE_LABELS} paneIcons={PANE_ICONS} onSelect={paneSwitch} />
        )}
        <Box flexDirection="row" flexGrow={1} overflow="hidden">
          {showSidebar && (
            <Sidebar currentPane={pane} visiblePanes={PANES} width={sidebarWidth} borderStyle={borderStyle}
              paneLabels={PANE_LABELS} paneIcons={PANE_ICONS} repo={repo}
              borderRight={false}
              onSelect={paneSwitch}
              height={rows - (compactFooter ? 2 : 3)}
            />
          )}

          <Box flexDirection="column" flexGrow={1} overflow="hidden"
               borderStyle={borderStyle || 'round'}
               borderColor={t.ui.borderActive}>
            <PaneHeader pane={pane} count={paneState.count} loading={paneState.loading} error={paneState.error} />
            <Box flexGrow={1} flexDirection="column" overflow="hidden">
              <ErrorBoundary>
                {renderListPane()}
              </ErrorBoundary>
            </Box>
          </Box>

        </Box>

        {leaderActive && (
          <Box paddingX={2} paddingY={0}>
            <Text color={t.ui.selected} bold>{'<Space> '}</Text>
            <Text color={t.ui.muted}>t</Text><Text color={t.ui.dim}> theme  </Text>
            <Text color={t.ui.muted}>a</Text><Text color={t.ui.dim}> AI  </Text>
            <Text color={t.ui.muted}>r</Text><Text color={t.ui.dim}> recent  </Text>
            <Text color={t.ui.muted}>?</Text><Text color={t.ui.dim}> help  </Text>
            <Text color={t.ui.dim}> (1.5s)</Text>
          </Box>
        )}
        <StatusBar repo={repo} pane={pane} count={paneState.count} scopeIndicator={['global','pane','list'].includes(activeScope) ? null : activeScope.toUpperCase()} mode={appMode} />
        <FooterKeys hidden={compactFooter} keys={listFooter} />
        {toasts.length > 0 && <Toaster toasts={toasts} />}
      </Box>
    </AppContext.Provider>
  )
}

export function renderApp() {
  const repo = process.env.GHUI_REPO || ''

  // Enter alternate screen buffer — terminal restores on exit (like lazygit / vim)
  process.stdout.write('\x1b[?1049h\x1b[H')

  let _restored = false
  const restoreTerminal = () => {
    if (_restored) return
    _restored = true
    process.stdout.write('\x1b[?1049l')
  }

  // Restore on any exit path — use once() so SIGINT only fires one handler
  process.on('exit', restoreTerminal)
  process.once('SIGINT',  () => { restoreTerminal(); process.exit(0) })
  process.once('SIGTERM', () => { restoreTerminal(); process.exit(0) })

  const initialTheme = readRawThemeCfg()
  try {
    const { unmount } = render(
      <ThemeProvider initialTheme={initialTheme}>
        <KeyScopeProvider>
          <App repo={repo} />
        </KeyScopeProvider>
      </ThemeProvider>
    )

    // When Ink exits (useApp().exit() called), also restore terminal
    // Ink emits its own cleanup; we hook the process 'exit' above which covers it.
    // Store unmount so bootstrap can use it if needed.
    process.env._GHUI_UNMOUNT = '1'
    return unmount
  } catch (err) {
    logger.error('Fatal App Crash', err)
    process.exit(1)
  }
}
