/**
 * src/services/platform.js — the only place UI code reaches the host OS.
 *
 * Browser, clipboard and external-editor launches live here (#470, #479) so
 * every caller shares one implementation, one URL allow-list, and one seam that
 * tests can mock (`vi.mock('../services/platform.js')`) instead of launching a
 * real browser or editor. Arguments are always arrays; nothing goes through a shell.
 */

import { execa } from 'execa'
import { spawnSync } from 'child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

export { openInEditor, editorLabel } from '../editor.js'

/**
 * True for an absolute http(s) URL. Anything else (file:, javascript:, a bare
 * path, an option-looking string) is refused before a process is spawned.
 * @param {unknown} url
 * @returns {url is string}
 */
export function isOpenableUrl(url) {
  if (typeof url !== 'string' || !url || /[\0\r\n]/.test(url)) return false
  try {
    const u = new URL(url)
    return u.protocol === 'https:' || u.protocol === 'http:'
  } catch {
    return false
  }
}

/**
 * Open a URL in the default browser.
 * @param {string} url
 * @returns {Promise<boolean>} true when the opener was launched; false when the URL was refused or the opener failed
 */
export async function openUrl(url) {
  if (!isOpenableUrl(url)) return false
  const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'explorer' : 'xdg-open'
  try {
    await execa(cmd, [url])
    return true
  } catch {
    return false
  }
}

/**
 * Run a command the user configured for a custom pane (`[[panes]] command`).
 * `args` is an already-split argv array; it is never passed through a shell.
 * @param {string[]} args argv, program first
 * @returns {Promise<{ exitCode: number, stdout: string, stderr: string }>}
 */
export async function runConfiguredCommand(args) {
  const [bin, ...rest] = args
  return execa(bin, rest, { reject: false })
}

/** Clipboard commands to try, in order, for this platform. */
function clipboardCommands() {
  if (process.platform === 'darwin') return [['pbcopy', []]]
  if (process.platform === 'win32') return [['clip', []]]
  return [['xclip', ['-selection', 'clipboard']], ['xsel', ['--clipboard', '--input']]]
}

/**
 * Copy text to the system clipboard with the platform's native tool.
 * @param {string} text
 * @returns {Promise<boolean>} true when a clipboard tool accepted the text
 */
export async function copyToClipboard(text) {
  for (const [cmd, args] of clipboardCommands()) {
    try {
      await execa(cmd, args, { input: String(text) })
      return true
    } catch { /* try the next tool */ }
  }
  return false
}

/**
 * Round-trip `initial` through $EDITOR/$VISUAL in a private temp file and wait
 * for the editor to exit. Blocking on purpose: a terminal editor takes over the
 * tty, so Ink must not be reading stdin meanwhile.
 *
 * @param {string} initial
 * @param {{ filename?: string, altScreen?: boolean }} [opts] altScreen (default true) leaves and re-enters the alternate screen around the editor
 * @returns {{ ok: boolean, text: string }} ok=false (text = initial) when the editor is unusable or exits non-zero
 */
export function editTextInEditor(initial, { filename = 'compose.md', altScreen = true } = {}) {
  const raw = process.env.EDITOR || process.env.VISUAL || 'vi'
  if (!raw || /[\0\n\r]/.test(raw)) return { ok: false, text: initial }
  const [editorBin, ...editorArgs] = raw.split(/\s+/).filter(Boolean)
  let tmpDir
  try {
    tmpDir = mkdtempSync(join(tmpdir(), 'lazyhub-'))
    const tmp = join(tmpDir, filename)
    writeFileSync(tmp, initial || '', { mode: 0o600 })
    if (altScreen) process.stdout.write('\x1b[?1049l')
    const result = spawnSync(editorBin, [...editorArgs, tmp], { stdio: 'inherit' })
    if (altScreen) process.stdout.write('\x1b[?1049h\x1b[H')
    if (result.status !== 0) return { ok: false, text: initial }
    return { ok: true, text: readFileSync(tmp, 'utf8') }
  } catch {
    return { ok: false, text: initial }
  } finally {
    try { if (tmpDir) rmSync(tmpDir, { recursive: true, force: true }) } catch { /* best effort */ }
  }
}
