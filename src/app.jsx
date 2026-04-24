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
import { loadConfig } from './config.js'
import { AppContext } from './context.js'
import { logger } from './utils.js'
import { emitIPC, startIPC } from './ipc.js'
import { Sidebar } from './components/Sidebar.jsx'
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
  issues:        '○',
  branches:      '⊞',
  actions:       '▶',
  notifications: '●',
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
    { key: 'e',              label: 'open $EDITOR for body' },
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
    { key: 'Tab',            label: 'next field' },
    { key: 'e',              label: 'open $EDITOR for body' },
    { key: 'Ctrl+G',         label: 'submit comment' },
    { key: 'Ctrl+R',         label: 'submit + resolve thread' },
    { key: 'Esc',            label: 'cancel' },
  ],
}

// ─── Help overlay — shown on ? from any view ─────────────────────────────────

function HelpOverlay({ pane, view, onClose }) {
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
    <Box flexDirection="column" paddingX={1} paddingY={1}>
      <Text color={t.ui.dim}>No PR selected</Text>
    </Box>
  )

  const stateBadge = pr.isDraft
    ? { label: 'Draft', color: t.pr.draft }
    : pr.state === 'MERGED' ? { label: 'Merged', color: t.pr.merged }
    : pr.state === 'CLOSED' ? { label: 'Closed', color: t.pr.closed }
    : { label: 'Open', color: t.pr.open }

  const labels = pr.labels?.slice(0, 3) || []
  const reviewers = pr.reviewRequests?.slice(0, 3) || []

  return (
    <Box flexDirection="column" paddingX={1} paddingY={1} gap={1}>
      <Text color={t.ui.selected} bold wrap="truncate">#{pr.number} {pr.title}</Text>
      <Box gap={1}>
        <Text color={stateBadge.color} bold>{stateBadge.label}</Text>
      </Box>
      <Text color={t.ui.muted}>by {pr.author?.login || '—'}</Text>
      {labels.length > 0 && (
        <Box flexDirection="column">
          <Text color={t.ui.dim}>Labels</Text>
          {labels.map(l => <Text key={l.name} color={t.ui.muted}>  • {l.name}</Text>)}
        </Box>
      )}
      {reviewers.length > 0 && (
        <Box flexDirection="column">
          <Text color={t.ui.dim}>Reviewers</Text>
          {reviewers.map(r => <Text key={r.login} color={t.ui.muted}>  {r.login}</Text>)}
        </Box>
      )}
      {pr.checksState && (
        <Box gap={1}>
          <Text color={t.ui.dim}>CI</Text>
          <Text color={
            pr.checksState === 'SUCCESS' ? t.ci.pass
            : pr.checksState === 'FAILURE' ? t.ci.fail
            : t.ci.pending
          }>
            {pr.checksState === 'SUCCESS' ? '✓ Passing'
              : pr.checksState === 'FAILURE' ? '✗ Failing'
              : '● Pending'}
          </Text>
        </Box>
      )}
      <Text color={t.ui.dim} dimColor>[d] diff  [Enter] detail  [?] help</Text>
    </Box>
  )
}

// ─── Pane header ──────────────────────────────────────────────────────────────

function PaneHeader({ pane, count, loading, error }) {
  const { t } = useTheme()
  return (
    <Box paddingX={1}>
      <Text color={t.ui.selected} bold>{PANE_ICONS[pane] || '○'} {PANE_LABELS[pane] || pane}</Text>
      {count != null && !loading && <Text color={t.ui.dim}> ({count})</Text>}
      {loading && <Text color={t.ui.muted}> loading…</Text>}
      {error && <Text color={t.ci.fail}>  ⚠ {error?.message || 'fetch error'} — [r] retry</Text>}
    </Box>
  )
}

// ─── Main App ─────────────────────────────────────────────────────────────────

function App({ repo }) {
  const { t } = useTheme()
  const { exit } = useApp()
  const { stdout } = useStdout()
  const columns = stdout?.columns || 80
  const rows    = stdout?.rows    || 24

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
  const [hoveredItem, setHoveredItem]   = useState(null)
  const [showHelp, setShowHelp]         = useState(false)
  const [showAI, setShowAI]             = useState(false)
  const [paneState, setPaneState]       = useState({})

  const dialogActiveRef    = useRef(false)
  const savedListPosition  = useRef({})
  const pendingNavigationRef = useRef(null)
  const notifyDialog = useCallback((active) => { dialogActiveRef.current = active }, [])
  const openHelp     = useCallback(() => setShowHelp(true), [])
  const openAI       = useCallback(() => setShowAI(true), [])

  const appCtx = { notifyDialog, openHelp, openAI, setMouseEnabled }

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

  // ─── Layout breakpoints ───────────────────────────────────────────────────
  const showSidebar     = columns >= 80
  const showDetailPanel = columns >= 100 && view === 'list' && pane === 'prs'
  const detailPanelWidth = showDetailPanel ? 40 : 0
  const listHeight = Math.max(3, rows - 5)

  // ─── AI navigate callback ─────────────────────────────────────────────────
  const handleAINavigate = useCallback(({ pane: tp, itemNumber, filter } = {}) => {
    setShowAI(false)
    const validPane = PANES.includes(tp) ? tp : null
    if (validPane) {
      setPane(validPane)
      setView('list')
      setSelectedItem(null)
      setHoveredItem(null)
      savedListPosition.current = {}
      pendingNavigationRef.current = { itemNumber, filter }
    }
  }, [PANES])

  // ─── Global key handler ───────────────────────────────────────────────────
  useInput((input, key) => {
    // Ctrl+A: open AI assistant (before dialog guard so it always fires)
    if (key.ctrl && input === 'a') { setShowAI(true); return }

    if (dialogActiveRef.current) return

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
      setHoveredItem(null); setSelectedItem(null); setView('list')
      setActionsBranch(null)
      return
    }

    // 1–9: jump directly to pane by position
    const numKey = parseInt(input, 10)
    if (!isNaN(numKey) && numKey >= 1 && numKey <= PANES.length) {
      const target = PANES[numKey - 1]
      if (target && target !== pane) {
        setPane(target)
        setHoveredItem(null); setSelectedItem(null); setView('list')
        setActionsBranch(null)
      }
      return
    }

    if (input === 'S') { setView('settings'); setSelectedItem(null); return }
    if (input === 'L' && process.env.LAZYHUB_DEBUG === '1') { setView('logs'); setSelectedItem(null); return }

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
    savedListPosition.current = { cursor: paneState.cursor ?? 0, scrollOffset: paneState.scrollOffset ?? 0 }
    setSelectedItem(item); setView('detail')
  }, [paneState])
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

  const onPaneState = useCallback((s) => setPaneState(s), [])

  // ─── AI assistant overlay ─────────────────────────────────────────────────
  if (showAI) {
    return (
      <AppContext.Provider value={appCtx}>
        <Box flexDirection="column" height={rows} overflow="hidden">
          <Box flexDirection="row" flexGrow={1} overflow="hidden">
            {showSidebar && (
              <Sidebar currentPane={pane} visiblePanes={PANES}
                paneLabels={PANE_LABELS} paneIcons={PANE_ICONS}
                onSelect={(p) => { setPane(p); setShowAI(false); setHoveredItem(null); setSelectedItem(null); setView('list') }}
                height={rows - 2}
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
          <StatusBar repo={repo} pane={pane} count={paneState.count} />
          <FooterKeys keys={[{ key: 'Esc', label: 'close AI' }, { key: 'j/k', label: 'scroll' }, { key: 'Enter', label: 'send' }]} />
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
              <Sidebar currentPane={pane} visiblePanes={PANES}
                paneLabels={PANE_LABELS} paneIcons={PANE_ICONS}
                onSelect={(p) => { setPane(p); setShowHelp(false); setHoveredItem(null); setSelectedItem(null); setView('list') }}
                height={rows - 2}
              />
            )}
          <Box flexDirection="column" flexGrow={1} overflow="hidden"
              justifyContent="center" alignItems="center">
            <HelpOverlay pane={pane} view={view} onClose={() => setShowHelp(false)} />
          </Box>
          </Box>
          <StatusBar repo={repo} pane={pane} count={paneState.count} />
          <FooterKeys keys={[{ key: '? / Esc / Enter', label: 'close help' }]} />
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
          <StatusBar repo={repo} pane={pane} />
          <FooterKeys keys={[
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
        <ErrorBoundary>
          <PRDiff
            prNumber={selectedItem.number}
            repo={repo}
            onBack={goBack}
            onViewComments={goToComments}
          />
        </ErrorBoundary>
      </AppContext.Provider>
    )
  }

  if (view === 'comments' && selectedItem) {
    return (
      <AppContext.Provider value={appCtx}>
        <ErrorBoundary>
          <PRComments
            prNumber={selectedItem.number}
            repo={repo}
            onBack={goBack}
            onJumpToDiff={() => setView('diff')}
          />
        </ErrorBoundary>
      </AppContext.Provider>
    )
  }

  if (view === 'logs') {
    return (
      <AppContext.Provider value={appCtx}>
        <Box flexDirection="column" height={rows}>
          <Box flexDirection="row" flexGrow={1}>
            {showSidebar && (
              <Sidebar currentPane={pane} visiblePanes={PANES}
                paneLabels={PANE_LABELS} paneIcons={PANE_ICONS}
                onSelect={(p) => { setPane(p); setSelectedItem(null); setView('list') }}
                height={rows - 2}
              />
            )}
            <ErrorBoundary>
              <LogPane onBack={() => setView('list')} />
            </ErrorBoundary>
          </Box>
          <StatusBar repo={repo} pane="logs" />
          <FooterKeys keys={[
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
              <Sidebar currentPane={pane} visiblePanes={PANES}
                paneLabels={PANE_LABELS} paneIcons={PANE_ICONS}
                onSelect={(p) => { setPane(p); setSelectedItem(null); setView('list') }}
                height={rows - 2}
              />
            )}
            <ErrorBoundary>
              <SettingsPane onBack={() => setView('list')} />
            </ErrorBoundary>
          </Box>
          <StatusBar repo={repo} pane="settings" />
          <FooterKeys keys={[
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
          <Box borderStyle="single" borderColor={t.ui.selected} flexDirection="column" flexGrow={1}>
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
          <StatusBar repo={repo} pane={pane} count={paneState.count} />
          <FooterKeys keys={detailFooter} />
        </Box>
      </AppContext.Provider>
    )
  }

  // ─── List view ────────────────────────────────────────────────────────────
  function renderListPane() {
    switch (pane) {
      case 'prs': return (
        <PRList repo={repo} listHeight={listHeight}
          onHover={setHoveredItem} onSelectPR={goToDetail}
          onOpenDiff={goToDiff} onPaneState={onPaneState}
          initialCursor={savedListPosition.current.cursor ?? 0}
          initialScrollOffset={savedListPosition.current.scrollOffset ?? 0} />
      )
      case 'issues': return (
        <IssueList repo={repo} listHeight={listHeight}
          onSelectIssue={goToDetail} onPaneState={onPaneState}
          initialCursor={savedListPosition.current.cursor ?? 0}
          initialScrollOffset={savedListPosition.current.scrollOffset ?? 0} />
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

  const listFooter = (() => {
    const base = [
      { key: 'j/k', label: 'nav' }, { key: 'Tab', label: 'pane' },
      { key: 'r', label: 'refresh' }, { key: 'S', label: 'settings' },
      { key: '?', label: 'help' },
    ]
    if (pane === 'prs')    return [...base, { key: 'Enter', label: 'open' }, { key: 'd', label: 'diff' }, { key: 'f', label: 'filter' }]
    if (pane === 'issues') return [...base, { key: 'Enter', label: 'open' }, { key: 'n', label: 'new' }]
    return base
  })()

  return (
    <AppContext.Provider value={appCtx}>
      <Box flexDirection="column" height={rows} overflow="hidden">
        <Box flexDirection="row" flexGrow={1} overflow="hidden">
          {showSidebar && (
            <Sidebar currentPane={pane} visiblePanes={PANES}
              paneLabels={PANE_LABELS} paneIcons={PANE_ICONS}
              onSelect={(p) => { setPane(p); setHoveredItem(null); setSelectedItem(null); setView('list') }}
              height={rows - 2}
            />
          )}

          <Box flexDirection="column" flexGrow={1} overflow="hidden" borderStyle="single" borderColor={t.ui.selected}>
            <PaneHeader pane={pane} count={paneState.count} loading={paneState.loading} error={paneState.error} />
            <Box flexGrow={1} flexDirection="column" overflow="hidden">
              <ErrorBoundary>
                {renderListPane()}
              </ErrorBoundary>
            </Box>
          </Box>

          {showDetailPanel && (
            <Box width={detailPanelWidth} flexDirection="column" borderStyle="single" borderColor={t.ui.border}>
              <Box paddingX={1}><Text color={t.ui.muted} bold>Detail</Text></Box>
              <PRSummaryPanel pr={hoveredItem} />
            </Box>
          )}
        </Box>

        <StatusBar repo={repo} pane={pane} count={paneState.count} />
        <FooterKeys keys={listFooter} />
      </Box>
    </AppContext.Provider>
  )
}

export function renderApp() {
  const repo = process.env.GHUI_REPO || ''

  // Enter alternate screen buffer — terminal restores on exit (like lazygit / vim)
  process.stdout.write('\x1b[?1049h\x1b[H')

  const restoreTerminal = () => {
    process.stdout.write('\x1b[?1049l')
  }

  // Restore on any exit path
  process.on('exit',   restoreTerminal)
  process.on('SIGINT',  () => { restoreTerminal(); process.exit(0) })
  process.on('SIGTERM', () => { restoreTerminal(); process.exit(0) })

  const initialTheme = readRawThemeCfg()
  try {
    const { unmount } = render(
      <ThemeProvider initialTheme={initialTheme}>
        <App repo={repo} />
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
