#!/usr/bin/env node
// Regenerates the machine-derived parts of the GitHub Pages site from the shipped config:
//
//   node scripts/gen-site.mjs           rewrite docs/keybindings.html and docs/config.html
//   node scripts/gen-site.mjs --check   exit 1 if either page is stale (src/docs-site.test.js runs this check)
//
// docs/keybindings.html: every key comes from the [actions.*] registry in src/config/defaultConfig.toml.
// docs/config.html: the defaults tables come from the same file (values parsed, notes from its comments).
// Only the text between the gen:*:start / gen:*:end markers is replaced; the prose around it is hand-written.

import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { parse } from 'smol-toml'

const ROOT = new URL('../', import.meta.url)
const TOML_PATH = fileURLToPath(new URL('src/config/defaultConfig.toml', ROOT))
const PAGES = {
  keys: fileURLToPath(new URL('docs/keybindings.html', ROOT)),
  config: fileURLToPath(new URL('docs/config.html', ROOT)),
}

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** Action scope -> page section, in display order. A scope missing here makes the generator fail on purpose. */
export const SECTIONS = [
  { scope: 'global', id: 'global', title: 'Everywhere', blurb: 'Work in every view that is not typing into a field.' },
  { scope: 'queue-list', id: 'queue', title: 'Review queue', blurb: 'Open it with g q. Each row says why the PR is there.' },
  { scope: 'tab-list', id: 'focus', title: 'Focus and custom tabs', blurb: 'The Focus dashboard and any tab declared in your config.' },
  { scope: 'list', id: 'lists', title: 'Lists', blurb: 'Movement and search in every list.' },
  { scope: 'pr-list', id: 'pr-list', title: 'Pull request list', blurb: '' },
  { scope: 'pr-detail', id: 'pr-detail', title: 'Pull request detail', blurb: 'Includes the read-only evidence, claims, collisions, story and why-red views.' },
  { scope: 'pr-story', id: 'story', title: 'Review story', blurb: 'Opened with s from a pull request.' },
  { scope: 'pr-checks', id: 'checks', title: 'CI checks', blurb: '' },
  { scope: 'diff', id: 'diff', title: 'Diff', blurb: '' },
  { scope: 'pr-comments', id: 'comments', title: 'PR comments', blurb: '' },
  { scope: 'issue-list', id: 'issue-list', title: 'Issue list', blurb: '' },
  { scope: 'issue-detail', id: 'issue-detail', title: 'Issue detail', blurb: '' },
  { scope: 'branch-list', id: 'branches', title: 'Branches', blurb: '' },
  { scope: 'workflow-list', id: 'actions', title: 'Actions (workflow runs)', blurb: '' },
  { scope: 'notification-list', id: 'notifications', title: 'Notifications', blurb: '' },
  { scope: 'leader', id: 'leader', title: 'Leader (Space)', blurb: 'Press Space, then one of these.' },
  { scope: 'dialog', id: 'dialogs', title: 'Dialogs and pickers', blurb: '' },
  { scope: 'settings', id: 'settings', title: 'Settings', blurb: 'Opened with a comma. Movement and Esc use the shared list and back keys.' },
  { scope: 'conflict', id: 'conflict', title: 'Resolve conflicts', blurb: 'Opened with C from a conflicting pull request.' },
  { scope: 'new-pr', id: 'new-pr', title: 'New pull request', blurb: 'Push prompts shown before the form.' },
  { scope: 'collisions', id: 'collisions', title: 'Collisions radar', blurb: 'Opened with K from a pull request.' },
  { scope: 'logs', id: 'logs', title: 'Debug logs', blurb: 'Available with LAZYHUB_DEBUG=1.' },
  { scope: 'ai', id: 'ai', title: 'AI review and assistant', blurb: '' },
  { scope: 'custom-pane', id: 'custom-pane', title: 'Custom panes', blurb: 'Panes declared with [panes.<name>] in your config.' },
  { scope: 'onboarding', id: 'onboarding', title: 'First-run setup', blurb: '' },
]

/** @returns {Record<string, any>} the shipped defaults, parsed */
export function readDefaults() {
  return parse(readFileSync(TOML_PATH, 'utf8'))
}

/**
 * Render one key string from the registry (`g h`, `Ctrl+D`, `<space><space>`, `gg`).
 * @param {string} key
 * @returns {string} HTML
 */
export function renderKey(key) {
  if (key === 'type') return '<em>type</em>'
  if (key === '<space><space>') return '<kbd>Space</kbd> <kbd>Space</kbd>'
  if (/^g[g]$/.test(key)) return '<kbd>g</kbd> <kbd>g</kbd>'
  return key.split(' ').map(k => `<kbd>${esc(k)}</kbd>`).join(' ')
}

/**
 * Render an action's key list, collapsing a run of digits (1..9) to a range.
 * @param {string[]} keys
 * @returns {string} HTML
 */
export function renderKeys(keys) {
  if (!keys.length) return '<span class="muted">no default key (command palette)</span>'
  if (keys.length > 2 && keys.every((k, i) => k === String(i + 1))) return `<kbd>${keys[0]}</kbd> to <kbd>${keys.at(-1)}</kbd>`
  return keys.map(renderKey).join(' or ')
}

/**
 * Group the action registry by page section.
 * @param {Record<string, any>} defaults parsed defaultConfig.toml
 * @returns {{section: typeof SECTIONS[number], rows: {id: string, keys: string[], text: string}[]}[]}
 */
export function keyModel(defaults) {
  const known = new Set(SECTIONS.map(s => s.scope))
  const bySection = new Map(SECTIONS.map(s => [s.scope, []]))
  for (const [id, action] of Object.entries(defaults.actions || {})) {
    const scopes = String(action.scope || '').split(',').map(s => s.trim()).filter(Boolean)
    if (!scopes.length) throw new Error(`action ${id} has no scope; give it one so the site lists it`)
    for (const scope of scopes) {
      if (!known.has(scope)) throw new Error(`action ${id} uses scope "${scope}" which scripts/gen-site.mjs does not know; add it to SECTIONS`)
      bySection.get(scope).push({ id, keys: action.keys || [], text: action.description || action.label || id })
    }
  }
  // Actions that exist only to be listed elsewhere (a bare key with no label) still appear, so nothing is hidden.
  return SECTIONS.map(section => ({ section, rows: bySection.get(section.scope) })).filter(s => s.rows.length)
}

/**
 * The generated HTML between the key markers.
 * @param {Record<string, any>} defaults
 * @returns {string}
 */
export function renderKeysHtml(defaults) {
  const model = keyModel(defaults)
  const toc = model.map(({ section }) => `<a href="#${section.id}">${esc(section.title)}</a>`).join('\n      ')
  const cards = model.map(({ section, rows }) => {
    const body = rows.map(r => `          <tr><th scope="row">${renderKeys(r.keys)}</th><td>${esc(r.text)}</td></tr>`).join('\n')
    return `    <section class="card" id="${section.id}" aria-labelledby="h-${section.id}">
      <h2 id="h-${section.id}">${esc(section.title)}</h2>${section.blurb ? `\n      <p class="muted">${esc(section.blurb)}</p>` : ''}
      <table>
        <caption class="sr-only">${esc(section.title)} keys</caption>
        <tbody>
${body}
        </tbody>
      </table>
    </section>`
  }).join('\n')
  return `    <nav class="toc" aria-label="Sections">
      ${toc}
    </nav>
    <div class="cards">
${cards}
    </div>`
}

/** Short notes for config keys whose TOML line has no comment. Optional: a missing note renders blank. */
const NOTES = {
  'app.active_panes': 'Panes shown, in Tab order.',
  'app.default_pane': 'Pane opened at startup.',
  'app.mouse': 'Mouse scrolling (also --mouse).',
  'app.ai_review_enabled': 'Allow the AI review actions.',
  'theme.name': 'Built-in theme, or a user theme.',
  'features.prs.default_filter': 'State filter of the PR list at launch.',
  'features.prs.default_scope': 'mine, reviewing or all. The last scope you used is remembered afterwards.',
  'features.prs.page_size': 'PRs fetched per page.',
  'features.issues.page_size': 'Issues fetched per page.',
  'features.actions.page_size': 'Workflow runs fetched per page.',
  'layout.sidebar_width': 'Columns used by the sidebar.',
  'layout.sidebar': 'Show the sidebar when the terminal is wide enough.',
  'layout.preview_panel': 'Show the PR preview that floats over the list.',
  'layout.preview_width': 'Columns used by the preview.',
  'layout.border_style': 'Border glyph set.',
  'layout.compact_footer': 'One-line footer.',
  'diff.default_view': 'unified or split.',
  'diff.syntax_highlight': 'Highlight code in diffs.',
  'editor.command': 'Editor for open-in-editor actions; auto picks one.',
  'editor.custom_command': 'Used when command is set to custom.',
}

/**
 * Raw value of `key` in `[section]` plus its trailing comment, from the TOML text.
 * @param {string} text
 * @returns {Map<string, string>} "section.key" -> comment
 */
export function tomlComments(text) {
  const out = new Map()
  let section = ''
  for (const line of text.split('\n')) {
    const header = line.match(/^\[([^\]]+)\]\s*(#.*)?$/)
    if (header && !line.startsWith('[[')) { section = header[1]; continue }
    if (line.startsWith('[[')) { section = '[[array]]'; continue }
    const kv = line.match(/^([A-Za-z0-9_]+)\s*=\s*(.*)$/)
    if (!kv) continue
    let quote = ''
    let comment = ''
    const rest = kv[2]
    for (let i = 0; i < rest.length; i += 1) {
      const c = rest[i]
      if (quote) { if (c === quote && rest[i - 1] !== '\\') quote = '' } else if (c === '"' || c === "'") quote = c
      else if (c === '#') { comment = rest.slice(i + 1).trim(); break }
    }
    if (comment) out.set(`${section}.${kv[1]}`, comment)
  }
  return out
}

const SKIP_TOP = new Set(['keymaps', 'actions', 'tabs', 'scopes', 'daemon'])
const ORDER = ['meta', 'theme', 'defaults', 'app', 'panes', 'features', 'layout', 'diff', 'editor', 'ipc', 'ui', 'ai', 'agent']

const fmt = v => (typeof v === 'string' ? JSON.stringify(v) : Array.isArray(v) ? `[${v.map(fmt).join(', ')}]` : String(v))

/** Flatten nested tables to {path, rows[{key, value}]} sections. */
function flatten(path, obj, out) {
  const leaves = []
  const nested = []
  for (const [k, v] of Object.entries(obj)) {
    if (v && typeof v === 'object' && !Array.isArray(v)) nested.push([k, v])
    else leaves.push({ key: k, value: v })
  }
  if (leaves.length) out.push({ path, rows: leaves })
  for (const [k, v] of nested) flatten(`${path}.${k}`, v, out)
}

/**
 * The generated HTML between the config markers: one defaults table per TOML section.
 * @param {Record<string, any>} defaults
 * @param {string} tomlText
 * @returns {string}
 */
export function renderConfigHtml(defaults, tomlText) {
  const comments = tomlComments(tomlText)
  const sections = []
  for (const top of ORDER) if (defaults[top] && !SKIP_TOP.has(top)) flatten(top, defaults[top], sections)
  const blocks = sections.map(({ path, rows }) => {
    const id = `s-${path.replace(/[^a-z0-9]+/gi, '-')}`
    const body = rows.map(({ key, value }) => {
      const note = comments.get(`${path}.${key}`) || NOTES[`${path}.${key}`] || ''
      return `          <tr><th scope="row"><code>${esc(key)}</code></th><td><code>${esc(fmt(value))}</code></td><td>${esc(note)}</td></tr>`
    }).join('\n')
    return `    <section id="${id}" aria-labelledby="h-${id}">
      <h3 id="h-${id}"><code>[${esc(path)}]</code></h3>
      <div class="table-wrap">
      <table>
        <thead><tr><th scope="col">Key</th><th scope="col">Default</th><th scope="col">Notes</th></tr></thead>
        <tbody>
${body}
        </tbody>
      </table>
      </div>
    </section>`
  }).join('\n')
  const panes = Object.entries(defaults.panes || {}).map(([id, p]) => `${id}`).join(', ')
  return `    <p class="muted">Built from <code>src/config/defaultConfig.toml</code> (panes: ${esc(panes)}). Any key you leave out keeps this value.</p>
${blocks}`
}

/**
 * Replace the text between `<!-- gen:name:start -->` and `<!-- gen:name:end -->`.
 * @param {string} html
 * @param {string} name
 * @param {string} inner
 * @returns {string}
 */
export function replaceBetween(html, name, inner) {
  const start = `<!-- gen:${name}:start -->`
  const end = `<!-- gen:${name}:end -->`
  const a = html.indexOf(start)
  const b = html.indexOf(end)
  if (a < 0 || b < a) throw new Error(`markers gen:${name}:start / gen:${name}:end are missing`)
  return `${html.slice(0, a + start.length)}\n${inner}\n    ${html.slice(b)}`
}

/** @returns {{file: string, next: string, current: string}[]} each generated page, as it should be and as it is */
export function build() {
  const defaults = readDefaults()
  const tomlText = readFileSync(TOML_PATH, 'utf8')
  const jobs = [
    ['keys', renderKeysHtml(defaults)],
    ['config', renderConfigHtml(defaults, tomlText)],
  ]
  return jobs.map(([name, inner]) => {
    const current = readFileSync(PAGES[name], 'utf8')
    return { file: PAGES[name], current, next: replaceBetween(current, name, inner) }
  })
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const check = process.argv.includes('--check')
  let stale = 0
  for (const { file, current, next } of build()) {
    if (current === next) continue
    stale += 1
    if (check) console.error(`stale: ${file} (run: node scripts/gen-site.mjs)`)
    else writeFileSync(file, next)
  }
  if (check && stale) process.exit(1)
}
