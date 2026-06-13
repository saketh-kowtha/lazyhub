// @ts-nocheck
// TODO(#197): extracted app view renderer needs explicit prop typedefs after split.
import React from 'react'
import { Box, Text } from 'ink'
import { APP_CONFIG as _config, DIALOG_KEYS, PANES, PANE_ICONS, PANE_LABELS } from './app-keys.js'
import { AppContext } from './context.js'
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
import { TabView } from './features/tabs/view.jsx'
import { ErrorBoundary } from './components/ErrorBoundary.jsx'
import { AIAssistant } from './components/AIAssistant.jsx'
import { CommandPalette } from './components/CommandPalette.jsx'
import { HelpOverlay, PaneHeader } from './app-panels.jsx'
import { THEME_NAMES } from './theme.js'

export function renderAppView(ctx) {
  const {
    actionsBranch, activeScope, appCtx, appMode, borderStyle, columns, compactFooter,
    exit, ghHealth, goBack, goToActions, goToComments, goToConflict, goToDetail,
    goToDiff, handleAINavigate, leaderActive, listHeight, onPaneState, pane,
    paneState, repo, rows, selectedItem, setAppMode, setPane, setSelectedItem,
    setShowAI, setShowHelp, setShowPalette, setTheme, setView, showAI, showHelp,
    showPalette, showSidebar, sidebarWidth, t, toasts, view,
  } = ctx
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
          <StatusBar repo={repo} pane={pane} count={paneState.count} scopeIndicator={['global','pane','list'].includes(activeScope) ? null : activeScope.toUpperCase()} mode={appMode} ghHealth={ghHealth} />
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
                context={{ pane, view, selectedItem, repo, themeName: _config.theme }}
                onClose={() => { setShowPalette(false); setAppMode('NORMAL') }}
                onNavigate={(opts) => {
                  setShowPalette(false); setAppMode('NORMAL')
                  handleAINavigate(opts)
                }}
                onTheme={(name) => { setShowPalette(false); setAppMode('NORMAL'); setTheme(name) }}
                onQuit={() => exit()}
                themes={THEME_NAMES}
              />
            </Box>
          </Box>
          <StatusBar repo={repo} pane={pane} count={paneState.count} scopeIndicator={null} mode="COMMAND" ghHealth={ghHealth} />
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
          <StatusBar repo={repo} pane={pane} count={paneState.count} scopeIndicator={['global','pane','list'].includes(activeScope) ? null : activeScope.toUpperCase()} mode={appMode} ghHealth={ghHealth} />
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
          <StatusBar repo={repo} pane={pane} scopeIndicator={['global','pane','list'].includes(activeScope) ? null : activeScope.toUpperCase()} mode={appMode} ghHealth={ghHealth} />
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
          <StatusBar repo={repo} pane="logs" scopeIndicator={['global','pane','list'].includes(activeScope) ? null : activeScope.toUpperCase()} mode={appMode} ghHealth={ghHealth} />
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
          <StatusBar repo={repo} pane="settings" scopeIndicator={['global','pane','list'].includes(activeScope) ? null : activeScope.toUpperCase()} mode={appMode} ghHealth={ghHealth} />
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
          <StatusBar repo={repo} pane={pane} count={paneState.count} scopeIndicator={['global','pane','list'].includes(activeScope) ? null : activeScope.toUpperCase()} mode={appMode} ghHealth={ghHealth} />
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
        const customTab = (_config.customTabs || {})[pane]
        if (customTab) {
          return <TabView tab={customTab} repo={repo} />
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
    if (pane === 'prs')    return [...g1, { key: 'Enter', label: 'open', group: 2 }, { key: 'd', label: 'diff', group: 2 }, { key: 'f', label: 'filter', group: 2 }, { key: 'm', label: 'merge', group: 2 }, { key: 'M', label: 'auto-merge', group: 2 }, ...g3]
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
            <PaneHeader pane={pane} count={paneState.count} loading={paneState.loading} error={paneState.error} isStale={paneState.isStale} />
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
        <StatusBar repo={repo} pane={pane} count={paneState.count} scopeIndicator={['global','pane','list'].includes(activeScope) ? null : activeScope.toUpperCase()} mode={appMode} ghHealth={ghHealth} />
        <FooterKeys hidden={compactFooter} keys={listFooter} />
        {toasts.length > 0 && <Toaster toasts={toasts} />}
      </Box>
    </AppContext.Provider>
  )
}
