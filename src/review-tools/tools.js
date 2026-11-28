/**
 * src/review-tools/tools.js - what each review tool reads and returns (#603, #627). UI-free:
 * no React, no Ink, no terminal. Both `lazyhub --mcp` and the `--json` CLI commands call
 * these through src/review-tools/index.js, so the two surfaces cannot drift.
 *
 * Every function here only READS: it calls typed executor reads (which go through runGh(),
 * classified and fail-closed) and the pure engines the TUI views use. No write is imported
 * here; src/review-tools/read-only.test.js checks that, and checks every gh argv a tool
 * produces is classified as a read.
 *
 * Each runner returns `{ data, complete, notices }`. `complete` is false whenever something
 * was capped or could not be read, and `notices` says what (D16: never silently cut).
 */

import {
  fetchReviewQueueEvidence,
  getBaseCheckHistory,
  getClaimsContext,
  getFailedLog,
  getPR,
  getPRChecks,
  getPRFilePatch,
  getReviewDelta,
  listOpenPRsWithFiles,
  listPRChangedPaths,
  listPRFilesPage,
  loadEvidenceDetail,
} from '../executor.js'
import { groupQueue, reasonText, truncationSummary, whyLine } from '../features/queue/model.js'
import { loadWhyRed } from '../features/prs/why-red.js'
import { extractClaims, referencedIssues, verifyClaims } from '../features/prs/claims.js'
import { MAX_OPEN_PRS, getCollisionScan, generatedPatterns } from '../features/prs/collisions/scan.js'
import { buildClusters, collisionsFor, findCollisions, suggestMergeOrder } from '../features/prs/collisions/engine.js'
import { buildStory, markSinceReview } from '../features/prs/story/build.js'
import { sanitize, sanitizeCode, sanitizePath, sanitizeRaw } from '../utils-core.js'

/**
 * Every read the tools may make, resolved when a tool runs (so importing this file touches
 * nothing). Injectable so tests can swap the whole set.
 */
export const defaultReads = () => Object.freeze({
  fetchReviewQueueEvidence,
  getBaseCheckHistory,
  getClaimsContext,
  getFailedLog,
  getPR,
  getPRChecks,
  getPRFilePatch,
  getReviewDelta,
  listOpenPRsWithFiles,
  listPRChangedPaths,
  listPRFilesPage,
  loadEvidenceDetail,
})
/** @typedef {ReturnType<typeof defaultReads>} Reads */

/** File-list pages walked for the story (100 files each), the same ceiling as the TUI story view. */
export const STORY_MAX_PAGES = 100
/** Open PRs read for a repository-wide collision scan (cursor pages of 50), the TUI radar's ceiling. */
export const COLLISION_MAX_OPEN_PRS = MAX_OPEN_PRS

const UNKNOWN = 'unknown'
const known = (/** @type {any} */ v) => v !== undefined && v !== null && v !== UNKNOWN

/**
 * @typedef {{ repo: string|null, args: Record<string, any>, reads: Reads, now: () => number }} ToolCtx
 * @typedef {{ data: any, complete: boolean, notices: string[] }} ToolResult
 */

// ---------------------------------------------------------------------------------------------
// review_queue
// ---------------------------------------------------------------------------------------------

/**
 * @param {any} item evidence record from fetchReviewQueueEvidence
 * @param {number} now
 */
function queueItem(item, now) {
  const f = item.facts || {}
  return {
    repo: item.identity?.repo ?? UNKNOWN,
    number: item.identity?.number ?? null,
    url: item.identity?.url ?? null,
    group: item.group?.group ?? UNKNOWN,
    because: item.group?.because ?? UNKNOWN,
    why: whyLine(item, now),
    reasons: (item.attention || []).map((/** @type {any} */ r) => ({ code: r.code, text: reasonText(r), fact: r.fact, source: r.source })),
    head: item.context?.head?.value ?? UNKNOWN,
    base: item.context?.base?.value ?? UNKNOWN,
    checks: f.checks?.value ?? UNKNOWN,
    review_decision: f.review_decision?.value ?? UNKNOWN,
    mergeable: f.mergeable?.value ?? UNKNOWN,
    is_draft: f.is_draft?.value ?? UNKNOWN,
    updated_at: f.updated_at?.value ?? UNKNOWN,
    membership: item.membership || [],
    author: { login: item.actor?.login ?? UNKNOWN, attribution: 'unverified' },
    untrusted: { title: item.untrusted?.title ?? '', title_truncated: Boolean(item.untrusted?.title_truncated) },
  }
}

/**
 * @param {ToolCtx} ctx
 * @returns {Promise<ToolResult>}
 */
export async function reviewQueue({ args, reads, now }) {
  const scope = args.repo ? { repos: [args.repo] } : args.org ? { org: args.org } : undefined
  const after = { reviewRequested: args.after_review_requested, authored: args.after_authored }
  const res = await reads.fetchReviewQueueEvidence({ limit: args.limit ?? 30, scope, after, now })
  const at = now()
  const groups = groupQueue(res.items || []).map(g => ({
    id: g.id,
    label: g.label,
    count: g.items.length,
    items: g.items.map(i => queueItem(i, at)),
  }))
  const t = res.truncation || {}
  const notices = []
  const summary = truncationSummary(t)
  if (summary) notices.push(`${summary}; pass after_review_requested / after_authored with the next_cursor values to read the next page`)
  if (res.rate_limit?.low === true) notices.push(`GitHub API quota is low (${res.rate_limit.remaining} left, resets ${res.rate_limit.reset_at})`)
  return {
    data: {
      account: res.account ?? UNKNOWN,
      host: res.host ?? UNKNOWN,
      scope: scope ? (scope.repos ? { repo: args.repo } : { org: args.org }) : { account: true },
      order: 'groups in fixed precedence (needs_my_review, ci_failing, changes_requested, waiting, ready, unknown); most recently updated first inside a group',
      groups,
      truncation: t,
      rate_limit: res.rate_limit ?? UNKNOWN,
    },
    complete: !t.review_requested?.has_more && !t.authored?.has_more,
    notices,
  }
}

// ---------------------------------------------------------------------------------------------
// pr_evidence
// ---------------------------------------------------------------------------------------------

/**
 * @param {ToolCtx} ctx
 * @returns {Promise<ToolResult>}
 */
export async function prEvidence({ repo, args, reads, now }) {
  const detail = await reads.loadEvidenceDetail(repo, args.number, { now })
  const notices = []
  for (const e of detail.errors || []) notices.push(`not read: ${e.part} (${sanitizeRaw(e.message)})`)
  const files = detail.files?.value
  if (files && files !== UNKNOWN && files.truncated) notices.push(`file list capped: ${files.returned} of ${files.total} files returned`)
  const req = detail.required_checks?.value
  if (req && req !== UNKNOWN && req.truncated) notices.push('required-check list capped by GitHub; counts are lower bounds')
  const un = detail.record?.untrusted || {}
  if (un.body_truncated) notices.push('PR description cut to its first 4000 characters')
  return {
    data: {
      evidence_version: detail.schema_version,
      record: detail.record,
      files: detail.files,
      required_checks: detail.required_checks,
      head: detail.head,
      errors: detail.errors || [],
      fetched_at: detail.fetched_at,
    },
    complete: notices.length === 0,
    notices,
  }
}

// ---------------------------------------------------------------------------------------------
// why_ci_red
// ---------------------------------------------------------------------------------------------

/** @param {any} c CheckAnalysis from why-red.js */
function checkOut(c) {
  return {
    name: sanitizeRaw(c.name),
    url: c.url,
    duration: c.duration,
    failing_step: c.step,
    job: c.job,
    log: { state: c.log?.state ?? UNKNOWN, detail: sanitizeRaw(c.log?.detail || '') },
    excerpt: c.excerpt
      ? {
          kind: c.excerpt.kind,
          lines: c.excerpt.lines,
          locations: (c.excerpt.locations || []).map((/** @type {any} */ l) => ({ path: sanitizePath(l.path), line: l.line, col: l.col })),
          truncated: Boolean(c.excerpt.truncated),
        }
      : null,
    likely_changed_lines: c.blame
      ? {
          items: c.blame.items.map((/** @type {any} */ m) => ({ path: sanitizePath(m.path), line: m.line, fail_line: m.failLine, kind: m.kind, via: m.via, code: sanitizeCode(m.text) })),
          unmatched: c.blame.unmatched,
          ambiguous: c.blame.ambiguous,
          capped: Boolean(c.blame.capped),
        }
      : null,
    likely_changed_lines_note: c.blameNote ? sanitizeRaw(c.blameNote) : null,
    base_branch: { verdict: c.base?.verdict ?? UNKNOWN, text: sanitizeRaw(c.base?.text || '') },
  }
}

/**
 * @param {ToolCtx} ctx
 * @returns {Promise<ToolResult>}
 */
export async function whyCiRed({ repo, args, reads }) {
  const [pr, checks] = await Promise.all([reads.getPR(repo, args.number), reads.getPRChecks(repo, args.number)])
  const baseBranch = typeof pr?.baseRefName === 'string' ? pr.baseRefName : ''
  const model = await loadWhyRed({
    checks,
    repo,
    prNumber: args.number,
    baseBranch,
    baseRuns: args.base_runs,
    deps: {
      getFailedLog: reads.getFailedLog,
      listPRChangedPaths: reads.listPRChangedPaths,
      getPRFilePatch: reads.getPRFilePatch,
      getBaseCheckHistory: reads.getBaseCheckHistory,
    },
  })
  const notices = []
  if (checks?.truncated || checks?.error) notices.push(`check list incomplete${checks.error ? ` (${sanitizeRaw(checks.error)})` : ''}`)
  if (model.notAnalysed > 0) notices.push(`${model.notAnalysed} of ${model.totalFailing} failing checks not analysed (only the first ${model.checks.length} are); see get_checks for the rest`)
  if (model.pending > 0 && model.state === 'ok') notices.push(`${model.pending} check(s) still running, so more may fail`)
  if (model.filesNote) notices.push(sanitizeRaw(model.filesNote))
  return {
    data: {
      state: model.state,
      base_branch: baseBranch ? sanitizePath(baseBranch) : UNKNOWN,
      total_failing: model.totalFailing,
      pending: model.pending,
      not_analysed: model.notAnalysed,
      checks: model.checks.map(checkOut),
    },
    complete: notices.length === 0,
    notices,
  }
}

// ---------------------------------------------------------------------------------------------
// claims_check
// ---------------------------------------------------------------------------------------------

/**
 * @param {ToolCtx} ctx
 * @returns {Promise<ToolResult>}
 */
export async function claimsCheck({ repo, args, reads }) {
  const pr = await reads.getPR(repo, args.number)
  const extracted = extractClaims({ title: pr?.title || '', body: pr?.body || '' })
  const ctx = await reads.getClaimsContext(repo, args.number, referencedIssues(extracted.claims))
  const checked = verifyClaims(extracted.claims, ctx)
  const notices = [...extracted.notices, ...checked.notices]
  return {
    data: {
      summary: { verified: checked.summary.verified, contradicted: checked.summary.contradicted, unverifiable: checked.summary.unverifiable, total: checked.summary.total, line: checked.summary.line },
      claims: checked.claims.map((/** @type {any} */ c) => ({
        id: c.id,
        type: c.type,
        status: c.status,
        reason: sanitizeRaw(c.reason),
        source: c.source,
        line: c.line ?? null,
        evidence: (c.evidence || []).map((/** @type {any} */ e) => ({
          path: e.path == null ? null : sanitizePath(e.path),
          line: e.line ?? null,
          text: e.text == null ? null : sanitizeCode(e.text),
        })),
        untrusted: { text: sanitize(c.text || '') },
      })),
      files_read: Array.isArray(ctx?.files) ? ctx.files.length : 0,
      files_truncated: Boolean(ctx?.filesTruncated),
    },
    complete: notices.length === 0,
    notices,
  }
}

// ---------------------------------------------------------------------------------------------
// collisions
// ---------------------------------------------------------------------------------------------

/** @param {any} p a pair from findCollisions */
function pairOut(p) {
  return {
    a: p.a,
    b: p.b,
    likely: Boolean(p.likely),
    level: p.level,
    generated_only: Boolean(p.generatedOnly),
    files: (p.files || []).map((/** @type {any} */ f) => ({ path: sanitizePath(f.path), kind: f.kind, level: f.level, likely: Boolean(f.likely), detail: sanitizeCode(f.detail || '') })),
    generated: (p.generated || []).map((/** @type {string} */ g) => sanitizePath(g)),
  }
}

/** @param {any} pr a scanned PR row */
function prOut(pr) {
  return {
    number: pr.number,
    base: sanitizePath(pr.baseRefName || ''),
    is_draft: Boolean(pr.isDraft),
    url: pr.url || null,
    author: pr.author ? sanitizeRaw(pr.author) : UNKNOWN,
    untrusted: { title: sanitize(pr.title || '') },
  }
}

/**
 * Repository-wide view over open PRs: clusters, generated files and a suggested merge order.
 * @param {any[]} open
 * @param {any[]} pairs
 */
function repoView(open, pairs) {
  const { clusters, generated } = buildClusters(pairs)
  const { steps, independent } = suggestMergeOrder(open, pairs)
  return {
    clusters: clusters.map(c => ({ prs: c.prs, likely: c.likely, pairs: c.pairs.map(pairOut) })),
    generated_files: generated.map(g => ({ path: sanitizePath(g.path), prs: g.prs })),
    merge_order: steps.map(s => ({ number: s.number, overlaps: s.overlaps, size: s.size, serial_with: s.serial, affects: s.affects, reason: sanitizeRaw(s.reason) })),
    independent,
  }
}

/**
 * @param {ToolCtx} ctx
 * @returns {Promise<ToolResult>}
 */
export async function collisions({ repo, args, reads }) {
  const generated = generatedPatterns()
  const notices = []
  if (args.number) {
    const scan = await getCollisionScan(repo, args.number)
    const open = scan.prs.filter((/** @type {any} */ p) => p.state === undefined || p.state === 'OPEN')
    const current = scan.prs.find((/** @type {any} */ p) => p.number === args.number) || null
    const { pairs, otherBase } = findCollisions(open, { generated })
    if (scan.notScanned > 0) notices.push(`${scan.notScanned} older open PR(s) not scanned (the scan reads the ${COLLISION_MAX_OPEN_PRS} most recently updated); they may collide too`)
    for (const c of scan.filesCapped || []) notices.push(`file list incomplete for #${c.number}: ${c.shown} of ${c.total} files`)
    if (scan.hunkSkipped?.length) notices.push(`hunks not compared for ${scan.hunkSkipped.map((/** @type {number} */ n) => `#${n}`).join(', ')}: those overlaps are file-level only`)
    if (scan.patchTruncated?.length) notices.push(`patch list cut off for ${scan.patchTruncated.map((/** @type {number} */ n) => `#${n}`).join(', ')}`)
    for (const e of scan.errors || []) notices.push(`could not read #${e.number} (${sanitizeRaw(e.message)}); its overlaps may be missing`)
    if (otherBase > 0) notices.push(`${otherBase} open PR(s) target other base branches and were not compared`)
    const isOpen = Boolean(current && (current.state === undefined || current.state === 'OPEN'))
    return {
      data: {
        number: args.number,
        depth: 'line',
        open: isOpen,
        pr: current ? prOut(current) : null,
        collisions: isOpen ? collisionsFor(args.number, pairs).map(p => ({ other: p.other, ...pairOut(p) })) : [],
        repository: repoView(open, pairs),
        scanned: open.length,
        total_open: scan.totalOpen,
        prs: open.map(prOut),
      },
      complete: notices.length === 0,
      notices,
    }
  }
  const prs = []
  let totalOpen = 0
  let after = null
  while (prs.length < COLLISION_MAX_OPEN_PRS) {
    const page = await reads.listOpenPRsWithFiles(repo, { after })
    totalOpen = page.totalCount
    prs.push(...page.prs)
    if (!page.hasNextPage) break
    after = page.endCursor
  }
  const { pairs, otherBase } = findCollisions(prs, { generated })
  if (totalOpen > prs.length) notices.push(`${totalOpen - prs.length} older open PR(s) not scanned (the scan reads the ${COLLISION_MAX_OPEN_PRS} most recently updated); they may collide too`)
  const capped = prs.filter(p => p.filesCursor || p.files.length < p.filesTotal)
  if (capped.length) notices.push(`file lists cut at the first 100 files for ${capped.map(p => `#${p.number}`).join(', ')}; pass number for a deeper scan of one PR`)
  if (otherBase > 0) notices.push(`${otherBase} open PR(s) target other base branches and were not compared`)
  return {
    data: {
      number: null,
      depth: 'file',
      open: null,
      pr: null,
      collisions: [],
      repository: repoView(prs, pairs),
      scanned: prs.length,
      total_open: totalOpen,
      prs: prs.map(prOut),
    },
    complete: notices.length === 0,
    notices,
  }
}

// ---------------------------------------------------------------------------------------------
// review_story
// ---------------------------------------------------------------------------------------------

/**
 * @param {ToolCtx} ctx
 * @returns {Promise<ToolResult>}
 */
export async function reviewStory({ repo, args, reads }) {
  const first = await reads.listPRFilesPage(repo, args.number)
  const notices = []
  const files = [...first.files]
  let after = first.hasNextPage ? first.endCursor : null
  let pages = 1
  let listError = null
  while (after && pages < STORY_MAX_PAGES) {
    try {
      const page = await reads.listPRFilesPage(repo, args.number, { after })
      files.push(...page.files)
      after = page.hasNextPage ? page.endCursor : null
      pages += 1
    } catch (err) {
      listError = err
      break
    }
  }
  if (listError) notices.push(`file list stopped after ${files.length} files: ${sanitizeRaw(/** @type {any} */ (listError)?.message || 'request failed')}`)
  else if (after) notices.push(`file list capped at ${files.length} files (${STORY_MAX_PAGES} pages)`)
  const seen = new Set()
  const metas = files.filter(f => !seen.has(f.path) && seen.add(f.path))

  let delta = null
  try {
    delta = await reads.getReviewDelta(repo, args.number)
  } catch (err) {
    notices.push(`changes since your last review unknown: ${sanitizeRaw(/** @type {any} */ (err)?.message || 'request failed')}`)
  }
  const sincePaths = delta?.status === 'files' ? new Set(delta.paths) : delta?.status === 'same' ? new Set() : null
  const story = buildStory(metas)
  const marked = markSinceReview(story, sincePaths)
  if (delta?.capped) notices.push('the since-review comparison is capped by GitHub at 300 files')
  const total = Number.isInteger(first.totalCount) ? first.totalCount : metas.length
  return {
    data: {
      total_files: total,
      loaded_files: metas.length,
      steps: marked.steps.map((/** @type {any} */ s, /** @type {number} */ i) => ({
        index: i + 1,
        kind: s.kind,
        title: sanitizeRaw(s.title || ''),
        id: s.id,
        why: sanitizeRaw(s.why || ''),
        since_review: s.sinceCount ?? null,
        files: s.files.map((/** @type {any} */ f) => ({
          path: sanitizePath(f.path),
          additions: f.additions ?? null,
          deletions: f.deletions ?? null,
          change_type: f.changeType ?? null,
          reason: sanitizeRaw(f.reason || ''),
          since_review: f.sinceReview === true,
        })),
      })),
      since_review: delta
        ? { status: delta.status, reason: sanitizeRaw(delta.reason || ''), reviewed_commit: delta.reviewedOid, head: delta.headOid, changed_files: marked.sinceCount, approximate: Boolean(delta.approximate) }
        : { status: UNKNOWN, reason: 'could not be read', reviewed_commit: null, head: null, changed_files: null, approximate: false },
    },
    complete: notices.length === 0 && known(total) && metas.length >= total,
    notices,
  }
}
