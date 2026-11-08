/**
 * why-red-rows.js — flattens a WhyRedModel into display rows (issue #359).
 * Pure: no React, no theme. Every string that came from GitHub (check names, log
 * text, paths, diff lines) is cleaned here with the shared helpers, so the view
 * only maps `tone` to a theme token. Every unknown is written as "unknown: why".
 */

import { cleanLogLine, sanitizePath } from '../../utils.js'
import { MAX_EXCERPT_LINES } from './ci-log.js'

/** @typedef {'title'|'ok'|'fail'|'warn'|'dim'|'code'|'unknown'|'text'|'head'} Tone */
/** @typedef {{text: string, tone: Tone, indent: number}} Row */

/** @type {Record<string, string>} */
const KIND_LABEL = {
  'vitest-jest': 'Vitest/Jest', tsc: 'TypeScript', eslint: 'ESLint', 'node-assert': 'Node assert',
  'stack-trace': 'stack trace', 'step-error': 'step error', unparsed: 'unrecognised log shape, last lines',
}

/** @param {unknown} v */
const clean = v => cleanLogLine(String(v ?? ''))

/**
 * @param {import('./why-red.js').WhyRedModel|null} model
 * @param {{prNumber: number|string, loading?: boolean, error?: string|null}} ctx
 * @returns {Row[]}
 */
export function whyRedRows(model, { prNumber, loading = false, error = null }) {
  /** @type {Row[]} */
  const rows = []
  const push = (/** @type {string} */ text, /** @type {Tone} */ tone = 'text', indent = 0) => rows.push({ text, tone, indent })
  const title = `Why is CI red? PR #${Number(prNumber)}`

  if (error) { push(title, 'title'); push(`unknown: ${clean(error)}`, 'unknown'); return rows }
  if (!model) { push(title, 'title'); push(loading ? 'Reading checks and logs…' : 'unknown: nothing loaded', 'dim'); return rows }

  const summary = [`${model.totalFailing} failing`, model.pending ? `${model.pending} pending` : null].filter(Boolean).join(', ')
  push(`${title}${model.state === 'ok' ? `  ${summary}` : ''}${loading ? '  (still loading)' : ''}`, 'title')
  if (model.state === 'no-checks') { push('This PR has no CI checks: nothing is red.', 'dim'); return rows }
  if (model.state === 'pending') { push(`No check has failed yet; ${model.pending} still running. Open this again when they finish.`, 'warn'); return rows }
  if (model.state === 'no-failures') { push('No failing checks: CI is not red.', 'ok'); return rows }
  if (model.pending) push(`${model.pending} check(s) still running, so this list may grow.`, 'warn')
  if (model.notAnalysed) push(`Showing the first ${model.checks.length} of ${model.totalFailing} failing checks; ${model.notAnalysed} not analysed (see the Checks list).`, 'warn')
  if (model.filesNote) push(clean(model.filesNote), 'warn')

  for (const c of model.checks) checkRows(c, push)
  return rows
}

/** @typedef {(text: string, tone?: Tone, indent?: number) => void} Push */

/**
 * @param {import("./why-red.js").CheckAnalysis} c
 * @param {Push} push
 */
function checkRows(c, push) {
  {
    push('', 'text')
    push(`✗ ${clean(c.name)}  ·  ${c.duration ? c.duration : 'duration unknown'}`, 'fail')
    push(`failing step: ${c.step ? clean(c.step) : 'unknown'}${c.job ? `   job: ${clean(c.job)}` : ''}`, c.step ? 'text' : 'unknown', 2)

    if (c.excerpt) {
      const ex = c.excerpt
      const cut = ex.truncated || ex.lines.length >= MAX_EXCERPT_LINES
      push(`Log excerpt (${KIND_LABEL[ex.kind] || clean(ex.kind)}, redacted${cut ? `, truncated: at most ${MAX_EXCERPT_LINES} lines of a longer log shown` : ''}):`, 'head', 2)
      for (const l of ex.lines) push(clean(l), 'code', 4)
      if (cut) push('… log cut here; the rest is not shown', 'warn', 4)
    } else {
      push(`Log excerpt: unknown (${clean(c.log.state)}): ${clean(c.log.detail || 'no detail')}`, 'unknown', 2)
    }

    blameRows(c, push)

    const tone = c.base.verdict === 'unknown' ? 'unknown' : c.base.verdict === 'passing' ? 'ok' : 'warn'
    push(`Seen before: ${clean(c.base.text)}`, tone, 2)
  }
}

/**
 * @param {import("./why-red.js").CheckAnalysis} c
 * @param {Push} push
 */
function blameRows(c, push) {
  push('Likely cause (PR-changed lines the log points at):', 'head', 2)
  if (c.blame && c.blame.items.length > 0) {
    for (const m of c.blame.items) {
      const loc = `${sanitizePath(m.path)}:${m.line}`
      const via = m.via === 'suffix' ? '  [matched by shorter path only]' : m.via === 'rename' ? '  [log used the pre-rename path]' : ''
      if (m.kind === 'changed') push(`changed line  ${loc}  ${clean(m.text).trim()}${via}`, 'warn', 4)
      else if (m.kind === 'near') push(`near a change  ${loc}  (log says line ${m.failLine})  ${clean(m.text).trim()}${via}`, 'text', 4)
      else if (m.kind === 'file') push(`file changed, line not  ${sanitizePath(m.path)}  (log says line ${m.failLine})${via}`, 'dim', 4)
      else push(`file changed  ${sanitizePath(m.path)}  (log says line ${m.failLine}; GitHub gave no patch, so unknown which lines)${via}`, 'unknown', 4)
    }
    if (c.blame.capped) push('… more matches not shown', 'warn', 4)
    if (c.blame.unmatched) push(`${c.blame.unmatched} other reference(s) in the log are files this PR did not change`, 'dim', 4)
    if (c.blame.ambiguous) push(`${c.blame.ambiguous} reference(s) matched several files equally and were not guessed`, 'dim', 4)
  } else {
    push(clean(c.blameNote || 'unknown: no match'), 'unknown', 4)
  }
}
