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

import React, { useState, useRef, useCallback, createContext, useContext } from 'react'
import { render, Box, Text, useInput, useApp, useStdout } from 'ink'
import { t } from './theme.js'
import { loadConfig } from './config.js'

const _config = loadConfig()
import { Sidebar } from './components/Sidebar.jsx'
import { StatusBar } from './components/StatusBar.jsx'
import { FooterKeys } from './components/FooterKeys.jsx'
import { PRList } from './features/prs/list.jsx'
import { PRDetail } from './features/prs/detail.jsx'
import { PRDiff } from './features/prs/diff.jsx'
import { PRComments } from './features/prs/comments.jsx'
import { IssueList } from './features/issues/list.jsx'
import { IssueDetail } from './features/issues/detail.jsx'
import { BranchList } from './features/branches/index.jsx'
import { ActionList } from './features/actions/index.jsx'
import { NotificationList } from './features/notifications/index.jsx'

// ─── AppContext ───────────────────────────────────────────────────────────────
// Child panes call notifyDialog(true/false) so App's global key handler
// can suppress q/Tab while a dialog is active.

export const AppContext = createContext({ notifyDialog: () => {} })

export function useAppContext() {
  return useContext(AppContext)
}

// ─── Pane registry ───────────────────────────────────────────────────────────

// Respect user config — allows hiding panes via ~/.config/ghui/config.json
const PANES = _config.panes

const PANE_LABELS = {
  prs: 'Pull Requests',
  issues: 'Issues',
  branches: 'Branches',
  actions: 'Actions',
  notifications: 'Notifications',
}

const PANE_ICONS = {
  prs: '⎇',
  issues: '○',
  branches: '⎇',
  actions: '▶',
  notifications: '●',
}

// ─── Help overlay ─────────────────────────────────────────────────────────────

const PANE_KEYS = {
  prs: [
    { key: 'j/k', label: 'navigate' },
    { key: 'Enter', label: 'detail' },
    { key: 'd', label: 'diff' },
    { key: 'm', label: 'merge' },
    { key: 'a', label: 'approve' },
    { key: 'l', label: 'labels' },
    { key: 'A', label: 'assignees' },
    { key: 'R', label: 'request reviewers' },
    { key: 'c', label: 'checkout branch' },
    { key: 'o', label: 'open in browser' },
  ],
  issues: [
    { key: 'j/k', label: 'navigate' },
    { key: 'Enter', label: 'detail' },
    { key: 'n', label: 'new issue' },
    { key: 'x', label: 'close issue' },
    { key: 'l', label: 'labels' },
    { key: 'A', label: 'assignees' },
    { key: 'o', label: 'open in browser' },
  ],
  branches: [
    { key: 'j/k', label: 'navigate' },
    { key: 'Space', label: 'checkout' },
    { key: 'D', label: 'delete branch' },
    { key: 'p', label: 'push' },
  ],
  actions: [
    { key: 'j/k', label: 'navigate' },
    { key: 'Enter/l', label: 'view logs' },
    { key: 'R', label: 're-run' },
    { key: 'X', label: 'cancel run' },
  ],
  notifications: [
    { key: 'j/k', label: 'navigate' },
    { key: 'Enter', label: 'open' },
    { key: 'm', label: 'mark read' },
    { key: 'M', label: 'mark all read' },
  ],
}

const GLOBAL_KEYS = [
  { key: 'Tab', label: 'next pane' },
  { key: 'Shift+Tab', label: 'prev pane' },
  { key: 'q/Esc', label: 'back / quit' },
  { key: '/', label: 'search' },
  { key: 'r', label: 'refresh' },
  { key: 'o', label: 'open in browser' },
  { key: '?', label: 'this help' },
]

function HelpOverlay({ pane, onClose }) {
  useInput((_, key) => {
    if (key.escape || key.return) onClose()
  })

  const paneKeys = PANE_KEYS[pane] || []

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={t.ui.selected}
      paddingX={2}
      paddingY={1}
      alignSelf="flex-start"
    >
      <Text color={t.ui.selected} bold>  {PANE_ICONS[pane] || '○'}  {PANE_LABELS[pane] || pane} — Keyboard Shortcuts</Text>
      <Box marginTop={1} flexDirection="row" gap={4}>
        <Box flexDirection="column" gap={0}>
          <Text color={t.ui.muted} bold>Global</Text>
          {GLOBAL_KEYS.map(k => (
            <Box key={k.key}>
              <Text color={t.ui.selected}>{k.key.padEnd(14)}</Text>
              <Text color={t.ui.muted}>{k.label}</Text>
            </Box>
          ))}
        </Box>
        {paneKeys.length > 0 && (
          <Box flexDirection="column" gap={0}>
            <Text color={t.ui.muted} bold>This pane</Text>
            {paneKeys.map(k => (
              <Box key={k.key}>
                <Text color={t.ui.selected}>{k.key.padEnd(14)}</Text>
                <Text color={t.ui.muted}>{k.label}</Text>
              </Box>
            ))}
          </Box>
        )}
      </Box>
      <Box marginTop={1}>
        <Text color={t.ui.dim}>[Esc / Enter] close</Text>
      </Box>
    </Box>
  )
}

// ─── PR summary panel (right side) ───────────────────────────────────────────

function PRSummaryPanel({ pr }) {
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
        {pr.isDraft && <Text color={t.pr.draft}> Draft</Text>}
      </Box>
      <Text color={t.ui.muted}>by {pr.author?.login || '—'}</Text>
      {labels.length > 0 && (
        <Box flexDirection="column" gap={0}>
          <Text color={t.ui.dim}>Labels</Text>
          {labels.map(l => (
            <Text key={l.name} color={t.ui.muted}>  • {l.name}</Text>
          ))}
        </Box>
      )}
      {reviewers.length > 0 && (
        <Box flexDirection="column" gap={0}>
          <Text color={t.ui.dim}>Reviewers</Text>
          {reviewers.map(r => (
            <Text key={r.login} color={t.ui.muted}>  {r.login}</Text>
          ))}
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
      <Text color={t.ui.dim} dimColor>[d] diff  [Enter] detail</Text>
    </Box>
  )
}

// ─── Pane header (shown inside the list box) ──────────────────────────────────

function PaneHeader({ pane, count, loading, error }) {
  const icon = PANE_ICONS[pane] || '○'
  const label = PANE_LABELS[pane] || pane

  return (
    <Box paddingX={1} paddingBottom={0}>
      <Text color={t.ui.selected} bold>{icon} {label}</Text>
      {count != null && !loading && (
        <Text color={t.ui.dim}> ({count})</Text>
      )}
      {loading && <Text color={t.ui.muted}> loading…</Text>}
      {error && <Text color={t.ci.fail}>  ⚠ error — [r] retry</Text>}
    </Box>
  )
}

// ─── Main App ─────────────────────────────────────────────────────────────────

export function App({ repo }) {
  const { exit } = useApp()
  const { stdout } = useStdout()
  const columns = stdout?.columns || 80
  const rows = stdout?.rows || 24

  const [pane, setPane] = useState(_config.defaultPane)
  const [view, setView] = useState('list') // 'list'|'detail'|'diff'|'comments'
  const [selectedItem, setSelectedItem] = useState(null)   // item for full-screen views
  const [hoveredItem, setHoveredItem] = useState(null)     // item under cursor → side panel
  const [showHelp, setShowHelp] = useState(false)
  const [paneState, setPaneState] = useState({})           // {loading, error, count} from active pane

  // Dialog awareness: child panes call notifyDialog(true/false)
  const dialogActiveRef = useRef(false)
  const notifyDialog = useCallback((active) => {
    dialogActiveRef.current = active
  }, [])

  const appCtx = { notifyDialog }

  // ─── Layout breakpoints ───────────────────────────────────────────────────
  const showSidebar = columns >= 80
  const showDetailPanel = columns >= 100 && view === 'list' && pane === 'prs'
  const sidebarWidth = showSidebar ? 18 : 0
  const detailPanelWidth = showDetailPanel ? 40 : 0
  // Height available for list rows: rows - status(1) - footer(1) - border(2) - pane header(1)
  const listHeight = Math.max(3, rows - 5)

  // ─── Global key handler ───────────────────────────────────────────────────
  useInput((input, key) => {
    // Help overlay eats all keys
    if (showHelp) {
      setShowHelp(false)
      return
    }

    // While a dialog is open in a child pane, suppress global navigation
    if (dialogActiveRef.current) return

    // Tab / Shift+Tab — cycle panes (only when in list view)
    if (key.tab) {
      const idx = PANES.indexOf(pane)
      if (key.shift) {
        setPane(PANES[(idx - 1 + PANES.length) % PANES.length])
      } else {
        setPane(PANES[(idx + 1) % PANES.length])
      }
      setHoveredItem(null)
      setSelectedItem(null)
      setView('list')
      return
    }

    if (input === '?') {
      setShowHelp(true)
      return
    }

    // q / Escape — navigate back or quit
    if (input === 'q' || key.escape) {
      if (view === 'comments') { setView('diff'); return }
      if (view === 'diff') {
        setView(selectedItem?._fromList ? 'list' : 'detail')
        return
      }
      if (view === 'detail') {
        setSelectedItem(null)
        setView('list')
        return
      }
      // At list level — quit
      exit()
    }
  })

  // ─── Navigation callbacks (passed to child panes) ─────────────────────────
  const goToDetail = useCallback((item) => {
    setSelectedItem(item)
    setView('detail')
  }, [])

  const goToDiff = useCallback((item) => {
    setSelectedItem({ ...item, _fromList: view === 'list' })
    setView('diff')
  }, [view])

  const goToComments = useCallback(() => setView('comments'), [])

  const goBack = useCallback(() => {
    if (view === 'comments') { setView('diff'); return }
    if (view === 'diff') {
      setView(selectedItem?._fromList ? 'list' : 'detail')
      return
    }
    setSelectedItem(null)
    setView('list')
  }, [view, selectedItem])

  const onPaneState = useCallback((s) => setPaneState(s), [])

  // ─── Render active pane content ───────────────────────────────────────────

  function renderListPane() {
    switch (pane) {
      case 'prs':
        return (
          <PRList
            repo={repo}
            listHeight={listHeight}
            onHover={setHoveredItem}
            onSelectPR={goToDetail}
            onOpenDiff={goToDiff}
            onPaneState={onPaneState}
          />
        )
      case 'issues':
        return (
          <IssueList
            repo={repo}
            listHeight={listHeight}
            onSelectIssue={goToDetail}
            onPaneState={onPaneState}
          />
        )
      case 'branches':
        return <BranchList repo={repo} listHeight={listHeight} onPaneState={onPaneState} />
      case 'actions':
        return <ActionList repo={repo} listHeight={listHeight} onPaneState={onPaneState} />
      case 'notifications':
        return (
          <NotificationList
            repo={repo}
            listHeight={listHeight}
            onPaneState={onPaneState}
            onNavigateTo={(notif) => {
              const type = notif.subject?.type
              if (type === 'PullRequest') setPane('prs')
              else if (type === 'Issue') setPane('issues')
              setView('list')
            }}
          />
        )
      default:
        return <Box paddingX={1}><Text color={t.ui.muted}>Unknown pane</Text></Box>
    }
  }

  // ─── Footer keys per view ─────────────────────────────────────────────────
  function getFooterKeys() {
    if (view === 'diff') return [
      { key: 'j/k', label: 'scroll' }, { key: ']/[', label: 'file' },
      { key: 'n/N', label: 'thread' }, { key: 'c', label: 'comment' },
      { key: 'v', label: 'comments' }, { key: 'Esc', label: 'back' },
    ]
    if (view === 'detail') return [
      { key: 'd', label: 'diff' }, { key: 'r', label: 'refresh' }, { key: 'Esc', label: 'back' },
    ]
    if (view === 'comments') return [
      { key: 'j/k', label: 'nav' }, { key: 'r', label: 'reply' },
      { key: 'R', label: 'resolve' }, { key: 'Esc', label: 'back' },
    ]
    // list view — depends on pane
    const base = [
      { key: 'j/k', label: 'nav' },
      { key: 'Tab', label: 'pane' },
      { key: 'r', label: 'refresh' },
      { key: '/', label: 'search' },
      { key: '?', label: 'help' },
    ]
    if (pane === 'prs') return [
      ...base,
      { key: 'Enter', label: 'open' }, { key: 'd', label: 'diff' },
      { key: 'm', label: 'merge' }, { key: 'a', label: 'approve' },
    ]
    if (pane === 'issues') return [
      ...base, { key: 'Enter', label: 'open' }, { key: 'n', label: 'new' }, { key: 'x', label: 'close' },
    ]
    return base
  }

  // ─── Full-screen views (diff, comments, detail) ───────────────────────────
  if (view === 'diff' && selectedItem) {
    return (
      <AppContext.Provider value={appCtx}>
        <Box flexDirection="column">
          <PRDiff
            prNumber={selectedItem.number}
            repo={repo}
            onBack={goBack}
            onViewComments={goToComments}
          />
          <FooterKeys keys={getFooterKeys()} />
        </Box>
      </AppContext.Provider>
    )
  }

  if (view === 'comments' && selectedItem) {
    return (
      <AppContext.Provider value={appCtx}>
        <Box flexDirection="column">
          <PRComments
            prNumber={selectedItem.number}
            repo={repo}
            onBack={goBack}
            onJumpToDiff={() => setView('diff')}
          />
          <FooterKeys keys={getFooterKeys()} />
        </Box>
      </AppContext.Provider>
    )
  }

  if (view === 'detail' && selectedItem) {
    const DetailPane = pane === 'issues' ? IssueDetail : PRDetail
    return (
      <AppContext.Provider value={appCtx}>
        <Box flexDirection="column">
          <Box borderStyle="single" borderColor={t.ui.selected} flexDirection="column" flexGrow={1}>
            <DetailPane
              {...(pane === 'issues'
                ? { issueNumber: selectedItem.number }
                : { prNumber: selectedItem.number })}
              repo={repo}
              onBack={goBack}
              onOpenDiff={goToDiff}
            />
          </Box>
          <StatusBar repo={repo} pane={pane} count={paneState.count} />
          <FooterKeys keys={getFooterKeys()} />
        </Box>
      </AppContext.Provider>
    )
  }

  // ─── List view (main layout) ──────────────────────────────────────────────
  if (showHelp) {
    return (
      <AppContext.Provider value={appCtx}>
        <Box flexDirection="column" paddingX={1} paddingY={1}>
          <HelpOverlay pane={pane} onClose={() => setShowHelp(false)} />
        </Box>
      </AppContext.Provider>
    )
  }

  return (
    <AppContext.Provider value={appCtx}>
      <Box flexDirection="column">
        {/* ── Main row ── */}
        <Box flexDirection="row">
          {/* Sidebar */}
          {showSidebar && (
            <Sidebar
              currentPane={pane}
              visiblePanes={PANES}
              onSelect={(p) => {
                setPane(p)
                setHoveredItem(null)
                setSelectedItem(null)
                setView('list')
              }}
              height={rows - 2}
            />
          )}

          {/* List pane */}
          <Box
            flexDirection="column"
            flexGrow={1}
            borderStyle="single"
            borderColor={t.ui.selected}
          >
            <PaneHeader
              pane={pane}
              count={paneState.count}
              loading={paneState.loading}
              error={paneState.error}
            />
            {renderListPane()}
          </Box>

          {/* Detail side panel (≥100 cols, PRs only) */}
          {showDetailPanel && (
            <Box
              width={detailPanelWidth}
              flexDirection="column"
              borderStyle="single"
              borderColor={t.ui.border}
            >
              <Box paddingX={1}>
                <Text color={t.ui.muted} bold>Detail</Text>
              </Box>
              <PRSummaryPanel pr={hoveredItem} />
            </Box>
          )}
        </Box>

        {/* ── Status bar + footer ── */}
        <StatusBar repo={repo} pane={pane} count={paneState.count} />
        <FooterKeys keys={getFooterKeys()} />
      </Box>
    </AppContext.Provider>
  )
}

export function renderApp() {
  const repo = process.env.GHUI_REPO || ''
  render(<App repo={repo} />)
}
