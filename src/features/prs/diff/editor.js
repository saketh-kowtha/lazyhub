// @ts-nocheck
/**
 * src/features/prs/diff/editor.js — synchronous comment editor round-trip.
 */

import { spawnSync } from 'child_process'
import { writeFileSync, readFileSync, mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

/** Edit a comment in a temporary file, retaining its text on editor failure.
 * @param {string} initial
 * @returns {string} edited or original comment
 */
export function openEditorSync(initial) {
  const raw = process.env.EDITOR || process.env.VISUAL || 'vi'
  if (!raw || /[\0\n\r]/.test(raw)) return initial
  const [editorBin, ...editorArgs] = raw.split(/\s+/).filter(Boolean)
  let tmpDir
  try {
    tmpDir = mkdtempSync(join(tmpdir(), 'lazyhub-'))
    const tmp = join(tmpDir, 'comment.md')
    writeFileSync(tmp, initial || '', { mode: 0o600 })
    process.stdout.write('\x1b[?1049l')
    const result = spawnSync(editorBin, [...editorArgs, tmp], { stdio: 'inherit' })
    // Re-enter alternate screen after editor exits
    process.stdout.write('\x1b[?1049h\x1b[H')
    if (result.status !== 0) return initial
    return readFileSync(tmp, 'utf8')
  } catch { return initial }
  finally { try { if (tmpDir) rmSync(tmpDir, { recursive: true, force: true }) } catch {} }
}

