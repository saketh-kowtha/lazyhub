/**
 * ci-blame.js — pure matching of failure locations from a CI log to the lines a
 * PR changed (issue #359, "Why is CI red?", step 2). No I/O, no React, no AI.
 *
 * Input locations come from ci-log.js `extractLocations` (already redacted and
 * capped). A location is matched to a changed file by path, then to a changed
 * line by the PR's patch. The rule is "nothing rather than a wrong match":
 *  - a log path matches a PR file only on whole path segments, never on a
 *    partial name (`b.js` does not match `ab.js`);
 *  - when two different PR files match equally well the location is left
 *    unmatched and counted as ambiguous;
 *  - a match made only because the log path is a shorter suffix of the PR path
 *    (monorepo sub-directory) is marked `suffix`, so the view can say so;
 *  - a changed file whose line did not change is reported as `file`, never as
 *    a changed line.
 */

import { parseDiff } from './diff-parser.js'

/** Lines either side of a failing line that still count as "near" a change. */
export const NEAR_LINES = 3
export const MAX_MATCHES = 8

/**
 * Forward-slash path without drive letter, `./` prefix or trailing noise.
 *
 * @param {string} p
 * @returns {{path: string, windows: boolean}}
 */
export function normalizePath(p) {
  let s = String(p || '').replace(/\\/g, '/')
  const windows = /^[A-Za-z]:\//.test(s)
  s = s.replace(/^[A-Za-z]:\//, '/').replace(/^(?:\.\/)+/, '').replace(/\/{2,}/g, '/')
  return { path: s, windows }
}

/**
 * @typedef {{path: string, previousPath?: string|null, status?: string}} ChangedFile
 * @typedef {{path: string, line: number, col?: number|null}} Location
 * @typedef {{location: Location, file: ChangedFile, via: 'exact'|'suffix'|'rename'}} FileMatch
 */

/**
 * Which PR file does a log path point at? Whole-segment suffix match in either
 * direction (the runner prints absolute paths; a sub-directory build prints
 * shorter ones). The longest agreement wins; a tie between files is ambiguous.
 *
 * @param {string} logPath
 * @param {ChangedFile[]} files
 * @returns {{file: ChangedFile, via: 'exact'|'suffix'|'rename'}|{ambiguous: true}|null}
 */
export function matchPath(logPath, files) {
  const { path: raw, windows } = normalizePath(logPath)
  if (!raw) return null
  const fold = (/** @type {string} */ s) => (windows ? s.toLowerCase() : s)
  const lp = fold(raw.replace(/^\//, ''))
  /** @type {{file: ChangedFile, len: number, via: 'exact'|'suffix'|'rename'}[]} */
  const hits = []
  for (const file of files) {
    for (const [cand, isOld] of /** @type {[string|null|undefined, boolean][]} */ ([[file.path, false], [file.previousPath, true]])) {
      if (!cand) continue
      const fp = fold(normalizePath(cand).path.replace(/^\//, ''))
      if (!fp) continue
      if (lp === fp || lp.endsWith(`/${fp}`)) hits.push({ file, len: fp.length, via: isOld ? 'rename' : 'exact' })
      // The log path is shorter than the repo path: only with 2+ segments, so `index.js` alone never matches.
      else if (fp.endsWith(`/${lp}`) && lp.includes('/')) hits.push({ file, len: lp.length, via: 'suffix' })
    }
  }
  if (hits.length === 0) return null
  const best = Math.max(...hits.map(h => h.len))
  const top = hits.filter(h => h.len === best)
  const distinct = new Set(top.map(h => h.file.path))
  if (distinct.size > 1) return { ambiguous: true }
  return { file: top[0].file, via: top[0].via }
}

/**
 * Map log locations to changed files. Order of the input is kept.
 *
 * @param {Location[]} locations
 * @param {ChangedFile[]} files
 * @returns {{matches: FileMatch[], unmatched: Location[], ambiguous: Location[]}}
 */
export function matchLocationsToFiles(locations, files) {
  /** @type {FileMatch[]} */
  const matches = []
  /** @type {Location[]} */
  const unmatched = []
  /** @type {Location[]} */
  const ambiguous = []
  for (const location of locations || []) {
    const hit = matchPath(location.path, files || [])
    if (!hit) unmatched.push(location)
    else if ('ambiguous' in hit) ambiguous.push(location)
    else matches.push({ location, file: hit.file, via: hit.via })
  }
  return { matches, unmatched, ambiguous }
}

/**
 * Where does `line` (new-file numbering) sit in a PR patch?
 *
 *  - `changed`: the line itself was added or modified by the PR
 *  - `near`: an added line within NEAR_LINES; `line` is that added line
 *  - `file`: the file changed but not at or near that line
 *
 * @param {string} patch   the file's patch (REST `patch`: hunks without a `diff --git` header)
 * @param {string} path
 * @param {number} line
 * @returns {{kind: 'changed'|'near'|'file', line: number, text: string}}
 */
export function locateInPatch(patch, path, line) {
  const body = String(patch || '')
  const text = /^diff --git /.test(body) ? body : `diff --git a/${path} b/${path}\n${body}`
  const added = []
  for (const f of parseDiff(text)) for (const l of f.lines) if (l.type === 'add' && l.newLine != null) added.push(l)
  const exact = added.find(l => l.newLine === line)
  if (exact) return { kind: 'changed', line, text: exact.text }
  let nearest = null
  for (const l of added) {
    const d = Math.abs(/** @type {number} */ (l.newLine) - line)
    if (d <= NEAR_LINES && (!nearest || d < nearest.d)) nearest = { d, l }
  }
  if (nearest) return { kind: 'near', line: /** @type {number} */ (nearest.l.newLine), text: nearest.l.text }
  return { kind: 'file', line, text: '' }
}

/**
 * @typedef {object} ChangedLineMatch
 * @property {string} path        PR file path
 * @property {number} line        the changed line (or the failing line for `file` / `no-patch`)
 * @property {number} failLine    the line the log pointed at
 * @property {'changed'|'near'|'file'|'no-patch'} kind
 * @property {'exact'|'suffix'|'rename'} via
 * @property {string} text        code of the changed line, empty unless changed/near
 */

/**
 * Full match: log locations x PR files x patches.
 *
 * @param {Location[]} locations
 * @param {ChangedFile[]} files
 * @param {Map<string, {status: string, patch: string|null}>|Record<string, {status: string, patch: string|null}>} patches  by PR file path
 * @returns {{items: ChangedLineMatch[], unmatched: number, ambiguous: number, capped: boolean}}
 */
export function matchChangedLines(locations, files, patches) {
  const get = (/** @type {string} */ p) => (patches instanceof Map ? patches.get(p) : patches?.[p])
  const { matches, unmatched, ambiguous } = matchLocationsToFiles(locations, files)
  /** @type {ChangedLineMatch[]} */
  const items = []
  const seen = new Set()
  for (const m of matches) {
    const p = get(m.file.path)
    /** @type {ChangedLineMatch} */
    let item
    if (!p || p.status !== 'ok' || !p.patch) {
      item = { path: m.file.path, line: m.location.line, failLine: m.location.line, kind: 'no-patch', via: m.via, text: '' }
    } else {
      const at = locateInPatch(p.patch, m.file.path, m.location.line)
      item = { path: m.file.path, line: at.line, failLine: m.location.line, kind: at.kind, via: m.via, text: at.text }
    }
    const key = `${item.path}:${item.line}:${item.kind}`
    if (seen.has(key)) continue
    seen.add(key)
    items.push(item)
  }
  const rank = { changed: 0, near: 1, file: 2, 'no-patch': 3 }
  items.sort((a, b) => rank[a.kind] - rank[b.kind])
  return { items: items.slice(0, MAX_MATCHES), unmatched: unmatched.length, ambiguous: ambiguous.length, capped: items.length > MAX_MATCHES }
}
