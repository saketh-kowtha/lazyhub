import { loadConfig } from './config.js'
import { actionHints } from './config/actions.js'

export const APP_CONFIG = loadConfig()
const _config = APP_CONFIG

// ─── Pane registry ───────────────────────────────────────────────────────────

export const PANES = _config.panes

// Merge built-in + custom so label/icon lookups work uniformly
export const PANE_LABELS = {}
export const PANE_ICONS  = {}
for (const [id, def] of Object.entries(_config.toml?.panes || {})) {
  PANE_LABELS[id] = def.label || id
  PANE_ICONS[id]  = def.icon || ''
}
for (const [id, def] of Object.entries(_config.customTabs || {})) {
  PANE_LABELS[id] = def.label || id
  PANE_ICONS[id] = def.icon || '▣'
}

// ─── Keyboard reference — shown by ? in every view ───────────────────────────

export const GLOBAL_KEYS = actionHints([
  'app.ai-assistant',
  'app.next-pane',
  'list.refresh',
  'pr.open-browser',
  'list.search',
  'app.help',
  'app.settings',
  'debug.dump-state',
  'app.back',
], _config.toml)

// Per-pane keys shown when view === 'list'
export const PANE_KEYS = {
  prs: actionHints([
    'cursor.down', 'cursor.top', 'pr.open-selected', 'pr.diff',
    'pr.filter-cycle', 'pr.merge', 'pr.auto-merge', 'pr.approve',
    'pr.request-changes', 'pr.labels', 'pr.assignees', 'pr.reviewers',
    'pr.checkout', 'pr.copy-url', 'pr.open-browser',
  ], _config.toml),
  issues: actionHints([
    'cursor.down', 'cursor.top', 'issue.open-selected', 'issue.filter-cycle',
    'issue.new', 'issue.close', 'issue.labels', 'issue.assignees',
    'issue.copy-url', 'issue.open-browser',
  ], _config.toml),
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
export const VIEW_KEYS = {
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
export const DIALOG_KEYS = {
  fuzzy: actionHints(['dialog.type', 'dialog.filter-down', 'dialog.confirm', 'dialog.cancel'], _config.toml),
  merge: actionHints(['dialog.down', 'dialog.confirm', 'dialog.next-field', 'dialog.submit', 'dialog.cancel'], _config.toml),
  multiselect: actionHints(['dialog.type', 'dialog.filter-down', 'dialog.toggle', 'dialog.confirm', 'dialog.cancel'], _config.toml),
  confirm: actionHints(['dialog.yes', 'dialog.no'], _config.toml),
  compose: actionHints(['dialog.next-field', 'dialog.editor', 'dialog.submit', 'dialog.cancel'], _config.toml),
  logs: actionHints(['cursor.down', 'cursor.top', 'log.filter', 'workflow.rerun', 'dialog.cancel'], _config.toml),
  comment: actionHints(['dialog.next-field', 'dialog.editor', 'dialog.submit', 'dialog.cancel'], _config.toml),
}

