/**
 * src/features/prs/author-candidates.js — suggestions for the `@` author filter (#563).
 *
 * Pure helpers: merge the authors of the loaded PR rows, the repository's collaborators
 * and the author filters used recently into one deduplicated list, rank it against what
 * the user typed (fuzzy, case-insensitive), and remember recent filters in the [state]
 * store the way merge methods are (#314).
 */

import { loadState, saveState } from '../../config.js'

/** Recent author filters kept per repository. */
export const RECENT_AUTHORS_MAX = 8

/** Lower rank wins when two candidates score the same: recent, then loaded rows, then collaborators. */
const SOURCE_RANK = { recent: 0, row: 1, collaborator: 2 }

/**
 * Score how well `query` matches `text`: 0 exact, 1 prefix, 2+ substring, 10+ subsequence,
 * null when it does not match at all. Case-insensitive.
 * @param {string} query
 * @param {string} text
 * @returns {number|null}
 */
export function fuzzyScore(query, text) {
  const q = String(query || '').toLowerCase()
  const s = String(text || '').toLowerCase()
  if (!q) return 0
  if (s === q) return 0
  if (s.startsWith(q)) return 1
  const at = s.indexOf(q)
  if (at >= 0) return 2 + at / 100
  let from = 0
  let first = -1
  let last = -1
  for (const ch of q) {
    const i = s.indexOf(ch, from)
    if (i < 0) return null
    if (first < 0) first = i
    last = i
    from = i + 1
  }
  return 10 + (last - first) / 100
}

/**
 * @typedef {object} AuthorCandidate
 * @property {string} login
 * @property {string} name        display name, '' when unknown
 * @property {string[]} sources   any of 'recent', 'row', 'collaborator'
 */

/**
 * Merge the three sources into one list, one entry per login (case-insensitive).
 * @param {{rows?: Array<{author?: {login?: string}|null}>, collaborators?: Array<{login?: string, name?: string}>|null, recent?: string[]}} input
 * @returns {AuthorCandidate[]}
 */
export function buildAuthorCandidates({ rows = [], collaborators = [], recent = [] }) {
  /** @type {Map<string, AuthorCandidate>} */
  const byLogin = new Map()
  const add = (login, source, name = '') => {
    const clean = String(login || '').trim()
    if (!clean) return
    const key = clean.toLowerCase()
    const found = byLogin.get(key)
    if (found) {
      if (!found.sources.includes(source)) found.sources.push(source)
      if (!found.name && name) found.name = name
      return
    }
    byLogin.set(key, { login: clean, name: name || '', sources: [source] })
  }
  for (const login of recent) add(login, 'recent')
  for (const row of rows) add(row?.author?.login, 'row')
  if (Array.isArray(collaborators)) for (const c of collaborators) add(c?.login, 'collaborator', c?.name || '')
  const out = [...byLogin.values()]
  for (const c of out) c.sources.sort((a, b) => SOURCE_RANK[a] - SOURCE_RANK[b])
  return out
}

/**
 * Filter and rank candidates against the typed text. An empty query keeps source order.
 * @param {AuthorCandidate[]} candidates
 * @param {string} query
 * @returns {AuthorCandidate[]}
 */
export function rankAuthors(candidates, query) {
  const q = String(query || '').trim().replace(/^@/, '')
  const scored = []
  candidates.forEach((candidate, index) => {
    const byLogin = fuzzyScore(q, candidate.login)
    const byName = candidate.name ? fuzzyScore(q, candidate.name) : null
    const score = byLogin !== null ? byLogin : byName !== null ? byName + 0.5 : null
    if (score === null) return
    scored.push({ candidate, score, rank: SOURCE_RANK[candidate.sources[0]], index })
  })
  scored.sort((a, b) => a.score - b.score || a.rank - b.rank || a.index - b.index)
  return scored.map(s => s.candidate)
}

/**
 * Author filters used recently in a repository, most recent first.
 * @param {string} [repo]  owner/name
 * @returns {string[]}
 */
export function loadRecentAuthors(repo) {
  const list = repo ? loadState().recentAuthors?.[repo] : undefined
  return Array.isArray(list) ? list.filter(x => typeof x === 'string' && x) : []
}

/**
 * Remember an applied author filter for a repository (most recent first, deduplicated, capped).
 * @param {string} repo  owner/name
 * @param {string} login
 */
export function rememberAuthor(repo, login) {
  const clean = String(login || '').trim()
  if (!repo || !clean) return
  const previous = loadState().recentAuthors
  const book = previous && typeof previous === 'object' ? previous : {}
  const kept = (Array.isArray(book[repo]) ? book[repo] : []).filter(x => String(x).toLowerCase() !== clean.toLowerCase())
  saveState({ recentAuthors: { ...book, [repo]: [clean, ...kept].slice(0, RECENT_AUTHORS_MAX) } })
}
