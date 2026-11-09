// @ts-nocheck
// TODO(#197): extracted app view renderer needs explicit prop typedefs after split.
import React from 'react'
import { Box, Text } from 'ink'
import { APP_CONFIG as _config, DIALOG_KEYS, PANES, PANE_ICONS, PANE_LABELS } from './app-keys.js'
import { hintLine } from './config/actions.js'
import { TooSmall } from './components/TooSmall.jsx'
import { TabStrip } from './components/TabStrip.jsx'
import { Shell, LeaderHint } from './shell/Shell.jsx'
import { scopeIndicator } from './shell/scopeIndicator.js'
import { PRList } from './features/prs/list.jsx'
import { PRDetail } from './features/prs/detail.jsx'
import { EvidenceView } from './features/prs/EvidenceView.jsx'
import { returnTarget } from './executor/evidence-detail.js'
import { PRDiff } from './features/prs/diff.jsx'
import { StoryView } from './features/prs/story/StoryView.jsx'
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
import { ReviewQueue } from './features/queue/view.jsx'
import { ErrorBoundary } from './components/ErrorBoundary.jsx'
import { AIAssistant } from './components/AIAssistant.jsx'
import { CommandPalette } from './components/CommandPalette.jsx'
import { RepoSwitcher } from './features/onboarding/Onboarding.jsx'
import { HelpOverlay, PaneHeader } from './app-panels.jsx'
import { THEME_NAMES } from './theme.js'
import { contextFooterHints } from './ui/actions.js'

export function renderAppView(ctx) {
  const {
    actionsBranch, actionsRepo, itemIsForeign, activeScope, appCtx, appMode, borderStyle, columns, compactFooter,
    exit, ghHealth, goBack, goToActions, goToComments, goToConflict, goToDetail, goToPRRow,
    goToDiff, goToQueueItem, goToEvidenceDetail, returnFromEvidence, goToStory, openStoryFile, storyNav, handleAINavigate, leaderActive, listHeight, onPaneState, pane,
    paneState, repo, rows, selectedItem, setAppMode, setPane, setSelectedItem,
    setShowAI, setShowHelp, setShowPalette, setTheme, setView, showAI, showHelp,
    showPalette, showSidebar, sidebarWidth, t, toasts, view, tooSmall, minCols, minRows, termRows,
    showRepoPicker, setShowRepoPicker, onSwitchRepo,
  } = ctx
  // Items opened from a dashboard section keep that section's repository (#493).
  const itemRepo = selectedItem?._repo || repo
  // What differs per view is passed to <Shell>; the frame itself is defined once there (#488).
  const scopeChip = scopeIndicator(activeScope)
  const statusFor = (extra) => ({ repo, pane, count: paneState.count, scopeIndicator: scopeChip, mode: appMode, ghHealth, ...extra })
  const sidebarFor = (onSelect, extra) => showSidebar ? {
    currentPane: pane, visiblePanes: PANES, width: sidebarWidth, borderStyle, paneLabels: PANE_LABELS,
    paneIcons: PANE_ICONS, repo, onSelect, ...extra,
  } : null
  const toList = (p) => { setPane(p); setSelectedItem(null); setView('list') }
  const frame = { appCtx, rows, compactFooter }
  // ─── Below the minimum size: one clear message instead of a broken frame ──
  if (tooSmall) return <TooSmall cols={columns} rows={rows} termRows={termRows} minCols={minCols} minRows={minRows} />
  // ─── AI assistant overlay ─────────────────────────────────────────────────
  if (showAI) {
    return (
      <Shell {...frame} overflow="hidden" bodyProps={{ overflow: 'hidden' }}
        sidebar={sidebarFor((p) => { setPane(p); setShowAI(false); setSelectedItem(null); setView('list') })}
        status={statusFor()}
        footer={[{ key: 'Esc', label: 'close AI' }, { key: 'j/k', label: 'scroll' }, { key: 'Enter', label: 'send' }]}>
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
      </Shell>
    )
  }

  // ─── Repository picker (palette: Switch repository, #466) ───────────────
  if (showRepoPicker) {
    return (
      <Shell {...frame} overflow="hidden" bodyProps={{ overflow: 'hidden', justifyContent: 'center', alignItems: 'flex-start', paddingY: 1 }}
        status={statusFor({ scopeIndicator: null, mode: 'COMMAND' })}>
        <ErrorBoundary>
          <RepoSwitcher onDone={(result) => {
            setShowRepoPicker(false)
            if (result.status === 'completed' && result.repo.toLowerCase() !== String(repo).toLowerCase()) onSwitchRepo?.(result.repo)
          }} />
        </ErrorBoundary>
      </Shell>
    )
  }

  // ─── Command palette overlay ──────────────────────────────────────────────
  if (showPalette) {
    return (
      <Shell {...frame} overflow="hidden" bodyProps={{ overflow: 'hidden', justifyContent: 'center', alignItems: 'flex-start', paddingY: 2 }}
        status={statusFor({ scopeIndicator: null, mode: 'COMMAND' })}
        footer={[{ key: '↑↓', label: 'nav' }, { key: 'Tab', label: 'complete' }, { key: 'Enter', label: 'run' }, { key: 'Esc', label: 'cancel' }]}>
        <Box width={Math.min(columns - 4, 80)}>
          <CommandPalette
            context={{ pane, view, selectedItem, repo: itemRepo, localGit: !itemIsForeign, themeName: _config.theme, onSwitchRepo: () => setShowRepoPicker(true) }}
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
      </Shell>
    )
  }

  // ─── Help overlay — rendered first so ? works from every view ────────────
  if (showHelp) {
    return (
      <Shell {...frame} overflow="hidden" bodyProps={{ overflow: 'hidden' }}
        sidebar={sidebarFor((p) => { setPane(p); setShowHelp(false); setSelectedItem(null); setView('list') })}
        status={statusFor()}
        footer={[{ key: '? / Esc / Enter', label: 'close help' }]}>
        <Box flexDirection="column" flexGrow={1} overflow="hidden" justifyContent="center" alignItems="center">
          <HelpOverlay pane={view === 'detail' && selectedItem?._kind ? selectedItem._kind : pane} view={view} actionCtx={paneState.actionCtx} onClose={() => setShowHelp(false)}
            availableWidth={columns - (showSidebar ? sidebarWidth : 0)} availableHeight={rows - (compactFooter ? 1 : 3)} />
        </Box>
      </Shell>
    )
  }

  // ─── Full-screen views ────────────────────────────────────────────────────
  if (view === 'evidence' && selectedItem) {
    const evRepo = itemRepo
    return (
      <Shell {...frame} bodyProps={null}>
        <ErrorBoundary>
          <EvidenceView
            pr={{ number: selectedItem.number, title: selectedItem.title }}
            repo={evRepo}
            onClose={() => returnFromEvidence(selectedItem._fromQueue ? { view: 'queue' } : undefined)}
            onOpenDiff={goToDiff}
            onOpenDetail={goToEvidenceDetail}
            returnTo={selectedItem._fromQueue ? returnTarget({ view: 'queue', key: `${evRepo}#${selectedItem.number}` }) : undefined}
            onReturn={returnFromEvidence}
          />
        </ErrorBoundary>
      </Shell>
    )
  }

  if (view === 'conflict' && selectedItem) {
    return (
      <Shell {...frame} bodyProps={{ overflow: 'hidden' }}
        status={statusFor({ repo: itemRepo, count: undefined })}
        footer={[
          { key: 'j/k', label: 'navigate' },
          { key: 'e/Enter', label: 'open editor' },
          { key: 'Space', label: 'stage/unstage' },
          { key: 'c', label: 'commit + push' },
          { key: 'Esc', label: 'back' },
        ]}>
        <ErrorBoundary>
          <ConflictView pr={selectedItem} repo={itemRepo} onBack={goBack} onResolved={() => setView('detail')} />
        </ErrorBoundary>
      </Shell>
    )
  }

  if (view === 'diff' && selectedItem) {
    return (
      <Shell {...frame} overflow="hidden" bodyProps={null}>
        <ErrorBoundary>
          <PRDiff
            prNumber={selectedItem.number}
            repo={itemRepo}
            onBack={goBack}
            onViewComments={goToComments}
            initialFile={storyNav?.active ? storyNav.file : undefined}
          />
        </ErrorBoundary>
      </Shell>
    )
  }

  if (view === 'story' && selectedItem) {
    return (
      <Shell {...frame} bodyProps={{ flexDirection: 'column', overflow: 'hidden' }}
        status={statusFor({ repo: itemRepo, count: undefined })}
        footer={[
          { key: 'n/p', label: 'step' },
          { key: 'j/k', label: 'file' },
          { key: 'Enter', label: 'open diff' },
          { key: 'Space', label: 'expand' },
          { key: 'Esc', label: 'back' },
        ]}>
        <ErrorBoundary>
          <StoryView prNumber={selectedItem.number} repo={itemRepo} onBack={goBack}
            onOpenFile={openStoryFile} initial={storyNav?.pos} />
        </ErrorBoundary>
      </Shell>
    )
  }

  if (view === 'comments' && selectedItem) {
    return (
      <Shell {...frame} overflow="hidden" bodyProps={null}>
        <ErrorBoundary>
          <PRComments
            prNumber={selectedItem.number}
            repo={itemRepo}
            onBack={goBack}
            onJumpToDiff={() => setView('diff')}
          />
        </ErrorBoundary>
      </Shell>
    )
  }

  if (view === 'logs') {
    return (
      <Shell {...frame} sidebar={sidebarFor(toList)}
        status={statusFor({ pane: 'logs', count: undefined })}
        footer={[
          { key: 'j/k', label: 'navigate' },
          { key: 'Enter', label: 'detail' },
          { key: 'f', label: 'level' },
          { key: '/', label: 'search' },
          { key: 'Esc', label: 'back' }
        ]}>
        <ErrorBoundary>
          <LogPane onBack={() => setView('list')} />
        </ErrorBoundary>
      </Shell>
    )
  }

  if (view === 'queue') {
    return (
      <Shell {...frame} sidebar={sidebarFor(toList)}
        status={statusFor({ count: undefined })}
        footer={contextFooterHints(pane, 'queue', {}, _config.toml)}>
        <ErrorBoundary>
          {/* goToQueueItem is the only place that decides what Enter opens (the evidence view, #127). */}
          <ReviewQueue onOpen={goToQueueItem} innerWidth={columns - (showSidebar ? sidebarWidth : 0) - 2} listHeight={listHeight} />
        </ErrorBoundary>
      </Shell>
    )
  }

  if (view === 'settings') {
    return (
      <Shell {...frame} sidebar={sidebarFor(toList)}
        status={statusFor({ pane: 'settings', count: undefined })}
        footer={[
          { key: 'j/k', label: 'navigate' },
          { key: 'Enter', label: 'select' },
          { key: '?', label: 'help' },
          { key: 'Esc', label: 'back' }
        ]}>
        <ErrorBoundary>
          <SettingsPane onBack={() => setView('list')} />
        </ErrorBoundary>
      </Shell>
    )
  }

  if (view === 'detail' && selectedItem) {
    // A dashboard tab (Focus) opens items of either kind; the item says which.
    const detailKind = selectedItem._kind || pane
    const DetailPane = detailKind === 'issues' ? IssueDetail : PRDetail
    const detailFooter = contextFooterHints(detailKind, 'detail', paneState.actionCtx, _config.toml)

    return (
      <Shell {...frame} bodyProps={{ flexDirection: 'column' }}
        status={statusFor({ repo: itemRepo })} footer={detailFooter}>
        <ErrorBoundary>
          <DetailPane
            {...(detailKind === 'issues'
              ? { issueNumber: selectedItem.number }
              : { prNumber: selectedItem.number, baseRefName: selectedItem.baseRefName, entry: selectedItem._entry })}
            repo={itemRepo}
            onBack={goBack}
            onOpenDiff={goToDiff}
            onOpenStory={detailKind === 'prs' ? goToStory : undefined}
            onOpenConflict={detailKind === 'prs' ? goToConflict : undefined}
            onOpenActions={detailKind === 'prs' ? goToActions : undefined}
            onViewComments={detailKind === 'prs' ? goToComments : undefined}
            onPaneState={detailKind === 'prs' ? onPaneState : undefined}
          />
        </ErrorBoundary>
      </Shell>
    )
  }

  // ─── List view ────────────────────────────────────────────────────────────
  // Columns inside the pane border: what every list row may use (the width contract, #512).
  const listInnerWidth = columns - (showSidebar ? sidebarWidth : 0) - 2
  function renderListPane() {
    switch (pane) {
      case 'prs': return (
        <PRList repo={repo} listHeight={listHeight}
          innerWidth={listInnerWidth}
          onSelectPR={goToPRRow}
          onOpenDiff={goToDiff} onPaneState={onPaneState} />
      )
      case 'issues': return (
        <IssueList repo={repo} listHeight={listHeight} innerWidth={listInnerWidth}
          onSelectIssue={goToDetail} onPaneState={onPaneState} />
      )
      case 'branches':     return <BranchList repo={repo} listHeight={listHeight} innerWidth={listInnerWidth} onPaneState={onPaneState} />
      case 'actions':      return <ActionList repo={actionsRepo || repo} listHeight={listHeight} innerWidth={listInnerWidth} onPaneState={onPaneState} initialBranch={actionsBranch} />
      case 'notifications': return (
        <NotificationList repo={repo} listHeight={listHeight} innerWidth={listInnerWidth} onPaneState={onPaneState}
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
          return <TabView tab={customTab} repo={repo} innerWidth={listInnerWidth} listHeight={listHeight} onOpenItem={(item, kind, itemRepo) => goToDetail({ ...item, _kind: kind, _repo: itemRepo })} />
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
    'comment-pr':    DIALOG_KEYS.compose,
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
    'failed-logs':   DIALOG_KEYS.failedLogs,
    // Confirms and forms opened from list panes (#468): same hints as their siblings above.
    'merge-confirm': DIALOG_KEYS.confirm,
    'auto-merge':    DIALOG_KEYS.confirm,
    'close':         DIALOG_KEYS.confirm,
    'delete':        DIALOG_KEYS.confirm,
    'rerun':         DIALOG_KEYS.confirm,
    'cancel':        DIALOG_KEYS.confirm,
    'new':           DIALOG_KEYS.compose,
  }

  const listFooter = (() => {
    if (paneState.dialogHint && DIALOG_HINT_MAP[paneState.dialogHint]) {
      return DIALOG_HINT_MAP[paneState.dialogHint]
    }
    return contextFooterHints(pane, 'list', paneState.actionCtx, _config.toml)
  })()

  const paneSwitch = (p) => { toList(p); setAppMode('NORMAL') }

  return (
    <Shell {...frame} overflow="hidden" bodyProps={{ overflow: 'hidden' }}
      // Compact mode: horizontal tab strip replaces sidebar
      header={!showSidebar && (
        <TabStrip panes={PANES} currentPane={pane} paneLabels={PANE_LABELS} paneIcons={PANE_ICONS} onSelect={paneSwitch} />
      )}
      sidebar={sidebarFor(paneSwitch, { borderRight: false })} sidebarBoundary
      leaderHint={leaderActive && <LeaderHint text={hintLine(['app.leader-theme', 'app.leader-ai', 'app.leader-help'], _config.toml)} />}
      status={statusFor()} footer={listFooter} toasts={toasts}>
      <Box flexDirection="column" flexGrow={1} overflow="hidden"
           borderStyle={borderStyle || 'round'}
           borderColor={t.ui.borderActive}>
        <ErrorBoundary section="Pane header">
          <PaneHeader pane={pane} count={paneState.count} loading={paneState.loading} error={paneState.error} isStale={paneState.isStale} />
        </ErrorBoundary>
        <Box flexGrow={1} flexDirection="column" overflow="hidden">
          <ErrorBoundary>
            {renderListPane()}
          </ErrorBoundary>
        </Box>
      </Box>
    </Shell>
  )
}
