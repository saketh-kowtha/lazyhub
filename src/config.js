/**
 * config.js — compatibility shim over lazyhub.toml.
 *
 * The runtime source of truth is `~/.config/lazyhub/lazyhub.toml`, loaded by
 * `src/config/loader.js`. This module keeps the historical `loadConfig()`
 * shape alive for older call sites while projecting every value from TOML.
 */

import { readFileSync } from 'fs'
import { dirname } from 'path'
import { ensurePrivateDir, tightenFile, writePrivateFile } from './secure-fs.js'
import { logger } from './utils-core.js'
import { migrateLegacyPaneIcons } from './config/migrate.js'
import { loadConfig as loadTomlConfig, USER_CONFIG_PATH } from './config/loader.js'
import { DEFAULT_CONFIG } from './config/schema.js'
import { readState as readTomlState, reportConfigWriteFailure, writeConfig as writeTomlConfig, writeState as writeTomlState } from './config/writer.js'

export const BUILTIN_PANES = ['prs', 'issues', 'branches', 'actions', 'notifications']
export const CONFIG_PATH = USER_CONFIG_PATH
const OPENAI_DEFAULT_BASE_URL = 'https://api.openai.com/v1'

function firstActionKey(actions, id, fallback) {
  const key = actions?.[id]?.keys?.[0]
  return typeof key === 'string' ? key : fallback
}

function scopeFromToml(scope) {
  return scope === 'mine' ? 'own' : scope
}

/**
 * Project [ai] TOML into the legacy camelCase shape, resolving endpoint defaults per provider.
 * @param {Object} [ai] raw [ai] table
 * @returns {Object} legacy ai config
 */
export function camelAi(ai = {}) {
  const provider = ai.provider || 'anthropic'
  // Older releases pinned the OpenAI default URL into the user file; for Ollama that
  // value is never intentional, so treat it as unset rather than leak to OpenAI.
  const fileUrl = provider === 'ollama' && ai.openai_base_url === OPENAI_DEFAULT_BASE_URL ? '' : ai.openai_base_url
  // Left empty when unset: each provider applies its own default endpoint (OpenAI ->
  // api.openai.com, Ollama -> localhost), so no default host is ever assumed here.
  const openaiBaseUrl = fileUrl || process.env.OPENAI_BASE_URL || ''
  return {
    provider,
    model:           ai.model || '',
    anthropicApiKey: ai.anthropic_api_key || process.env.ANTHROPIC_API_KEY || '',
    // An OpenAI key must never ride along to Ollama's default (keyless, local) endpoint.
    openaiApiKey:    provider === 'ollama' && !openaiBaseUrl ? '' : ai.openai_api_key || process.env.OPENAI_API_KEY || '',
    openaiBaseUrl,
    openai_compatible: ai.openai_compatible || {},
  }
}

function customPanesFromToml(toml) {
  const custom = {}
  for (const [id, pane] of Object.entries(toml.panes || {})) {
    if (BUILTIN_PANES.includes(id) || !pane?.command) continue
    custom[id] = {
      id,
      label: pane.label || id,
      icon: pane.icon || '✦',
      command: pane.command,
      actions: pane.actions || {},
    }
  }
  return custom
}

function tabsFromToml(toml) {
  const tabs = {}
  for (const tab of toml.tabs || []) {
    if (!tab?.id) continue
    tabs[tab.id] = {
      id: tab.id,
      label: tab.label || tab.id,
      icon: '▣',
      panes: Array.isArray(tab.panes) ? tab.panes : [],
      key: tab.key || '',
      order: Number.isInteger(tab.order) ? tab.order : 999,
    }
  }
  return tabs
}

function legacyFromToml(toml) {
  const customPanes = customPanesFromToml(toml)
  const customTabs = tabsFromToml(toml)
  const knownPanes = [...Object.keys(customTabs), ...BUILTIN_PANES, ...Object.keys(customPanes)]
  const panes = (toml.app?.active_panes || DEFAULT_CONFIG.app.active_panes)
    .filter(p => knownPanes.includes(p))
  if (panes.length === 0) panes.push('prs')

  const prFeature = toml.features?.prs || DEFAULT_CONFIG.features.prs
  const issueFeature = toml.features?.issues || DEFAULT_CONFIG.features.issues
  const actionFeature = toml.features?.actions || DEFAULT_CONFIG.features.actions
  const layout = toml.layout || DEFAULT_CONFIG.layout
  const diff = toml.diff || DEFAULT_CONFIG.diff
  const editor = toml.editor || DEFAULT_CONFIG.editor

  return {
    panes,
    defaultPane: panes.includes(toml.app?.default_pane) ? toml.app.default_pane : panes[0],
    theme: { name: toml.theme?.name || DEFAULT_CONFIG.theme.name, overrides: toml.theme?.overrides || {} },
    mouse: toml.app?.mouse === true,
    aiReviewEnabled: toml.app?.ai_review_enabled !== false,
    customPanes,
    customTabs,
    layout: {
      sidebarWidth:  layout.sidebar_width,
      sidebar:       layout.sidebar,
      previewPanel:  layout.preview_panel,
      previewWidth:  layout.preview_width,
      borderStyle:   layout.border_style,
      compactFooter: layout.compact_footer,
    },
    pr: {
      defaultFilter: prFeature.default_filter,
      defaultScope:  scopeFromToml(prFeature.default_scope),
      pageSize:      prFeature.page_size,
      keys: {
        filterOpen:   firstActionKey(toml.actions, 'pr.filter-open', 'O'),
        filterClosed: firstActionKey(toml.actions, 'pr.filter-closed', 'C'),
        filterMerged: firstActionKey(toml.actions, 'pr.filter-merged', 'M'),
      },
    },
    issues: {
      defaultFilter: issueFeature.default_filter,
      pageSize:      issueFeature.page_size,
      keys: {
        filterOpen:   firstActionKey(toml.actions, 'issue.filter-open', 'O'),
        filterClosed: firstActionKey(toml.actions, 'issue.filter-closed', 'C'),
      },
    },
    actions: { pageSize: actionFeature.page_size },
    diff: {
      defaultView:     diff.default_view,
      syntaxHighlight: diff.syntax_highlight,
      maxLines:        diff.max_lines,
    },
    editor: {
      command:       editor.command,
      customCommand: editor.custom_command || null,
    },
    ipc: { enabled: toml.ipc?.enabled !== false },
    ai: camelAi(toml.ai),
    toml,
  }
}

/**
 * Load app config from lazyhub.toml and expose the legacy object shape.
 * @returns {Object} compatibility config object
 */
export function loadConfig() {
  return legacyFromToml(loadTomlConfig())
}

/**
 * Load persisted UI state from [state].
 * @returns {Object} state table
 */
export function loadState() {
  return readTomlState()
}

/**
 * Persist a partial UI state patch to [state].
 * @param {Object} patch state keys to merge
 */
export function saveState(patch) {
  writeTomlState(patch)
}

/**
 * An API key resolved from the environment (and absent from the file) is not a
 * setting the user made, so it is never written back to lazyhub.toml.
 * @param {string|undefined} value key in the patch
 * @param {string|undefined} fileValue key already in the file
 * @param {string|undefined} envValue key from the environment
 * @returns {string|undefined} the key to persist, if any
 */
function persistableKey(value, fileValue, envValue) {
  if (!value) return value
  return !fileValue && value === envValue ? undefined : value
}

function patchToToml(patch) {
  const out = {}
  if ('theme' in patch) out.theme = typeof patch.theme === 'string' ? { name: patch.theme } : patch.theme
  if ('aiReviewEnabled' in patch) out.app = { ...(out.app || {}), ai_review_enabled: patch.aiReviewEnabled !== false }
  if ('mouse' in patch) out.app = { ...(out.app || {}), mouse: patch.mouse === true }
  if ('panes' in patch) out.app = { ...(out.app || {}), active_panes: patch.panes }
  if (patch.pr?.pageSize) out.features = { ...(out.features || {}), prs: { page_size: patch.pr.pageSize } }
  if (patch.ai) {
    const fileAi = loadTomlConfig().ai || {}
    out.ai = {
      provider:          patch.ai.provider,
      model:             patch.ai.model,
      anthropic_api_key: persistableKey(patch.ai.anthropicApiKey, fileAi.anthropic_api_key, process.env.ANTHROPIC_API_KEY),
      openai_api_key:    persistableKey(patch.ai.openaiApiKey, fileAi.openai_api_key, process.env.OPENAI_API_KEY),
      openai_base_url:   patch.ai.openaiBaseUrl,
      openai_compatible: patch.ai.openai_compatible || patch.ai.openaiCompatible,
    }
  }
  return out
}

/**
 * Persist settings-owned config to lazyhub.toml.
 * @param {Object} patch legacy config-shaped patch
 */
export function saveConfig(patch) {
  try {
    writeTomlConfig(patchToToml(patch))
  } catch (err) {
    reportConfigWriteFailure(err)
  }
}

/**
 * Repository saved by first-run onboarding ([defaults].repo), or null.
 * It is only a fallback: a repository detected from the current directory wins.
 * @returns {string|null} "owner/name"
 */
export function loadSavedRepo() {
  const { repo, repo_host: host } = loadTomlConfig().defaults ?? {}
  if (!repo) return null
  // A repo saved under another host must not be queried on this one.
  if (host && host.toLowerCase() !== (process.env.GH_HOST || 'github.com').toLowerCase()) return null
  return repo
}

/**
 * Persist the repository chosen when onboarding completed ([defaults].repo),
 * through the same private-mode writer as every other config write.
 * @param {string} repo "owner/name"
 */
export function saveDefaultRepo(repo) {
  try {
    writeTomlConfig({ defaults: { repo, repo_host: process.env.GH_HOST || 'github.com' } })
  } catch (err) {
    reportConfigWriteFailure(err)
  }
}

const SPARSE_CONFIG_HEADER = `# lazyhub configuration (TOML).
# Only settings you choose are stored here. Everything else follows the built-in
# defaults, so upgrades can improve them. See docs/CONFIG_REFERENCE.md for every key.
`

/**
 * Create a sparse lazyhub.toml (comment header only) if it does not exist; otherwise
 * tighten its permissions and migrate legacy pinned pane icons.
 * @param {string} [configPath] user config path (defaults to CONFIG_PATH)
 */
export function writeDefaultConfig(configPath = CONFIG_PATH) {
  try {
    readFileSync(configPath, 'utf8')
    // Migrate files written by older releases with default (world-readable) modes.
    try { ensurePrivateDir(dirname(configPath)); tightenFile(configPath) } catch (err) {
      logger.warn('config: could not tighten config permissions', { error: err.message })
    }
    // Older releases pinned the then-default pane icons into the user file (B-63).
    try { migrateLegacyPaneIcons({ configPath }) } catch (err) {
      logger.warn('config: pane icon migration failed', { error: err.message })
    }
  } catch {
    try {
      ensurePrivateDir(dirname(configPath))
      // Sparse on purpose (#475): never copy the bundled defaults here. A copy pins every
      // default, so later default changes (new key scopes, renamed actions) would be
      // overridden by the frozen values. Only settings the user chooses get written.
      writePrivateFile(configPath, SPARSE_CONFIG_HEADER)
    } catch (err) {
      // Non-fatal: defaults are bundled and loaded in-memory.
      logger.warn('config: could not write default lazyhub.toml', { error: err.message })
    }
  }
}
