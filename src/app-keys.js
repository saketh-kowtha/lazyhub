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
// Context keys (per pane/view) are generated from the registry by
// contextHelpRows() in ui/actions.js; only the global block lives here.

export const GLOBAL_KEYS = actionHints([
  'app.ai-assistant',
  'app.next-pane',
  'list.refresh',
  'pr.open-browser',
  'list.search',
  'app.help',
  'app.settings',
  'go.home',
  'go.prs',
  'go.issues',
  'go.branches',
  'go.actions',
  'go.notifications',
  'debug.dump-state',
  'app.back',
], _config.toml)

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

