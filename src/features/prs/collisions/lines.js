// @ts-nocheck
/**
 * src/features/prs/collisions/lines.js -- the radar's text, as plain {text, tone} rows (#360).
 *
 * Pure: the view only windows and colours these. Every GitHub-sourced string (titles, logins, paths,
 * function headings) is cleaned here; the engine keeps raw values. Wording follows the data: "likely",
 * "may", never "will conflict".
 */
import { sanitize, sanitizePath, sanitizeCode } from '../../../utils-core.js'
import { buildClusters, collisionsFor, findCollisions, suggestMergeOrder } from './engine.js'
import { generatedPatterns } from './scan.js'

const KIND_LABEL = {
  hunk: 'same lines', 'add-add': 'both add file', 'delete-edit': 'deleted vs edited', 'rename-rename': 'renamed differently',
  binary: 'binary in both', symbol: 'same function', rename: 'rename involved', file: 'same file',
}

const clean = (s) => sanitize(String(s ?? ''))
const names = (ns) => ns.map(n => `#${n}`).join(', ')

/**
 * "3m ago" style age.
 * @param {number} ms
 */
export function ago(ms) {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return `${s}s ago`
  if (s < 3600) return `${Math.round(s / 60)}m ago`
  return `${Math.round(s / 3600)}h ago`
}

/**
 * Everything the scan could not do, one line each.
 * @param {object} scan from getCollisionScan
 * @param {number} [now]
 */
export function limitLines(scan, now = Date.now()) {
  const rows = []
  const time = new Date(scan.fetchedAt).toTimeString().slice(0, 5)
  rows.push({ text: `scanned ${time} (${ago(now - scan.fetchedAt)}) - ${scan.prs.length} open PR${scan.prs.length === 1 ? '' : 's'} read of ${scan.totalOpen}`, tone: 'dim' })
  if (scan.notScanned > 0) rows.push({ text: `Not scanned: ${scan.notScanned} older open PR${scan.notScanned === 1 ? '' : 's'} (the scan stops after the most recently updated ones). They may collide too.`, tone: 'warn' })
  if (scan.filesCapped?.length) rows.push({ text: `File list incomplete: ${scan.filesCapped.map(c => `#${c.number} (${c.shown} of ${c.total} files)`).join(', ')}.`, tone: 'warn' })
  if (scan.hunkSkipped?.length) rows.push({ text: `Hunks not compared for ${names(scan.hunkSkipped)}: only the first ${scan.hunkChecked.length} overlapping PRs get a line-level check. Those show as same file.`, tone: 'warn' })
  if (scan.patchTruncated?.length) rows.push({ text: `Patch list cut off for ${names(scan.patchTruncated)}: later files were not compared line by line.`, tone: 'warn' })
  for (const e of scan.errors || []) rows.push({ text: `Could not read #${e.number} (${clean(e.message).slice(0, 80)}); its overlaps may be missing.`, tone: 'warn' })
  return rows
}

function fileRows(p, indent = '    ') {
  const rows = []
  for (const f of p.files.slice(0, 4)) {
    rows.push({ text: `${indent}${sanitizePath(f.path)}  [${KIND_LABEL[f.kind] || f.kind}]`, tone: f.likely ? 'likely' : 'normal' })
    rows.push({ text: `${indent}  ${sanitizeCode(f.detail)}`, tone: 'dim' })
  }
  if (p.files.length > 4) rows.push({ text: `${indent}+${p.files.length - 4} more shared file${p.files.length - 4 === 1 ? '' : 's'}`, tone: 'dim' })
  if (p.generated.length) rows.push({ text: `${indent}generated, merge one at a time: ${p.generated.slice(0, 3).map(sanitizePath).join(', ')}${p.generated.length > 3 ? ` +${p.generated.length - 3}` : ''}`, tone: 'dim' })
  return rows
}

function verdict(p) {
  if (p.generatedOnly) return 'generated files only'
  if (p.likely) return 'likely conflict'
  if (p.level === 'symbol') return 'same function, different lines'
  if (p.level === 'rename') return 'rename involved'
  return 'same file, may merge cleanly'
}

/**
 * @param {object} scan from getCollisionScan
 * @param {'pr'|'repo'} tab
 * @param {{ now?: number }} [opts]
 * @returns {{ text: string, tone: 'head'|'likely'|'warn'|'dim'|'normal'|'ok' }[]}
 */
export function radarLines(scan, tab, { now = Date.now() } = {}) {
  const rows = []
  const cur = scan.prs.find(p => p.number === scan.number)
  if (!cur || cur.state !== 'OPEN') {
    rows.push({ text: `PR #${scan.number} is not open, so it has no collisions. The radar compares open PRs.`, tone: 'normal' })
    return [...rows, ...limitLines(scan, now)]
  }
  const open = scan.prs.filter(p => p.state === undefined || p.state === 'OPEN')
  const byNum = new Map(open.map(p => [p.number, p]))
  const { pairs, otherBase } = findCollisions(open, { generated: generatedPatterns() })
  const label = (n) => { const p = byNum.get(n); return p ? `#${n} ${clean(p.title).slice(0, 60)}${p.author ? ` (${clean(p.author)})` : ''}` : `#${n}` }

  if (tab === 'pr') {
    const mine = collisionsFor(scan.number, pairs)
    rows.push({ text: `#${cur.number} ${clean(cur.title)} -> ${sanitizePath(cur.baseRefName)}`, tone: 'head' })
    if (!mine.length) {
      rows.push({ text: `No other open PR into ${sanitizePath(cur.baseRefName)} shares a file with this one.`, tone: 'ok' })
    } else {
      const likely = mine.filter(m => m.likely).length
      rows.push({ text: `${mine.length} open PR${mine.length === 1 ? '' : 's'} touch the same files; ${likely} likely to conflict. Likely means the data points to it, not that git must fail.`, tone: 'normal' })
      for (const m of mine) {
        rows.push({ text: '', tone: 'normal' })
        rows.push({ text: `${label(m.other)}  - ${verdict(m)}${byNum.get(m.other)?.isDraft ? ' - draft' : ''}`, tone: m.likely ? 'likely' : 'head' })
        rows.push(...fileRows(m))
      }
    }
    if (otherBase > 0) rows.push({ text: '', tone: 'normal' }, { text: `${otherBase} open PR${otherBase === 1 ? '' : 's'} target other base branches and were not compared.`, tone: 'dim' })
  } else {
    const { clusters, generated } = buildClusters(pairs)
    const { steps, independent } = suggestMergeOrder(open, pairs)
    rows.push({ text: 'Collision clusters', tone: 'head' })
    if (!clusters.length) rows.push({ text: 'No two open PRs overlap in code.', tone: 'ok' })
    clusters.forEach((c, i) => {
      rows.push({ text: `${i + 1}. ${names(c.prs)}${c.likely ? '  - likely conflicts inside' : ''}`, tone: c.likely ? 'likely' : 'normal' })
      for (const p of c.pairs) {
        const f = p.files[0]
        rows.push({ text: `   #${p.a} x #${p.b}  ${KIND_LABEL[f.kind] || f.kind}  ${sanitizePath(f.path)}${p.files.length > 1 ? ` +${p.files.length - 1}` : ''}`, tone: 'dim' })
      }
    })
    if (generated.length) {
      rows.push({ text: '', tone: 'normal' }, { text: 'Generated files: merge one at a time', tone: 'head' })
      for (const g of generated) rows.push({ text: `${sanitizePath(g.path)}  ${names(g.prs)}`, tone: 'normal' })
    }
    rows.push({ text: '', tone: 'normal' }, { text: 'Suggested merge order (fewest overlaps, then smaller diff)', tone: 'head' })
    if (!steps.length) rows.push({ text: 'Nothing to order: no open PRs share files.', tone: 'ok' })
    steps.forEach((s, i) => {
      rows.push({ text: `${i + 1}. ${label(s.number)}`, tone: 'normal' })
      rows.push({ text: `   ${clean(s.reason)}`, tone: 'dim' })
    })
    if (independent > 0) rows.push({ text: `${independent} other open PR${independent === 1 ? '' : 's'} overlap nothing and can land any time.`, tone: 'dim' })
    if (otherBase > 0) rows.push({ text: `${otherBase} PR${otherBase === 1 ? '' : 's'} into other base branches were not compared.`, tone: 'dim' })
    rows.push({ text: 'A suggestion only: lazyhub never merges or updates branches for you.', tone: 'dim' })
  }
  rows.push({ text: '', tone: 'normal' }, ...limitLines(scan, now))
  return rows
}
