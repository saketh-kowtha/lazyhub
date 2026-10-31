/**
 * log-lines.js — turn raw `gh run view --log` text into display lines (#463).
 * gh prints `<job>\t<step>\t<ISO timestamp> <message>`; the job and step are
 * dropped (the group headers carry the step) and the timestamp is trimmed to
 * HH:MM:SS. TABs and control characters are cleaned later by LogViewer.
 */

// eslint-disable-next-line no-control-regex
const ANSI_RE = /\x1b\[[0-9;]*[a-zA-Z]/g
const GH_PREFIX_RE = /^[^\t]*\t[^\t]*\t/
const TIMESTAMP_RE = /^\d{4}-\d{2}-\d{2}T(\d{2}:\d{2}:\d{2})\.\d+Z\s?/

/**
 * @param {unknown} rawLogs
 * @returns {string[]}
 */
export function toLogLines(rawLogs) {
  const rawLines = typeof rawLogs === 'string' ? rawLogs.split('\n') : []
  return rawLines
    .map(l => l.replace(/\r$/, '').replace(ANSI_RE, '').replace(GH_PREFIX_RE, ''))
    .filter(l => !l.replace(TIMESTAMP_RE, '').trimStart().startsWith('##[endgroup]'))
    .map(l => {
      const body = l.replace(TIMESTAMP_RE, '')
      const groupMatch = body.match(/^##\[group\](.+)/)
      if (groupMatch) return `=== ${groupMatch[1].trim()} ===`
      const time = l.match(TIMESTAMP_RE)?.[1]
      return time ? `${time} ${body}` : l
    })
}
