/**
 * cli/doctor/config.js — lazyhub doctor --config.
 */

import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import { parse } from 'smol-toml'
import { validateConfig, mergeConfig, DEFAULT_CONFIG } from '../../config/schema.js'

const USER_CONFIG_PATH = join(homedir(), '.config', 'lazyhub', 'lazyhub.toml')

function formatError(err, source) {
  const where = typeof err.line === 'number' ? ` (line ${err.line}, column ${err.column})` : ''
  return `Invalid TOML in ${source}${where}: ${err.message}`
}

function countActionKeys(config) {
  const byAction = {}
  for (const [id, action] of Object.entries(config.actions || {})) {
    byAction[id] = new Set(action.keys || [])
  }
  for (const bindings of Object.values(config.keymaps || {})) {
    if (!bindings || typeof bindings !== 'object') continue
    for (const [key, actionId] of Object.entries(bindings)) {
      if (key === 'unbind' || typeof actionId !== 'string') continue
      byAction[actionId] ||= new Set()
      byAction[actionId].add(key)
    }
  }
  return Object.values(byAction).reduce((sum, keys) => sum + keys.size, 0)
}

/**
 *
 * @param opts
 */
export function checkConfig(opts = {}) {
  const configPath = opts.configPath || USER_CONFIG_PATH
  const checks = []
  const warnings = []
  let raw = {}

  checks.push({ ok: existsSync(configPath), label: `File ${existsSync(configPath) ? 'exists' : 'missing'}` })
  if (existsSync(configPath)) {
    try {
      raw = parse(readFileSync(configPath, 'utf8'))
      checks.push({ ok: true, label: 'Valid TOML syntax' })
    } catch (err) {
      checks.push({ ok: false, label: formatError(err, configPath) })
      return { ok: false, configPath, checks, warnings, summary: {} }
    }
  }

  const validation = validateConfig(raw)
  warnings.push(...validation.warnings)
  checks.push({ ok: validation.warnings.length === 0, label: validation.warnings.length === 0 ? 'Schema validation passed' : 'Schema validation has warnings' })

  const config = mergeConfig(DEFAULT_CONFIG, validation.config)
  const summary = {
    theme: config.theme?.name || '',
    actions: Object.keys(config.actions || {}).length,
    keyBindings: countActionKeys(config),
    tabs: config.tabs?.length || 0,
  }

  return { ok: checks.every(c => c.ok), configPath, checks, warnings, summary }
}

/**
 *
 * @param report
 * @param {object} root0
 * @param {boolean} [root0.json]
 */
export function formatConfigReport(report, { json = false } = {}) {
  if (json) return `${JSON.stringify(report, null, 2)}\n`
  const mark = ok => (ok ? '✓' : '✗')
  const lines = [
    `Config file: ${report.configPath}`,
    '',
    ...report.checks.map(c => `${mark(c.ok)} ${c.label}`),
    '',
    `Theme: ${report.summary.theme || 'default'}`,
    `Actions: ${report.summary.actions || 0}`,
    `Key bindings: ${report.summary.keyBindings || 0}`,
    `Custom tabs: ${report.summary.tabs || 0}`,
  ]
  if (report.warnings.length) {
    lines.push('', 'Warnings:', ...report.warnings.map(w => `⚠ ${w}`))
  }
  return `${lines.join('\n')}\n`
}
