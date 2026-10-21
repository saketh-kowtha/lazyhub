/**
 * config/migrate.js — one-shot state.json → lazyhub.toml migration.
 */

import { existsSync, readFileSync, unlinkSync } from 'fs'
import { dirname, join } from 'path'
import { ensurePrivateDir, writePrivateFile } from '../secure-fs.js'
import { homedir } from 'os'
import { parse } from 'smol-toml'
import { logger } from '../utils.js'
import { USER_CONFIG_PATH } from './loader.js'
import { writeConfig } from './writer.js'
import { isPlainObject } from './schema.js'

const LEGACY_STATE_PATH = join(homedir(), '.config', 'lazyhub', 'state.json')

function readTomlState(configPath) {
  if (!existsSync(configPath)) return undefined
  try {
    const raw = parse(readFileSync(configPath, 'utf8'))
    return isPlainObject(raw.state) ? raw.state : undefined
  } catch {
    return undefined
  }
}

/**
 * Migrate legacy state.json into [state] once.
 *
 * If [state] already exists, state.json is removed so the app does not keep two
 * state stores alive. If migration writes [state], the old JSON payload is kept
 * as state.json.bak and the original state.json is removed.
 *
 * @param {Object} [opts]
 * @param {string} [opts.statePath]
 * @param {string} [opts.configPath]
 * @param {string} [opts.backupPath]
 * @returns {{migrated:boolean, deleted:boolean, reason:string}}
 */
export function migrateStateJsonToToml(opts = {}) {
  const {
    statePath = LEGACY_STATE_PATH,
    configPath = USER_CONFIG_PATH,
    backupPath = `${statePath}.bak`,
  } = opts

  if (!existsSync(statePath)) return { migrated: false, deleted: false, reason: 'missing-state-json' }

  const existingState = readTomlState(configPath)
  if (existingState !== undefined) {
    try {
      unlinkSync(statePath)
      return { migrated: false, deleted: true, reason: 'toml-state-exists' }
    } catch (err) {
      logger.warn('config: could not delete legacy state.json', { error: err.message })
      return { migrated: false, deleted: false, reason: 'delete-failed' }
    }
  }

  let stateText
  let state
  try {
    stateText = readFileSync(statePath, 'utf8')
    state = JSON.parse(stateText)
  } catch (err) {
    logger.warn('config: could not read legacy state.json for migration', { error: err.message })
    return { migrated: false, deleted: false, reason: 'invalid-state-json' }
  }

  if (!isPlainObject(state)) return { migrated: false, deleted: false, reason: 'state-json-not-object' }

  writeConfig({ state }, { configPath })
  ensurePrivateDir(dirname(backupPath))
  writePrivateFile(backupPath, stateText.endsWith('\n') ? stateText : `${stateText}\n`)
  unlinkSync(statePath)
  logger.info('migrated state.json into lazyhub.toml; old file kept as state.json.bak')
  return { migrated: true, deleted: true, reason: 'migrated' }
}

// Pane icons shipped as defaults before #275 swapped them for single-width glyphs.
// Older releases copied the whole bundled config into the user file, pinning these.
const LEGACY_PANE_ICONS = {
  issues: '◎',
  branches: '⑂',
  actions: '⚡',
  notifications: '◈',
}
const SECTION_RE = /^\s*\[([^\[\]]+)\]\s*(?:#.*)?\s*$/
const ICON_RE = /^\s*icon\s*=\s*(["'])(.*)\1\s*(?:#.*)?\s*$/

/**
 * Drop `icon = "<old default>"` from [panes.<id>] so the current default applies.
 * Only an icon exactly equal to that pane's previous default is removed; any
 * customised icon, comments and all other content are left byte-for-byte intact.
 * Idempotent, and writes nothing when there is nothing to change.
 *
 * @param {Object} [opts]
 * @param {string} [opts.configPath]
 * @returns {{migrated:boolean, removed:string[]}} pane ids whose icon was removed
 */
export function migrateLegacyPaneIcons(opts = {}) {
  const { configPath = USER_CONFIG_PATH } = opts
  if (!existsSync(configPath)) return { migrated: false, removed: [] }

  let text
  try {
    text = readFileSync(configPath, 'utf8')
  } catch (err) {
    logger.warn('config: could not read config for pane icon migration', { error: err.message })
    return { migrated: false, removed: [] }
  }

  const removed = []
  /** @type {string|null} */
  let pane = null
  /** @type {string[]} */
  const lines = text.match(/[^\n]*\n|[^\n]+/g) || []
  const kept = lines.filter(line => {
    const section = line.match(SECTION_RE)
    if (section) {
      const m = section[1].trim().match(/^panes\.(\w+)$/)
      pane = m ? m[1] : null
      return true
    }
    const icon = pane === null ? null : line.match(ICON_RE)
    if (pane !== null && icon && LEGACY_PANE_ICONS[pane] === icon[2]) {
      removed.push(pane)
      return false
    }
    return true
  })

  if (removed.length === 0) return { migrated: false, removed }
  try {
    writePrivateFile(configPath, kept.join(''))
  } catch (err) {
    logger.warn('config: could not write pane icon migration', { error: err.message })
    return { migrated: false, removed: [] }
  }
  logger.info('migrated legacy pane icons to current defaults', { panes: removed })
  return { migrated: true, removed }
}
