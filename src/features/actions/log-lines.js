/**
 * log-lines.js — turn raw `gh run view --log` text into display lines (#463).
 * gh prints `<job>\t<step>\t<ISO timestamp> <message>`; the job and step are
 * dropped (the group headers carry the step) and the timestamp is trimmed to
 * HH:MM:SS. Escape strings and control characters are removed here (sanitizeLog).
 */

import { sanitize, stripAnsi, sanitizeLog } from '../../utils.js'

// Only a real `job<TAB>step<TAB><timestamp>` prefix; other tabbed lines stay intact.
const GH_PREFIX_RE = /^[^\t]*\t[^\t]*\t(?=\d{4}-\d{2}-\d{2}T)/
const TIMESTAMP_RE = /^\d{4}-\d{2}-\d{2}T(\d{2}:\d{2}:\d{2})\.\d+Z\s?/

/**
 * Viewer title: workflow, branch and outcome, skipping empty parts. The names come
 * from GitHub, so they go through sanitize().
 * @param {{workflowName?: string, headBranch?: string, conclusion?: string, status?: string}} run
 */
export function logTitle(run) {
  return [run.workflowName || 'Run', run.headBranch, run.conclusion || run.status || 'unknown']
    .map(p => sanitize(p || '').trim())
    .filter(Boolean)
    .join(' · ')
}

/**
 * @param {unknown} rawLogs
 * @returns {string[]}
 */
export function toLogLines(rawLogs) {
  const rawLines = typeof rawLogs === 'string' ? rawLogs.split('\n') : []
  // Escape strings and control characters go first; TABs stay so the gh prefix can still be split off.
  // A bare CR inside a line starts a new display line (progress frames are all shown, none hidden).
  const lines = []
  for (const rawLine of rawLines) {
    for (const part of stripAnsi(rawLine.replace(/\r$/, '')).split('\n')) lines.push(part.replace(GH_PREFIX_RE, ''))
  }
  return lines
    .filter(l => !l.replace(TIMESTAMP_RE, '').trimStart().startsWith('##[endgroup]'))
    .map(l => {
      const body = l.replace(TIMESTAMP_RE, '')
      const groupMatch = body.match(/^##\[group\](.+)/)
      if (groupMatch) return `=== ${groupMatch[1].trim()} ===`
      const time = l.match(TIMESTAMP_RE)?.[1]
      return time ? `${time} ${body}` : l
    })
    .map(l => sanitizeLog(l))
}
