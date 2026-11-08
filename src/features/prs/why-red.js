/**
 * why-red.js — builds the "Why is CI red?" model for one PR (issue #359).
 * Pure orchestration over injected, read-only fetchers: no React, no direct gh.
 *
 * For every failing check (bounded) it gathers: the failing step, the redacted
 * log excerpt (ci-log.js), the PR-changed lines the log points at (ci-blame.js)
 * and whether the same check fails on recent base-branch commits. Anything that
 * could not be determined is an explicit `unknown` with a reason; nothing is
 * guessed. Fetch counts are bounded: MAX_CHECKS logs, at most MAX_PATCHES
 * patches, one PR file listing, and BASE_RUNS_DEFAULT+1 base calls per check.
 */

import { extractExcerpt } from './ci-log.js'
import { matchChangedLines, matchLocationsToFiles } from './ci-blame.js'
import { scrub } from '../../executor/classify.js'

export const MAX_CHECKS = 5
export const MAX_PATCHES = 6

const FAILED_RE = /failure|error|timed_out|startup_failure/i
const PENDING_RE = /pending|in_progress|queued|waiting|requested/i

/** @param {any} c */
const stateOf = c => c?.conclusion || c?.status || c?.state || ''
/** @param {any} c */
export const isFailed = c => FAILED_RE.test(stateOf(c))
/** @param {any} c */
export const isPending = c => PENDING_RE.test(stateOf(c)) && !c?.conclusion

/**
 * "1m 05s" from two ISO times, or null when either is missing or unusable.
 *
 * @param {string|null|undefined} start
 * @param {string|null|undefined} end
 * @returns {string|null}
 */
export function formatDuration(start, end) {
  const a = Date.parse(start || '')
  const b = Date.parse(end || '')
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return null
  const s = Math.round((b - a) / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, '0')}s`
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`
}

/**
 * Turn the base-branch samples into a verdict. Counts only runs where the check
 * actually ran to a pass or fail.
 *
 * @param {{state: string, detail?: string, samples: {sha: string, outcome: string}[], partial?: boolean}|null} history
 * @param {string} baseBranch
 * @returns {{verdict: 'also-failing'|'possibly-flaky'|'passing'|'unknown', text: string}}
 */
export function summariseBase(history, baseBranch) {
  const base = baseBranch || 'the base branch'
  if (!history) return { verdict: 'unknown', text: `unknown: base-branch history was not checked` }
  if (history.state === 'rate_limit') return { verdict: 'unknown', text: `unknown: ${history.detail || 'rate limited'}` }
  if (history.state !== 'ok') return { verdict: 'unknown', text: `unknown: ${history.detail || 'base-branch checks unavailable'}` }
  const failed = history.samples.filter(s => s.outcome === 'failure').length
  const passed = history.samples.filter(s => s.outcome === 'success').length
  const n = failed + passed
  const tail = history.partial ? ' (partial data: some checks could not be read)' : ''
  if (n === 0) return { verdict: 'unknown', text: `unknown: this check did not report a pass or fail on the last ${history.samples.length} commit(s) of ${base}${tail}` }
  const of = `${failed} of ${n} recent commits on ${base}`
  if (failed === n) return { verdict: 'also-failing', text: `also failing on ${base} (${of})${tail}` }
  if (failed > 0) return { verdict: 'possibly-flaky', text: `possibly flaky: failed on ${of}, passed on the rest${tail}` }
  return { verdict: 'passing', text: `passes on ${base} (0 of ${n} recent commits failed); not seen on the base branch${tail}` }
}

/**
 * @typedef {object} CheckAnalysis
 * @property {string} name
 * @property {string|null} duration         null = unknown
 * @property {string|null} step
 * @property {string|null} job
 * @property {{state: string, detail: string}} log
 * @property {import('./ci-log.js').Excerpt|null} excerpt
 * @property {ReturnType<typeof matchChangedLines>|null} blame
 * @property {string|null} blameNote        why `blame` is null or empty, shown as unknown
 * @property {ReturnType<typeof summariseBase>} base
 * @property {string|null} url
 */

/**
 * @typedef {object} WhyRedModel
 * @property {'no-checks'|'pending'|'no-failures'|'ok'} state
 * @property {number} pending
 * @property {number} totalFailing
 * @property {number} notAnalysed
 * @property {CheckAnalysis[]} checks
 * @property {string|null} filesNote   set when the PR file list was truncated or failed
 */

/**
 * @param {object} args
 * @param {any[]} args.checks              rows from getPRChecks
 * @param {string} args.repo
 * @param {number} args.prNumber
 * @param {string} args.baseBranch
 * @param {number} [args.baseRuns]
 * @param {{
 *   getFailedLog: (repo: string, ref: {jobId: string|number}) => Promise<{state: string, text: string, detail: string}>,
 *   listPRChangedPaths: (repo: string, n: number) => Promise<{files: any[], truncated: boolean, error: string|null}>,
 *   getPRFilePatch: (repo: string, n: number, path: string) => Promise<{status: string, patch: string|null}>,
 *   getBaseCheckHistory: (repo: string, base: string, name: string, o?: {limit?: number}) => Promise<any>,
 * }} args.deps
 * @param {(model: WhyRedModel) => void} [args.onProgress]
 * @returns {Promise<WhyRedModel>}
 */
export async function loadWhyRed({ checks, repo, prNumber, baseBranch, baseRuns, deps, onProgress }) {
  const rows = Array.isArray(checks) ? checks.filter(c => c && c.status !== 'incomplete') : []
  const failing = rows.filter(isFailed)
  const pending = rows.filter(isPending).length
  /** @type {WhyRedModel} */
  const model = { state: 'ok', pending, totalFailing: failing.length, notAnalysed: Math.max(0, failing.length - MAX_CHECKS), checks: [], filesNote: null }
  if (rows.length === 0) return { ...model, state: 'no-checks' }
  if (failing.length === 0) return { ...model, state: pending > 0 ? 'pending' : 'no-failures' }

  /** shared across checks so the file list and each patch are fetched once */
  const state = { files: /** @type {any[]|null} */ (null), patches: /** @type {Map<string, {status: string, patch: string|null}>} */ (new Map()) }

  for (const check of failing.slice(0, MAX_CHECKS)) {
    const name = scrub(String(check.name || check.context || 'unnamed check'))
    /** @type {CheckAnalysis} */
    const a = {
      name,
      duration: formatDuration(check.startedAt, check.completedAt),
      step: null,
      job: null,
      log: { state: 'unavailable', detail: '' },
      excerpt: null,
      blame: null,
      blameNote: null,
      base: summariseBase(null, baseBranch),
      url: check.url || null,
    }
    model.checks.push(a)

    // 1. log excerpt (job id is the check-run id for GitHub Actions)
    const isActions = !check.appName || /github actions/i.test(String(check.appName))
    if (!check.id || !isActions) {
      a.log = { state: 'unavailable', detail: 'Not a GitHub Actions job, so there is no log to read here' }
    } else {
      try {
        const log = await deps.getFailedLog(repo, { jobId: check.id })
        a.log = { state: log.state, detail: scrub(log.detail || '') }
        if (log.state === 'ok') {
          a.excerpt = extractExcerpt(log.text)
          if (!a.excerpt) a.log = { state: 'empty', detail: 'The failed-step log has no content' }
          else { a.step = a.excerpt.step; a.job = a.excerpt.job }
        }
      } catch {
        a.log = { state: 'unavailable', detail: 'Could not fetch the failed-step log' }
      }
    }

    await attachBlame(a, { repo, prNumber, deps, model, state })

    // 3. seen before on the base branch
    try {
      a.base = summariseBase(await deps.getBaseCheckHistory(repo, baseBranch, String(check.name || ''), { limit: baseRuns }), baseBranch)
    } catch {
      a.base = summariseBase({ state: 'unavailable', detail: 'could not read base-branch checks', samples: [] }, baseBranch)
    }
    if (onProgress) onProgress({ ...model, checks: [...model.checks] })
  }
  return model
}

/**
 * Match the excerpt's file references against the PR diff, filling a.blame / a.blameNote.
 * @param {CheckAnalysis} a
 * @param {{repo: string, prNumber: number, deps: any, model: WhyRedModel, state: {files: any[]|null, patches: Map<string, {status: string, patch: string|null}>}}} ctx
 */
async function attachBlame(a, { repo, prNumber, deps, model, state }) {
  const { patches } = state
  // likely cause: locations in the excerpt x the PR diff
  const locations = a.excerpt?.locations || []
  if (!a.excerpt) a.blameNote = 'unknown: no log excerpt to match against the diff'
  else if (a.excerpt.kind === 'unparsed') a.blameNote = 'unknown: the log has no recognised failure shape, so no file or line can be matched'
  else if (locations.length === 0) a.blameNote = 'unknown: the failure names no file and line'
  else {
    if (!state.files) {
      const listed = await deps.listPRChangedPaths(repo, prNumber)
      state.files = listed.files
      if (listed.error) model.filesNote = `PR file list incomplete (${scrub(listed.error)})`
      else if (listed.truncated) model.filesNote = `PR file list truncated at ${listed.files.length} files; matches may be missing`
    }
    const { matches } = matchLocationsToFiles(locations, state.files)
    for (const m of matches) {
      if (patches.size >= MAX_PATCHES) break
      if (patches.has(m.file.path)) continue
      try {
        const p = await deps.getPRFilePatch(repo, prNumber, m.file.path)
        patches.set(m.file.path, { status: p.status, patch: p.patch })
      } catch {
        patches.set(m.file.path, { status: 'missing', patch: null })
      }
    }
    a.blame = matchChangedLines(locations, state.files, patches)
    if (a.blame.items.length === 0) {
      a.blameNote = `no match: none of the ${locations.length} file reference(s) in the log is a file this PR changed`
        + (a.blame.ambiguous ? ` (${a.blame.ambiguous} ambiguous, not guessed)` : '')
    }
  }
}
