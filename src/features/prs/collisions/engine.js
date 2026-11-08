/**
 * src/features/prs/collisions/engine.js -- pure overlap and merge-order logic (#360).
 *
 * No I/O, no React. Input is the open PRs with their changed files; some files also carry `changes`
 * parsed from the patch (`parsePatchChanges`). Everything here only reports what that data shows:
 * "likely" means the data points at a conflict, never that git will certainly report one (it depends
 * on the final merge base and on whichever PR lands first).
 *
 * Levels, strongest first: hunk (changed old-side line ranges touch), symbol (both change code
 * under the same function heading git printed), file (same file, nothing finer is known).
 * Special cases: add-add, delete-edit, binary, rename.
 */

/** Files nobody should hand-merge: shown as "generated: merge one at a time", never as a code overlap. */
export const DEFAULT_GENERATED = [
  'docs/FILE_MAP.md',
  'package-lock.json', 'npm-shrinkwrap.json', 'yarn.lock', 'pnpm-lock.yaml', 'bun.lockb', 'bun.lock',
  'Cargo.lock', 'go.sum', 'poetry.lock', 'Pipfile.lock', 'Gemfile.lock', 'composer.lock', 'uv.lock', 'flake.lock',
]

/** Kinds that point at a real conflict, and the order used to pick a pair's headline level. */
const RANK = { hunk: 4, 'add-add': 4, 'delete-edit': 4, 'rename-rename': 4, binary: 4, symbol: 3, rename: 2, file: 1 }
const LIKELY = new Set(['hunk', 'add-add', 'delete-edit', 'rename-rename', 'binary'])
// Doubled line coordinates: line n is 2n, an insertion before line n is 2n-1. Two changes that touch or
// sit on adjacent lines (gap of one line, 2 coordinate steps) are treated as overlapping, as git does.
const ADJACENT = 2
const MAX_SYMBOL = 80

function globToRegExp(glob) {
  const body = glob
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '\u0000')
    .replace(/\*/g, '[^/]*')
    .replace(/\?/g, '[^/]')
    .replace(/\u0000/g, '.*')
  return new RegExp(`^${body}$`)
}

/**
 * Does `path` match one of the generated-file patterns? A pattern without a slash matches the base
 * name anywhere (`*.lock`, `package-lock.json`); with a slash it matches the whole path.
 * @param {string} path
 * @param {string[]} [patterns]
 */
export function isGenerated(path, patterns = DEFAULT_GENERATED) {
  const p = String(path || '')
  const base = p.slice(p.lastIndexOf('/') + 1)
  for (const pat of patterns || []) {
    if (typeof pat !== 'string' || !pat) continue
    if (globToRegExp(pat).test(pat.includes('/') ? p : base)) return true
  }
  return false
}

/**
 * Parse one file's unified patch into the old-side line ranges it changes and the function headings
 * (the text after the second pair of at-signs in a hunk header) of the hunks that hold a change.
 * @param {string} patch
 * @returns {{ ranges: {lo:number, hi:number}[], symbols: string[] }}
 */
export function parsePatchChanges(patch) {
  const marks = []
  const symbols = new Set()
  let oldLine = 0
  let heading = ''
  let inHunk = false
  let hunkHasChange = false
  const flush = () => { if (inHunk && hunkHasChange && heading) symbols.add(heading) }
  for (const raw of String(patch || '').split('\n')) {
    const h = raw.match(/^@@ -(\d+)(?:,\d+)? \+\d+(?:,\d+)? @@ ?(.*)$/)
    if (h) {
      flush()
      inHunk = true
      hunkHasChange = false
      oldLine = parseInt(h[1], 10)
      heading = h[2].replace(/\s+/g, ' ').trim().slice(0, MAX_SYMBOL)
      continue
    }
    if (!inHunk || raw.startsWith('\\')) continue
    if (raw.startsWith('-')) { marks.push(2 * oldLine); oldLine++; hunkHasChange = true }
    else if (raw.startsWith('+')) { marks.push(2 * oldLine - 1); hunkHasChange = true }
    else oldLine++
  }
  flush()
  marks.sort((a, b) => a - b)
  const ranges = []
  for (const m of marks) {
    const last = ranges[ranges.length - 1]
    if (last && m <= last.hi + ADJACENT) last.hi = Math.max(last.hi, m)
    else ranges.push({ lo: m, hi: m })
  }
  return { ranges, symbols: [...symbols].sort() }
}

/**
 * Do two sorted range lists touch or sit on adjacent lines?
 * @param {{lo:number,hi:number}[]} a
 * @param {{lo:number,hi:number}[]} b
 */
export function rangesOverlap(a, b) {
  let i = 0
  let j = 0
  while (i < a.length && j < b.length) {
    if (a[i].lo <= b[j].hi + ADJACENT && b[j].lo <= a[i].hi + ADJACENT) return true
    if (a[i].hi < b[j].hi) i++
    else j++
  }
  return false
}

const lineOf = (c) => Math.max(1, Math.ceil(c / 2))
function rangeText(ranges) {
  const shown = ranges.slice(0, 3).map(r => (lineOf(r.lo) === lineOf(r.hi) ? `${lineOf(r.lo)}` : `${lineOf(r.lo)}-${lineOf(r.hi)}`)).join(', ')
  return ranges.length > 3 ? `${shown} +${ranges.length - 3} more` : shown
}

/**
 * Two PRs know the file under different names: one renamed what the other still uses.
 * @param {object} pa PR a
 * @param {object} fa file of a
 * @param {object} pb PR b
 * @param {object} fb file of b
 */
function compareRenamed(pa, fa, pb, fb) {
  const ra = fa.changeType === 'RENAMED' && fa.oldPath
  const rb = fb.changeType === 'RENAMED' && fb.oldPath
  if (ra && rb && fa.oldPath === fb.oldPath) {
    return { path: fa.oldPath, kind: 'rename-rename', detail: `#${pa.number} renames it to ${fa.path}, #${pb.number} to ${fb.path}` }
  }
  const aRenames = ra && fa.oldPath === fb.path
  const [renamer, other, r, o] = aRenames ? [pa, pb, fa, fb] : [pb, pa, fb, fa]
  const act = o.changeType === 'DELETED' ? 'deletes it' : 'changes it'
  return { path: r.oldPath, kind: 'rename', detail: `#${renamer.number} renames ${r.oldPath} to ${r.path}; #${other.number} ${act}. Git usually follows renames, check the result` }
}

/**
 * Same path in both PRs, both modify it: compare what the patches say.
 * @param {object} pa PR a
 * @param {object} fa file of a
 * @param {object} pb PR b
 * @param {object} fb file of b
 */
function compareChanges(pa, fa, pb, fb) {
  const base = { path: fa.path }
  const ca = fa.changes
  const cb = fb.changes
  if (fa.binary || fb.binary || ca?.binary || cb?.binary) {
    return { ...base, kind: 'binary', detail: 'binary or non-text change in both PRs; git cannot merge that content' }
  }
  if (!ca || !cb || ca.unavailable || cb.unavailable) {
    const omitted = ca?.unavailable || cb?.unavailable
    return { ...base, kind: 'file', hunksCompared: false, detail: omitted ? 'a patch is too large for GitHub to show, so hunks were not compared' : 'hunks were not compared for this pair' }
  }
  if (rangesOverlap(ca.ranges, cb.ranges)) {
    return { ...base, kind: 'hunk', detail: `old-side lines changed in both: #${pa.number} ${rangeText(ca.ranges)}, #${pb.number} ${rangeText(cb.ranges)}` }
  }
  const shared = ca.symbols.filter(sym => cb.symbols.includes(sym))
  if (shared.length) return { ...base, kind: 'symbol', symbol: shared[0], detail: `both change code under "${shared[0]}" (git's function heading), on different lines` }
  return { ...base, kind: 'file', hunksCompared: true, detail: 'different parts of the file; git can usually merge this' }
}

/**
 * Compare two PRs' versions of one logical file.
 * @param {object} pa PR a
 * @param {object} fa file of a
 * @param {object} pb PR b
 * @param {object} fb file of b
 */
function compareFile(pa, fa, pb, fb) {
  if (fa.path !== fb.path) return compareRenamed(pa, fa, pb, fb)
  const base = { path: fa.path }
  if (fa.changeType === 'ADDED' && fb.changeType === 'ADDED') return { ...base, kind: 'add-add', detail: 'both PRs add this file' }
  const da = fa.changeType === 'DELETED'
  const db = fb.changeType === 'DELETED'
  if (da && db) return { ...base, kind: 'file', detail: 'both PRs delete it' }
  if (da || db) {
    return { ...base, kind: 'delete-edit', detail: `#${da ? pa.number : pb.number} deletes it, #${da ? pb.number : pa.number} changes it` }
  }
  return compareChanges(pa, fa, pb, fb)
}

const keysOf = (f) => (f.oldPath ? [f.path, f.oldPath] : [f.path])

// Every (PR, file) under each name it is known by.
function indexByPath(sorted) {
  const byPath = new Map()
  for (const pr of sorted) {
    for (const f of pr.files || []) {
      for (const k of keysOf(f)) {
        if (!byPath.has(k)) byPath.set(k, [])
        byPath.get(k).push({ pr, f })
      }
    }
  }
  return byPath
}

// Group file pairs by PR pair, same base only.
function groupPairs(byPath) {
  const acc = new Map()
  for (const entries of byPath.values()) {
    for (let i = 0; i < entries.length; i++) {
      for (let j = i + 1; j < entries.length; j++) {
        const A = entries[i]
        const B = entries[j]
        if (A.pr.number === B.pr.number || (A.pr.baseRefName || '') !== (B.pr.baseRefName || '')) continue
        const id = `${A.pr.number}:${B.pr.number}`
        if (!acc.has(id)) acc.set(id, { a: A.pr, b: B.pr, items: new Map() })
        const slot = acc.get(id)
        const fk = `${A.f.path}|${A.f.oldPath || ''}|${B.f.path}|${B.f.oldPath || ''}`
        if (!slot.items.has(fk)) slot.items.set(fk, [A.f, B.f])
      }
    }
  }
  return acc
}

// One PR pair collision, or null when nothing is shared.
function buildPair(slot, generated) {
  const files = []
  const gen = []
  for (const [fa, fb] of slot.items.values()) {
    if (isGenerated(fa.path, generated) || isGenerated(fb.path, generated)) { gen.push(fa.path); continue }
    const c = compareFile(slot.a, fa, slot.b, fb)
    files.push({ ...c, level: RANK[c.kind] >= 4 ? 'hunk' : c.kind, likely: LIKELY.has(c.kind) })
  }
  files.sort((x, y) => RANK[y.kind] - RANK[x.kind] || x.path.localeCompare(y.path))
  if (!files.length && !gen.length) return null
  return {
    a: slot.a.number,
    b: slot.b.number,
    files,
    generated: [...new Set(gen)].sort(),
    likely: files.some(f => f.likely),
    level: files.length ? files[0].level : 'generated',
    generatedOnly: files.length === 0,
  }
}

/**
 * Every colliding pair among PRs that target the same base branch.
 * @param {Array<{number:number, baseRefName?:string, files:Array}>} prs
 * @param {{ generated?: string[] }} [opts]
 * @returns {{ pairs: Array<object>, otherBase: number }}
 *   pair: { a, b, files:[{path,kind,level,likely,detail,symbol?}], generated:[path], likely, level, generatedOnly }
 *   otherBase: how many PRs target a different base than the most common one (never compared)
 */
export function findCollisions(prs, { generated = DEFAULT_GENERATED } = {}) {
  const sorted = [...prs].sort((x, y) => x.number - y.number)
  const pairs = [...groupPairs(indexByPath(sorted)).values()].map(slot => buildPair(slot, generated)).filter(Boolean)
  pairs.sort((x, y) => x.a - y.a || x.b - y.b)
  const counts = new Map()
  for (const p of sorted) counts.set(p.baseRefName || '', (counts.get(p.baseRefName || '') || 0) + 1)
  const otherBase = sorted.length - Math.max(0, ...counts.values())
  return { pairs, otherBase }
}

/**
 * Pairs that involve one PR, as rows with `other`, most serious first.
 * @param {number} number
 * @param {Array<object>} pairs from findCollisions
 */
export function collisionsFor(number, pairs) {
  return pairs
    .filter(p => p.a === number || p.b === number)
    .map(p => ({ ...p, other: p.a === number ? p.b : p.a }))
    .sort((x, y) => Number(y.likely) - Number(x.likely) || (RANK[y.files[0]?.kind] || 0) - (RANK[x.files[0]?.kind] || 0) || x.other - y.other)
}

/**
 * Clusters of PRs connected by code collisions (generated-only pairs excluded) and the generated
 * files several PRs touch.
 * @param {Array<object>} pairs from findCollisions
 * @returns {{ clusters: {prs:number[], pairs:object[], likely:boolean}[], generated: {path:string, prs:number[]}[] }}
 */
export function buildClusters(pairs) {
  const parent = new Map()
  const find = (x) => {
    while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x) }
    return x
  }
  const code = pairs.filter(p => !p.generatedOnly)
  for (const p of code) for (const n of [p.a, p.b]) if (!parent.has(n)) parent.set(n, n)
  for (const p of code) parent.set(find(p.a), find(p.b))
  const groups = new Map()
  for (const p of code) {
    const r = find(p.a)
    if (!groups.has(r)) groups.set(r, { prs: new Set(), pairs: [] })
    const g = groups.get(r)
    g.prs.add(p.a)
    g.prs.add(p.b)
    g.pairs.push(p)
  }
  const clusters = [...groups.values()]
    .map(g => ({ prs: [...g.prs].sort((x, y) => x - y), pairs: g.pairs, likely: g.pairs.some(p => p.likely) }))
    .sort((x, y) => y.prs.length - x.prs.length || x.prs[0] - y.prs[0])
  const gen = new Map()
  for (const p of pairs) {
    for (const path of p.generated) {
      if (!gen.has(path)) gen.set(path, new Set())
      gen.get(path).add(p.a)
      gen.get(path).add(p.b)
    }
  }
  const generated = [...gen.entries()]
    .map(([path, set]) => ({ path, prs: [...set].sort((x, y) => x - y) }))
    .sort((x, y) => x.path.localeCompare(y.path))
  return { clusters, generated }
}

const sizeOf = (pr) => ((Number(pr.additions) || 0) + (Number(pr.deletions) || 0))
  || (pr.files || []).reduce((n, f) => n + (f.additions || 0) + (f.deletions || 0), 0)
const names = (ns) => ns.map(n => `#${n}`).join(', ')

/**
 * Suggested merge order for the PRs that collide with others: fewest code overlaps first, then the
 * smaller diff, then the lower number (deterministic). Each step says why it sits there. PRs with no
 * collision are not ordered; they can land any time.
 * @param {Array<{number:number, isDraft?:boolean, additions?:number, deletions?:number, files?:Array}>} prs
 * @param {Array<object>} pairs from findCollisions
 * @returns {{ steps: {number:number, overlaps:number, size:number, serial:number[], affects:number[], reason:string}[], independent: number }}
 */
export function suggestMergeOrder(prs, pairs) {
  const info = new Map()
  const slot = (n) => { if (!info.has(n)) info.set(n, { overlaps: new Set(), serial: new Set() }); return info.get(n) }
  for (const p of pairs) {
    const x = slot(p.a)
    const y = slot(p.b)
    if (p.generated.length) { x.serial.add(p.b); y.serial.add(p.a) }
    if (!p.generatedOnly) { x.overlaps.add(p.b); y.overlaps.add(p.a) }
  }
  const byNum = new Map(prs.map(p => [p.number, p]))
  const rows = [...info.entries()].map(([number, v]) => {
    /** @type {any} */
    const pr = byNum.get(number) || {}
    const overlapsWith = [...v.overlaps].sort((a, b) => a - b)
    return { number, pr, overlapsWith, overlaps: overlapsWith.length, size: sizeOf(pr), serial: [...v.serial].sort((a, b) => a - b) }
  })
  rows.sort((a, b) => a.overlaps - b.overlaps || a.size - b.size || a.number - b.number)
  const position = new Map(rows.map((r, i) => [r.number, i]))
  const steps = rows.map((r, i) => {
    const later = r.overlapsWith.filter(n => position.get(n) > i)
    const earlier = r.overlapsWith.filter(n => position.get(n) < i)
    const parts = [
      r.overlaps === 0 ? 'no code overlap with other open PRs' : `${r.overlaps} code overlap${r.overlaps === 1 ? '' : 's'}`,
      `${r.size} changed line${r.size === 1 ? '' : 's'}`,
    ]
    if (later.length) parts.push(`if it lands first, ${names(later)} will probably need a re-sync`)
    if (earlier.length) parts.push(`${names(earlier)} land${earlier.length === 1 ? 's' : ''} before it, so expect to re-sync this one`)
    if (r.serial.length) parts.push(`shares generated files with ${names(r.serial)}: merge those one at a time`)
    if (r.pr.isDraft) parts.push('draft, not mergeable yet')
    return { number: r.number, overlaps: r.overlaps, size: r.size, serial: r.serial, affects: later, reason: parts.join('; ') }
  })
  return { steps, independent: Math.max(0, prs.length - rows.length) }
}
