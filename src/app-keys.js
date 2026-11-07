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

// Only keys app.jsx handles in EVERY view belong here. Tab and `,` stop at full-screen
// views (they are listed with the list view's keys below); `r`, `o` and `/` belong to
// whichever pane implements them, so contextHelpRows() lists them where they work (#449).
export const GLOBAL_KEYS = actionHints([
  'app.ai-assistant',
  'app.help',
  'command-palette.open',
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
  // The log viewer closes with Esc and has no re-run key; its own footer says the same (#463).
  logs: actionHints(['cursor.down', 'cursor.top', 'log.filter', 'dialog.cancel'], _config.toml).map(h => (h.label === 'cancel' ? { ...h, label: 'close' } : h)),
  // A failed run's log opens on its failure excerpt; `f` switches to the full log and back (#463).
  failedLogs: actionHints(['cursor.down', 'cursor.top', 'log.filter', 'log.excerpt', 'dialog.cancel'], _config.toml).map(h => (h.label === 'cancel' ? { ...h, label: 'close' } : h)),
  comment: actionHints(['dialog.next-field', 'dialog.editor', 'dialog.submit', 'dialog.cancel'], _config.toml),
}


// Digits jump panes from list views only (#450), so the help overlay lists them with
// the list view's keys rather than under "Global (any view)".
export const LIST_VIEW_KEYS = actionHints(['app.jump-pane'], _config.toml)

// Global keys that only work from a list view; the overlay appends them to the global
// block there, and leaves them out inside detail/diff/comments (#449).
export const LIST_GLOBAL_KEYS = actionHints(['app.next-pane', 'app.settings'], _config.toml)
