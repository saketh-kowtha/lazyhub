// @ts-nocheck
/**
 * src/features/prs/collisions/scan.js -- bounded fetch for the collision radar (#360).
 *
 * File lists come from GraphQL cursor pages of open PRs. Patches (for hunk and function overlap) are
 * fetched only for the pairs that already share a file, with a small concurrency, a ceiling on how
 * many PRs get them, and a report of everything that was not fetched (D16): the view prints it.
 */
import { getPRWithFiles, getPRPatches, listOpenPRsWithFiles, listPRFilesPage } from '../../../executor.js'
import { logSwallowed } from '../../../contain.js'
import { loadConfig } from '../../../config.js'
import { DEFAULT_GENERATED, findCollisions, isGenerated, parsePatchChanges } from './engine.js'

export const MAX_OPEN_PRS = 300        // 6 cursor pages of 50
export const MAX_FILE_PAGES = 3        // extra file pages per PR past the first 100 files
export const MAX_FILE_CALLS = 30       // extra file-page calls across the whole scan
export const MAX_ENRICH_PRS = 20       // PRs other than the current one that get patches
export const MAX_PATCH_PATHS = 300     // paths named in one patch request
export const CONCURRENCY = 4

/** Generated-file patterns: the built-in list plus `[features.prs].generated_files`. */
export function generatedPatterns() {
  let extra = []
  try { extra = loadConfig().pr?.generatedFiles || [] } catch (err) { logSwallowed('collisions.config', err) }
  return [...DEFAULT_GENERATED, ...extra]
}

/**
 * Run `fn` over `items` with at most `limit` in flight; results keep the input order.
 * @param {Array} items
 * @param {number} limit
 * @param {Function} fn
 */
export async function mapPool(items, limit, fn) {
  const out = new Array(items.length)
  let next = 0
  const worker = async () => {
    while (next < items.length) {
      const i = next++
      out[i] = await fn(items[i], i)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return out
}

function applyPatches(pr, fetched, wanted) {
  const byPath = new Map(fetched.files.map(f => [f.path, f]))
  for (const f of pr.files) {
    const r = byPath.get(f.path)
    if (!r) continue
    if (r.oldPath && f.changeType === 'RENAMED') f.oldPath = r.oldPath
    if (!wanted.has(f.path)) continue
    if (typeof r.patch === 'string' && r.patch) f.changes = parsePatchChanges(r.patch)
    else if (r.additions + r.deletions === 0) f.changes = { binary: true, ranges: [], symbols: [] }
    else f.changes = { unavailable: 'omitted', ranges: [], symbols: [] }
  }
}

/**
 * Scan the repository's open PRs for collisions with `number`.
 * @param {string} repo
 * @param {number} number the PR the radar was opened from
 * @returns {Promise<object>} { repo, number, fetchedAt, prs, current, totalOpen, notScanned, filesCapped,
 *   hunkChecked, hunkSkipped, patchTruncated, errors }
 */
export async function getCollisionScan(repo, number) {
  const generated = generatedPatterns()
  const prs = []
  let totalOpen = 0
  let after = null
  let more = false
  while (prs.length < MAX_OPEN_PRS) {
    const page = await listOpenPRsWithFiles(repo, { after })
    totalOpen = page.totalCount
    prs.push(...page.prs)
    more = page.hasNextPage
    if (!more) break
    after = page.endCursor
  }
  const listed = prs.length
  let current = prs.find(p => p.number === number) || null
  let currentOutside = false
  if (!current) {
    current = await getPRWithFiles(repo, number)
    currentOutside = true
    prs.push(current)
  }
  const errors = []

  // Files past the first 100 of a PR: a few more pages, the current PR first, then say what is missing.
  let calls = 0
  const order = [current, ...prs.filter(p => p !== current)]
  for (const pr of order) {
    let pages = 0
    while (pr.filesCursor && pages < MAX_FILE_PAGES && calls < MAX_FILE_CALLS) {
      calls++; pages++
      try {
        const pg = await listPRFilesPage(repo, pr.number, { after: pr.filesCursor })
        pr.files.push(...pg.files)
        pr.filesCursor = pg.hasNextPage ? pg.endCursor : null
      } catch (err) {
        errors.push({ number: pr.number, message: `file list: ${err.message}` })
        break
      }
    }
  }
  const filesCapped = prs.filter(p => p.filesCursor || p.files.length < p.filesTotal).map(p => ({ number: p.number, shown: p.files.length, total: p.filesTotal }))

  const result = {
    repo, number, fetchedAt: Date.now(), prs, totalOpen, currentOutside,
    notScanned: Math.max(0, totalOpen - listed - (currentOutside && current.state === 'OPEN' ? 1 : 0)),
    filesCapped, hunkChecked: [], hunkSkipped: [], patchTruncated: [], errors,
  }
  if (current.state !== 'OPEN') return result

  const sameBase = (p) => p.baseRefName === current.baseRefName
  // Renames are invisible in the GraphQL list: ask REST for the previous names of PRs that rename files.
  const renamers = prs.filter(p => sameBase(p) && p.files.some(f => f.changeType === 'RENAMED')).slice(0, MAX_ENRICH_PRS + 1)
  const renameFirst = [current, ...renamers.filter(p => p !== current)].filter(p => p.files.some(f => f.changeType === 'RENAMED'))
  await mapPool(renameFirst, CONCURRENCY, async (pr) => {
    try {
      const fetched = await getPRPatches(repo, pr.number, [])
      applyPatches(pr, fetched, new Set())
    } catch (err) { errors.push({ number: pr.number, message: `rename lookup: ${err.message}` }) }
  })

  // Hunk and function overlap only matters for pairs that already share a file.
  const { pairs } = findCollisions(prs, { generated })
  const candidates = new Map()
  for (const p of pairs) {
    if (p.a !== current.number && p.b !== current.number) continue
    const other = p.a === current.number ? p.b : p.a
    const shared = p.files.filter(f => f.kind === 'file' && f.hunksCompared === false).map(f => f.path)
    if (shared.length) candidates.set(other, shared)
  }
  const ranked = [...candidates.entries()].sort((x, y) => y[1].length - x[1].length || x[0] - y[0])
  const chosen = ranked.slice(0, MAX_ENRICH_PRS)
  result.hunkSkipped = ranked.slice(MAX_ENRICH_PRS).map(([n]) => n).sort((a, b) => a - b)
  const byNum = new Map(prs.map(p => [p.number, p]))
  const currentPaths = new Set(chosen.flatMap(([, paths]) => paths))
  // Rename-aware: a path the current PR knows by its old name is wanted under both names.
  for (const f of current.files) if (f.oldPath && currentPaths.has(f.oldPath)) currentPaths.add(f.path)
  const jobs = [
    { pr: current, paths: [...currentPaths].slice(0, MAX_PATCH_PATHS) },
    ...chosen.map(([n, paths]) => ({ pr: byNum.get(n), paths: paths.slice(0, MAX_PATCH_PATHS) })),
  ].filter(j => j.pr && j.paths.length)
  await mapPool(jobs, CONCURRENCY, async ({ pr, paths }) => {
    try {
      const fetched = await getPRPatches(repo, pr.number, paths)
      applyPatches(pr, fetched, new Set(paths))
      if (pr !== current) result.hunkChecked.push(pr.number)
      if (fetched.truncated) result.patchTruncated.push(pr.number)
    } catch (err) {
      logSwallowed('collisions.patches', err)
      errors.push({ number: pr.number, message: `patches: ${err.message}` })
    }
  })
  result.hunkChecked.sort((a, b) => a - b)
  result.patchTruncated.sort((a, b) => a - b)
  return result
}

export { isGenerated }
