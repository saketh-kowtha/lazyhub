// @ts-nocheck
/**
 * src/features/prs/story/build.js -- group a PR's changed files into a guided walkthrough (#362).
 *
 * Pure, deterministic, no I/O: the same file list always yields the same steps. Order is
 * core change -> call sites -> config and docs -> tests -> noise. Every input file lands in exactly
 * one step (nothing is dropped); each step says why its files are grouped. Cost is O(n log n), so a
 * 3,000-file PR builds in milliseconds.
 *
 * AI ordering and summaries are a later slice (#362); this module is the deterministic base.
 */

import { classifyFile, moduleStem } from './classify.js'

/** A modified source file with at least this many changed lines counts as a core change. */
export const CORE_CHURN = 15
/** Fewer steps than this are padded by splitting the largest step, when there are enough files. */
export const MIN_STEPS = 3
/** Hard ceiling on the number of steps. */
export const MAX_STEPS = 7

const TITLES = {
  core: 'Core change',
  usage: 'Call sites and usage',
  config: 'Config and docs',
  test: 'Tests',
  noise: 'Noise (lockfiles, generated, snapshots)',
}
const ORDER = ['core', 'usage', 'config', 'test', 'noise']

const churnOf = (f) => (f.additions || 0) + (f.deletions || 0)
const byPath = (a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)

/**
 * Resolve an import specifier written in `from` to a key of the changed-source stem index.
 * @param spec
 * @param from
 * @param stems
 */
function resolveSpec(spec, from, stems) {
  let target = String(spec)
  if (target.startsWith('.')) {
    const parts = from.split('/').slice(0, -1)
    for (const seg of target.split('/')) {
      if (seg === '.' || seg === '') continue
      if (seg === '..') parts.pop()
      else parts.push(seg)
    }
    target = parts.join('/')
  } else {
    target = target.replace(/::/g, '/').replace(/^([\w-]+(\.[\w-]+)+)$/, m => m.replace(/\./g, '/'))
  }
  const stem = moduleStem(target)
  return stems.get(stem) || stems.get(`${stem}/index`) || null
}

/**
 * Split source files into core and usage, using import evidence when a patch's imports are known.
 * @param sources
 * @param imports
 * @returns {Map<string, {kind: 'core'|'usage', reason: string, importedBy: number}>}
 */
function splitSource(sources, imports) {
  const stems = new Map()
  for (const f of sources) {
    stems.set(moduleStem(f.path), f.path)
    stems.set(f.path, f.path)
  }
  const importedBy = new Map()
  const importsChanged = new Map()
  for (const f of sources) {
    for (const spec of imports?.[f.path] || []) {
      const to = resolveSpec(spec, f.path, stems)
      if (!to || to === f.path) continue
      if (!importedBy.has(to)) importedBy.set(to, new Set())
      importedBy.get(to).add(f.path)
      if (!importsChanged.has(f.path)) importsChanged.set(f.path, new Set())
      importsChanged.get(f.path).add(to)
    }
  }
  const out = new Map()
  for (const f of sources) {
    const n = importedBy.get(f.path)?.size || 0
    const imp = importsChanged.get(f.path)
    const churn = churnOf(f)
    if (n > 0) out.set(f.path, { kind: 'core', importedBy: n, reason: `imported by ${n} other changed file${n === 1 ? '' : 's'}` })
    else if (imp?.size) out.set(f.path, { kind: 'usage', importedBy: 0, reason: `imports ${[...imp].sort()[0]}${imp.size > 1 ? ` and ${imp.size - 1} more` : ''}, which this PR changes` })
    else if (f.changeType === 'ADDED') out.set(f.path, { kind: 'core', importedBy: 0, reason: 'new file' })
    else if (churn >= CORE_CHURN) out.set(f.path, { kind: 'core', importedBy: 0, reason: `substantial change (${churn} lines)` })
    else out.set(f.path, { kind: 'usage', importedBy: 0, reason: `small edit (${churn} line${churn === 1 ? '' : 's'}), likely adjusting a caller` })
  }
  // Something has to be the core: promote the biggest change when every source file looked like usage.
  if (sources.length && ![...out.values()].some(v => v.kind === 'core')) {
    const top = [...sources].sort((a, b) => churnOf(b) - churnOf(a) || byPath(a, b))[0]
    out.set(top.path, { kind: 'core', importedBy: 0, reason: `largest source change (${churnOf(top)} lines)` })
  }
  return out
}

/**
 * "3 imported by other changed files, 2 new files" from the per-file reasons of a step.
 * @param files
 */
function tally(files) {
  const counts = new Map()
  for (const f of files) {
    const key = f.reason.replace(/\d+/g, 'N')
    const entry = counts.get(key) || { n: 0, sample: f.reason }
    entry.n += 1
    counts.set(key, entry)
  }
  return [...counts.values()].sort((a, b) => b.n - a.n || (a.sample < b.sample ? -1 : 1)).slice(0, 3)
    .map(e => `${e.n} x ${e.sample}`).join('; ')
}

const WHY = {
  core: 'Start here: files that define the change. New files, big edits and anything other changed files import come first, so definitions are read before their callers.',
  usage: 'Read after the core: small edits and files that import something this PR changes. They show how the core change is used.',
  config: 'Configuration, build tooling and documentation. Quick to check once the code makes sense.',
  test: 'Test code, fixtures and mocks. Check they actually exercise the core change.',
  noise: 'Safe to skim: lockfiles, generated or vendored output, snapshots, binary assets and pure renames. Collapsed by default; nothing here is hidden, expand it to see every file.',
}

function makeStep(kind, files, part) {
  const additions = files.reduce((n, f) => n + (f.additions || 0), 0)
  const deletions = files.reduce((n, f) => n + (f.deletions || 0), 0)
  const suffix = part ? ` (${part.index} of ${part.of})` : ''
  return {
    id: part ? `${kind}-${part.index}` : kind,
    kind,
    title: TITLES[kind] + suffix,
    why: `${WHY[kind]} Grouped because: ${tally(files)}.`,
    files,
    additions,
    deletions,
    collapsed: kind === 'noise',
  }
}

/**
 * Split `files` into exactly `parts` consecutive runs of near-equal length (parts <= files.length).
 * @param files
 * @param parts
 */
function chunk(files, parts) {
  const out = []
  const base = Math.floor(files.length / parts)
  const extra = files.length % parts
  let at = 0
  for (let i = 0; i < parts; i += 1) {
    const size = base + (i < extra ? 1 : 0)
    out.push(files.slice(at, at + size))
    at += size
  }
  return out
}

/**
 * Build the walkthrough.
 * @param {{path: string, additions?: number, deletions?: number, changeType?: string}[]} changed the PR's files (each path once)
 * @param {{ imports?: Record<string, string[]> }} [opts] import specifiers per file path, when patches are known
 * @returns {{ steps: object[], total: number, importsUsed: boolean }}
 */
export function buildStory(changed, { imports } = {}) {
  const groups = { core: [], usage: [], config: [], test: [], noise: [] }
  const classified = changed.map(f => ({ f, c: classifyFile(f) }))
  const sources = classified.filter(x => x.c.kind === 'source').map(x => x.f)
  const split = splitSource(sources, imports)

  for (const { f, c } of classified) {
    if (c.kind === 'source') {
      const s = split.get(f.path)
      groups[s.kind].push({ ...f, reason: s.reason, importedBy: s.importedBy })
    } else {
      groups[c.kind].push({ ...f, reason: c.reason, importedBy: 0 })
    }
  }
  groups.core.sort((a, b) => b.importedBy - a.importedBy || churnOf(b) - churnOf(a) || byPath(a, b))
  groups.usage.sort((a, b) => churnOf(b) - churnOf(a) || byPath(a, b))
  for (const k of ['config', 'test', 'noise']) groups[k].sort(byPath)

  // Too few groups to be a walkthrough: split the biggest group into more pieces, one at a time,
  // while there are enough files. Each kind keeps its order across its pieces.
  const kinds = ORDER.filter(k => groups[k].length)
  const pieces = Object.fromEntries(kinds.map(k => [k, 1]))
  const count = () => kinds.reduce((n, k) => n + pieces[k], 0)
  while (count() < MIN_STEPS && count() < MAX_STEPS) {
    let best = null
    for (const k of kinds) {
      if (pieces[k] < groups[k].length && (!best || groups[k].length / pieces[k] > groups[best].length / pieces[best])) best = k
    }
    if (!best) break
    pieces[best] += 1
  }
  const parts = kinds.flatMap(k => (pieces[k] === 1
    ? [{ kind: k, files: groups[k], part: null }]
    : chunk(groups[k], pieces[k]).map((files, i, all) => ({ kind: k, files, part: { index: i + 1, of: all.length } }))))

  return {
    steps: parts.map(p => makeStep(p.kind, p.files, p.part)),
    total: changed.length,
    importsUsed: Boolean(imports && Object.keys(imports).length),
  }
}

/**
 * Mark which files changed after the viewer's last review.
 * @param {{steps: object[]}} story
 * @param {Set<string>|null} changedPaths paths changed since the review, or null when unknown
 * @returns {{ steps: object[], sinceCount: number|null }} new steps (inputs are not mutated)
 */
export function markSinceReview(story, changedPaths) {
  if (!changedPaths) return { steps: story.steps, sinceCount: null }
  let sinceCount = 0
  const steps = story.steps.map(step => {
    const files = step.files.map(f => {
      const since = changedPaths.has(f.path)
      if (since) sinceCount += 1
      return since ? { ...f, sinceReview: true } : f
    })
    return { ...step, files, sinceCount: files.reduce((n, f) => n + (f.sinceReview ? 1 : 0), 0) }
  })
  return { steps, sinceCount }
}
