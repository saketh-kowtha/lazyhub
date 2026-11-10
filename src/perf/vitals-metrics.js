/**
 * vitals-metrics.js - pure metric math for the TUI vitals (#597, V0). No I/O: the PTY harness
 * (test/perf/vitals.js) and the in-process tests feed it recorded events and screen states.
 */

/** Threshold bands from the decision doc: [good, needsWork]; above needsWork is poor. */
export const BANDS = {
  'FMF-cold': [1200, 2000],
  'FMF-warm': [100, 250],
  'KTF-nav': [50, 100],
  'KTF-open': [100, 200],
  'OPT-FB': [100, 250],
}

/**
 * @param {string} metric key of BANDS
 * @param {number} value ms
 * @returns {'good' | 'needs-work' | 'poor'}
 */
export function band(metric, value) {
  const [good, ok] = BANDS[metric]
  return value <= good ? 'good' : value <= ok ? 'needs-work' : 'poor'
}

/**
 * Nearest-rank percentile.
 * @param {number[]} values
 * @param {number} p 0-100
 * @returns {number} NaN for an empty list
 */
export function percentile(values, p) {
  if (!values.length) return NaN
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))]
}

/**
 * CLEAR: frames carrying a full-terminal clear after first paint.
 * @param {{type: string, clear?: boolean}[]} events recorder events, in order
 * @returns {number}
 */
export function clearFrames(events) {
  let seen = false
  let n = 0
  for (const e of events) {
    if (e.type !== 'frame') continue
    if (seen && e.clear) n += 1
    seen = true
  }
  return n
}

/**
 * FLASH: transitions from data rows to a placeholder for the same view. Screens that are neither
 * (another view, an overlay) are skipped, so "list -> overlay -> list skeleton" counts one flash.
 * @param {string[]} screens screen texts in order
 * @param {(text: string) => 'data' | 'placeholder' | null} classify
 * @returns {number}
 */
export function flashCount(screens, classify) {
  let n = 0
  let prev = null
  for (const text of screens) {
    const kind = classify(text)
    if (!kind) continue
    if (prev === 'data' && kind === 'placeholder') n += 1
    prev = kind
  }
  return n
}

/**
 * REMOUNT: mounts of `view` beyond the first one.
 * @param {{type: string, view?: string}[]} events
 * @param {string} view
 * @returns {number}
 */
export function extraMounts(events, view) {
  return Math.max(0, events.filter(e => e.type === 'mount' && e.view === view).length - 1)
}

/**
 * WARM-GH: gh calls logged at or after `sinceMs` (same clock as the log's `t`).
 * @param {{t: number}[]} calls
 * @param {number} sinceMs
 * @returns {number}
 */
export function ghCallsSince(calls, sinceMs) {
  return calls.filter(c => c.t >= sinceMs).length
}

/**
 * Parse a recorder JSONL file's text.
 * @param {string} text
 * @returns {object[]}
 */
export function parseEvents(text) {
  return text.split('\n').filter(Boolean).map(line => JSON.parse(line))
}
