/**
 * src/editor.js — Editor detection and file-open utility
 *
 * Supports: vscode, cursor, nvim, vim, nano, emacs, and $EDITOR/$VISUAL fallback.
 * Configured via config.editor.command ("auto" | "vscode" | "cursor" | "nvim" | etc.)
 *
 * openInEditor(file, line) — opens the file at the given line number in the
 * detected/configured editor. Non-blocking; fires and returns immediately.
 */

import { existsSync } from 'fs'
import { join } from 'path'
import { execa } from 'execa'

// ─── Editor profiles ──────────────────────────────────────────────────────────

const EDITOR_PROFILES = {
  vscode: {
    bins:    ['code'],
    open:    (file, line) => ['code', ['--goto', `${file}:${line}`]],
  },
  cursor: {
    bins:    ['cursor'],
    open:    (file, line) => ['cursor', ['--goto', `${file}:${line}`]],
  },
  windsurf: {
    bins:    ['windsurf'],
    open:    (file, line) => ['windsurf', ['--goto', `${file}:${line}`]],
  },
  zed: {
    bins:    ['zed'],
    open:    (file, line) => ['zed', [`${file}:${line}`]],
  },
  nvim: {
    bins:    ['nvim'],
    open:    (file, line) => ['nvim', [`+${line}`, file]],
  },
  vim: {
    bins:    ['vim'],
    open:    (file, line) => ['vim', [`+${line}`, file]],
  },
  emacs: {
    bins:    ['emacsclient', 'emacs'],
    open:    (file, line) => ['emacsclient', ['-n', `+${line}`, file]],
  },
  nano: {
    bins:    ['nano'],
    open:    (file, line) => ['nano', [`+${line}`, file]],
  },
  idea: {
    bins:    ['idea'],
    open:    (file, line) => ['idea', ['--line', String(line), file]],
  },
  webstorm: {
    bins:    ['webstorm'],
    open:    (file, line) => ['webstorm', ['--line', String(line), file]],
  },
  goland: {
    bins:    ['goland'],
    open:    (file, line) => ['goland', ['--line', String(line), file]],
  },
  pycharm: {
    bins:    ['pycharm'],
    open:    (file, line) => ['pycharm', ['--line', String(line), file]],
  },
}

// ─── Auto-detect ──────────────────────────────────────────────────────────────

/**
 * Returns the first binary found in PATH from a list of candidates.
 * @param {string[]} bins
 * @returns {Promise<string|null>}
 */
async function findBin(bins) {
  for (const bin of bins) {
    try {
      const r = await execa('which', [bin], { reject: false })
      if (r.exitCode === 0 && r.stdout.trim()) return bin
    } catch { /* not found */ }
  }
  return null
}

/**
 * Detect which IDE/editor is likely in use by inspecting:
 *   1. $VISUAL / $EDITOR env vars
 *   2. Project-level markers (.vscode/, .idea/, etc.)
 *   3. Common binaries in PATH (cursor, code, nvim, vim, …)
 *
 * @returns {Promise<string|null>} profile key or null
 */
async function detectEditor() {
  // 1. Env vars
  const envEditor = (process.env.VISUAL || process.env.EDITOR || '').toLowerCase()
  for (const [key, profile] of Object.entries(EDITOR_PROFILES)) {
    if (profile.bins.some(b => envEditor.includes(b))) return key
  }

  // 2. Project markers
  const cwd = process.cwd()
  if (existsSync(join(cwd, '.vscode'))) {
    const hasCursor = await findBin(['cursor'])
    return hasCursor ? 'cursor' : 'vscode'
  }
  if (existsSync(join(cwd, '.idea'))) {
    for (const k of ['idea', 'webstorm', 'goland', 'pycharm']) {
      if (await findBin(EDITOR_PROFILES[k].bins)) return k
    }
  }

  // 3. PATH scan (order = preference)
  const order = ['cursor', 'vscode', 'windsurf', 'zed', 'nvim', 'vim', 'emacs', 'nano']
  for (const key of order) {
    if (await findBin(EDITOR_PROFILES[key].bins)) return key
  }

  // 4. $EDITOR as raw command
  const rawEditor = process.env.VISUAL || process.env.EDITOR
  if (rawEditor) return '_raw'

  return null
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Open a file at the given line number in the configured/detected editor.
 * Non-blocking — returns immediately, fires editor in background.
 *
 * @param {string} file         - absolute or relative path to the file
 * @param {number} [line=1]     - 1-based line number
 * @param {object} [cfg]        - config.editor section (optional)
 * @param {string} [cfg.command] - "auto" | editor key | "custom"
 * @param {string} [cfg.customCommand] - used when command is "custom"
 * @returns {Promise<void>}
 */
export async function openInEditor(file, line = 1, cfg = {}) {
  const editorKey = (!cfg.command || cfg.command === 'auto')
    ? await detectEditor()
    : cfg.command

  if (!editorKey) return

  let cmd, args

  if (editorKey === 'custom' && cfg.customCommand) {
    // Replace {file} and {line} placeholders, fall back to appending
    const raw = cfg.customCommand
      .replace('{file}', file)
      .replace('{line}', String(line))
    const parts = raw.split(/\s+/)
    cmd  = parts[0]
    args = parts.slice(1)
  } else if (editorKey === '_raw') {
    const raw = (process.env.VISUAL || process.env.EDITOR || '').split(/\s+/)
    cmd  = raw[0]
    args = [...raw.slice(1), `+${line}`, file]
  } else {
    const profile = EDITOR_PROFILES[editorKey]
    if (!profile) return
    ;[cmd, args] = profile.open(file, line)
  }

  try {
    // detached so it doesn't block the TUI process
    const child = execa(cmd, args, { detached: true, stdio: 'ignore' })
    child.unref()
  } catch { /* editor not available */ }
}

/**
 * Returns a human-readable label for the detected/configured editor.
 * @param {object} [cfg]
 * @returns {Promise<string>}
 */
export async function editorLabel(cfg = {}) {
  const key = (!cfg.command || cfg.command === 'auto')
    ? await detectEditor()
    : cfg.command
  const labels = {
    vscode: 'VS Code', cursor: 'Cursor', windsurf: 'Windsurf', zed: 'Zed',
    nvim: 'Neovim', vim: 'Vim', emacs: 'Emacs', nano: 'nano',
    idea: 'IntelliJ IDEA', webstorm: 'WebStorm', goland: 'GoLand', pycharm: 'PyCharm',
    custom: 'custom editor', _raw: process.env.VISUAL || process.env.EDITOR || 'editor',
  }
  return labels[key] || key || 'editor'
}
