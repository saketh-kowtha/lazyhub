/**
 * config/docs.js — documentation/AI guidance model generated from TOML config.
 */

import { loadConfig } from './loader.js'

function table(headers, rows) {
  const head = `| ${headers.join(' | ')} |`
  const sep = `| ${headers.map(() => '---').join(' | ')} |`
  const body = rows.map(row => `| ${row.map(cell => String(cell ?? '').replace(/\|/g, '\\|')).join(' | ')} |`)
  return [head, sep, ...body].join('\n')
}

/**
 * Return structured config metadata suitable for docs or AI assist.
 * @param {Object} [config] merged TOML config
 * @returns {{panes:Array, actions:Array, theme:Object, defaults:Object}}
 */
export function getConfigDocumentationModel(config = loadConfig()) {
  const panes = Object.entries(config.panes || {}).map(([id, pane]) => ({
    id,
    label: pane.label || id,
    icon: pane.icon || '',
    description: pane.description || '',
  }))

  const actions = Object.entries(config.actions || {}).map(([id, action]) => ({
    id,
    keys: action.keys || [],
    hint: action.hint || action.keys?.join(' / ') || '',
    label: action.label || id,
    description: action.description || '',
    scope: action.scope || '',
    group: action.group || '',
  }))

  return {
    theme: config.theme || {},
    defaults: config.defaults || {},
    panes,
    actions,
  }
}

/**
 * Generate a Markdown reference from the TOML metadata.
 * @param {Object} [config] merged TOML config
 * @returns {string} markdown document
 */
export function generateConfigReferenceMarkdown(config = loadConfig()) {
  const model = getConfigDocumentationModel(config)
  const actions = [...model.actions].sort((a, b) => (a.scope + a.id).localeCompare(b.scope + b.id))

  return [
    '# lazyhub TOML Configuration Reference',
    '',
    'This page is generated from the same TOML metadata lazyhub uses at runtime.',
    '',
    '## Theme',
    '',
    table(['Key', 'Value'], [
      ['theme.name', model.theme.name || ''],
      ['defaults.pr_scope', model.defaults.pr_scope || ''],
      ['defaults.ai_provider', model.defaults.ai_provider || ''],
    ]),
    '',
    '## Panes',
    '',
    table(['ID', 'Icon', 'Label', 'Description'], model.panes.map(p => [p.id, p.icon, p.label, p.description])),
    '',
    '## Actions And Keys',
    '',
    table(
      ['Action', 'Keys', 'Label', 'Scope', 'Description'],
      actions.map(a => [a.id, a.keys.join(', '), a.label, a.scope, a.description])
    ),
    '',
  ].join('\n')
}
