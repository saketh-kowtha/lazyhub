/**
 * ci-log.js — pure parsing of a failed CI job log into a bounded, redacted
 * excerpt (issue #359, "Why is CI red?", step 1). No I/O, no React.
 *
 * Input is `gh run view --log-failed` text: `job<TAB>step<TAB>timestamp text`
 * lines (or bare lines). The log is untrusted: every line is stripped of ANSI
 * and control characters, secret-redacted and length-capped before it leaves
 * this module, and the whole input is bounded so a huge log cannot balloon
 * memory (#311). Nothing here guesses: if no known failure shape matches, the
 * excerpt says so (kind 'unparsed') instead of inventing a cause.
 */

import { scrub } from '../../executor/classify.js'
import { getFailedLog } from '../../executor/ci-logs.js'

export const MAX_INPUT_CHARS = 4 * 1024 * 1024
export const MAX_EXCERPT_LINES = 40
export const MAX_LINE_CHARS = 200
const MAX_REFS = 20

// eslint-disable-next-line no-control-regex
const CONTROL_RE = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g
const TS_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z ?/
// eslint-disable-next-line no-control-regex
const ANSI_RE = /\u001b\[[0-9;?]*[ -/]*[@-~]/g

/**
 * Redact one log line: ANSI/control stripped, then the shared scrubber
 * (tokens, bearer/authorization values, credentialed URLs, 40+ char runs) plus
 * cloud keys, key=value secrets and private-key markers.
 *
 * @param {string} line
 * @returns {string}
 */
export function redactLine(line) {
  const clean = String(line).replace(ANSI_RE, '').replace(CONTROL_RE, '')
  return scrub(clean)
    .replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----.*/g, '[REDACTED PRIVATE KEY]')
    .replace(/\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g, '[REDACTED]')
    .replace(/\b(?:xox[abprs]-|sk-|npm_)[A-Za-z0-9-]{10,}/g, '[REDACTED]')
    .replace(/\b([A-Za-z0-9_.-]*(?:secret|token|passw(?:or)?d|api[_-]?key|credential)[A-Za-z0-9_.-]*)(\s*[:=]\s*)(?!\[REDACTED\])\S+/gi, '$1$2[REDACTED]')
}

/**
 * Split gh's log into {job, step, text}; timestamps and group markers dropped.
 *
 * @param {string} raw
 * @returns {{lines: {job: string|null, step: string|null, text: string}[], truncated: boolean}}
 */
export function parseLogLines(raw) {
  let text = typeof raw === 'string' ? raw : ''
  const truncated = text.length > MAX_INPUT_CHARS
  if (truncated) text = text.slice(0, MAX_INPUT_CHARS)
  const lines = []
  for (const rawLine of text.split('\n')) {
    let job = null
    let step = null
    let body = rawLine.replace(/\r$/, '').replace(ANSI_RE, '')
    const parts = body.split('\t')
    if (parts.length >= 3) {
      job = parts[0].trim() || null
      step = parts[1].trim() || null
      body = parts.slice(2).join('\t')
    }
    body = body.replace(TS_RE, '')
    if (/^##\[(?:end)?group\]/.test(body) || /^##\[(?:debug|command)\]/.test(body)) continue
    lines.push({ job, step, text: body })
  }
  return { lines, truncated }
}

// ── Failure detectors ────────────────────────────────────────────────────────

const isFrame = s => /^\s*(?:at |❯ )/.test(s) || /^\s+\d+\s*\|/.test(s) || /^\s*\^+\s*$/.test(s)
const isAnnotation = s => /^##\[(?:error|warning|notice)\]/.test(s)

/**
 * Extend over following lines until a stop line, a second blank or the cap.
 *
 * @param {{text: string}[]} lines
 * @param {number} from
 * @param {{stop?: (s: string) => boolean, max?: number}} [opts]
 * @returns {number} index of the last line in the block
 */
function extend(lines, from, { stop = () => false, max = MAX_EXCERPT_LINES } = {}) {
  let end = from
  let blanks = 0
  while (end + 1 < lines.length && end - from + 1 < max) {
    const s = lines[end + 1].text
    if (isAnnotation(s) || stop(s)) break
    if (s.trim() === '') {
      if (++blanks > 1) break
      end++
      continue
    }
    blanks = 0
    end++
  }
  while (end > from && lines[end].text.trim() === '') end--
  return end
}

const ESLINT_ROW = /^\s+\d+:\d+\s+(?:error|warning)\s/

const DETECTORS = [
  {
    kind: 'vitest-jest',
    test: s => /^\s*(?:FAIL|\u00d7|✗|\u2715)\s+\S/.test(s) || /^\s*●\s.+›/.test(s) || /^\s*\u23af+\s*Failed (?:Tests|Suites)/.test(s),
    end: (lines, i) => extend(lines, i, { stop: s => /^\s*(?:Test Files|Test Suites|Tests):?\s/.test(s) }),
  },
  {
    kind: 'tsc',
    test: s => /^\S.*\(\d+,\d+\): error TS\d+:/.test(s) || /^\S.*:\d+:\d+ - error TS\d+:/.test(s),
    end: (lines, i) => {
      let end = i
      while (end + 1 < lines.length && end - i + 1 < 12 && /^(?:\s+\S|\S.*(?:\(\d+,\d+\): |:\d+:\d+ - )error TS\d+:)/.test(lines[end + 1].text)) end++
      return end
    },
  },
  {
    kind: 'eslint',
    test: s => /^\s+\d+:\d+\s+error\s/.test(s),
    start: (lines, i) => (i > 0 && /^\S/.test(lines[i - 1].text) ? i - 1 : i),
    end: (lines, i) => {
      let end = i
      while (end + 1 < lines.length && end - i + 1 < 12 && ESLINT_ROW.test(lines[end + 1].text)) end++
      return end
    },
  },
  {
    kind: 'node-assert',
    test: s => /AssertionError(?: \[ERR_ASSERTION\])?:|ERR_ASSERTION/.test(s),
    end: (lines, i) => extend(lines, i, { stop: s => /^Node\.js v\d/.test(s) }),
  },
  {
    kind: 'stack-trace',
    test: s => /^\s*(?:Uncaught |Unhandled |Caused by: )?(?:[A-Za-z_$][\w$.]*)?(?:Error|Exception)(?:\s?\[[^\]]*\])?:\s?\S/.test(s),
    end: (lines, i) => {
      let end = i
      while (end + 1 < lines.length && end - i + 1 < MAX_EXCERPT_LINES && isFrame(lines[end + 1].text)) end++
      return end
    },
  },
]

// ── Location extraction ──────────────────────────────────────────────────────

const PATH_CHARS = String.raw`(?:[A-Za-z]:[\\/]|file:\/\/\/?)?[^\s()'"<>:]+?\.[A-Za-z0-9]{1,6}`
// tsc: path(line,col)   and   path:line[:col]  (stack frames, vitest, eslint-compact)
const LOC_RES = [
  new RegExp(String.raw`(^|[\s(])(${PATH_CHARS})\((\d+),(\d+)\)`, 'g'),
  new RegExp(String.raw`(^|[\s(])(${PATH_CHARS}):(\d+)(?::(\d+))?(?=$|[\s)\]:,])`, 'g'),
]

/**
 * Pull `{path, line, col}` references out of an excerpt's text. Paths are kept
 * as written (backslashes become `/`, `file://` is removed); matching them to
 * PR files is a later step (#359 step 2). Node internals, node_modules and
 * URLs are dropped, as are duplicates.
 *
 * @param {string[]} texts
 * @returns {{path: string, line: number, col: number|null}[]}
 */
export function extractLocations(texts) {
  const seen = new Set()
  const out = []
  for (const text of texts) {
    for (const re of LOC_RES) {
      re.lastIndex = 0
      let m
      while ((m = re.exec(text)) && out.length < MAX_REFS) {
        let path = m[2].replace(/^file:\/\/\/?/, '/').replace(/\\/g, '/')
        if (/^\/[A-Za-z]:\//.test(path)) path = path.slice(1)
        if (/^node:/.test(path) || /(^|\/)node_modules\//.test(path) || /^https?:/.test(path)) continue
        const line = Number(m[3])
        if (!Number.isSafeInteger(line) || line < 1) continue
        const col = m[4] ? Number(m[4]) : null
        const key = `${path}:${line}:${col}`
        if (seen.has(key)) continue
        seen.add(key)
        out.push({ path, line, col })
      }
    }
  }
  return out
}

function cap(line) {
  const s = redactLine(line)
  return s.length > MAX_LINE_CHARS ? `${s.slice(0, MAX_LINE_CHARS - 1)}…` : s
}

/**
 * @typedef {object} Excerpt
 * @property {'vitest-jest'|'tsc'|'eslint'|'node-assert'|'stack-trace'|'step-error'|'unparsed'} kind
 * @property {string|null} job
 * @property {string|null} step
 * @property {string[]} lines       redacted, sanitised, capped
 * @property {{path: string, line: number, col: number|null}[]} locations
 * @property {boolean} truncated    input or excerpt was cut
 */

/**
 * Extract the first failure block from a failed-job log.
 *
 * @param {string} raw
 * @returns {Excerpt|null} null when the log has no content at all
 */
export function extractExcerpt(raw) {
  const { lines, truncated: inputCut } = parseLogLines(raw)
  if (!lines.some(l => l.text.trim() !== '')) return null

  /** @type {{kind: Excerpt["kind"], start: number, end: number}|null} */
  let best = null
  for (let i = 0; i < lines.length && !best; i++) {
    const s = lines[i].text
    if (isAnnotation(s)) continue
    for (const d of DETECTORS) {
      if (d.test(s)) {
        const start = d.start ? d.start(lines, i) : i
        best = { kind: /** @type {Excerpt['kind']} */ (d.kind), start, end: Math.max(i, d.end(lines, i)) }
        break
      }
    }
  }
  if (!best) {
    const i = lines.findIndex(l => /^##\[error\]/.test(l.text))
    if (i >= 0) best = { kind: 'step-error', start: i, end: extend(lines, i, { max: 5 }) }
  }
  if (!best) {
    let last = lines.length - 1
    while (last > 0 && lines[last].text.trim() === '') last--
    best = { kind: 'unparsed', start: Math.max(0, last - 9), end: last }
  }

  const block = lines.slice(best.start, best.end + 1)
  const shown = block.slice(0, MAX_EXCERPT_LINES)
  const head = lines[best.start]
  return {
    kind: best.kind,
    job: head.job ? cap(head.job) : null,
    step: head.step ? cap(head.step) : null,
    lines: shown.map(l => cap(l.text)),
    locations: best.kind === 'unparsed' ? [] : extractLocations(shown.map(l => l.text)),
    truncated: inputCut || block.length > shown.length,
  }
}

/**
 * Fetch (through the executor) and excerpt a failed job's log. Every state the
 * issue lists comes back as data, never as a guess.
 *
 * @param {string} repo
 * @param {{jobId?: string|number, runId?: string|number}} ref
 * @param {typeof getFailedLog} [fetchLog] injectable for tests
 * @returns {Promise<{state: string, detail: string, excerpt: Excerpt|null}>}
 */
export async function loadFailureExcerpt(repo, ref, fetchLog = getFailedLog) {
  const log = await fetchLog(repo, ref)
  if (log.state !== 'ok') return { state: log.state, detail: scrub(log.detail), excerpt: null }
  const excerpt = extractExcerpt(log.text)
  return excerpt
    ? { state: 'ok', detail: '', excerpt }
    : { state: 'empty', detail: 'The failed-step log has no content', excerpt: null }
}
