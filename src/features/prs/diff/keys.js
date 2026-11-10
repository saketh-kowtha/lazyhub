// @ts-nocheck
/**
 * src/features/prs/diff/keys.js — head-SHA-keyed immutable reads for the diff (V4b, #597).
 *
 * A PR's changed-file list and each file's patch cannot change while its head commit stays the
 * same, so they are cached under keys that carry the head SHA and are fresh for as long as the key
 * is unchanged (the `immutable` class, src/data/freshness.js). Reopening the diff of the same SHA
 * makes no gh call at all; a push changes the SHA, hence the key, and the new diff is fetched while
 * the old rows stay on screen.
 *
 * The SHA comes from the PR detail query (`getPR`, shared with the detail view) and, on a cold
 * open before that landed, from the file-list response itself (`headRefOid`): a read made without a
 * SHA lands under the `''` key (30 s) and seeds the key of the head it actually returned.
 *
 * GitHub cannot read "the files at SHA x", so a response is checked against the SHA it was keyed
 * by (`headRefOid` on the list, the commit in a file's `blob_url`). A response from a newer head is
 * never stored under the older key: the detail query is invalidated so the SHA moves on, and a
 * HeadMovedError tells the hook to keep what it shows meanwhile.
 */

import { queryClient, keyString } from '../../../data/queryClient.js'
import { ghQueryKey } from '../../../data/ghKeys.js'
import { listPRFilesPage, getPRFilePatch, getPR } from '../../../executor.js'

const SHA_RE = /^[0-9a-f]{40}$/

/** @param {unknown} s @returns {string|null} */
export function validSha(s) { return typeof s === 'string' && SHA_RE.test(s) ? s : null }

/** The PR head moved since the key was built; the detail query was invalidated to learn the new one. */
export class HeadMovedError extends Error {
  /**
   *
   * @param head
   */
  constructor(head) {
    super('The pull request was updated; loading the new diff')
    this.name = 'HeadMovedError'
    this.head = head
  }
}

const HINT_MAX = 200
/** @type {Map<string, string>} last head SHA a diff read returned, by `repo#number` (bounded). */
const hints = new Map()
const prKey = (repo, number) => `${String(repo).toLowerCase()}#${number}`

/**
 * @param {string} repo @param {number} number @param {string} sha
 * @param number
 * @param sha
 */
export function rememberHead(repo, number, sha) {
  const k = prKey(repo, number)
  hints.delete(k)
  hints.set(k, sha)
  if (hints.size > HINT_MAX) hints.delete(hints.keys().next().value)
}

/**
 * The head SHA a diff read last returned for this PR, or ''.
 * @param repo
 * @param number
 */
export function headHint(repo, number) { return hints.get(prKey(repo, number)) ?? '' }

/** Forget every hint (tests). */
export function resetHeadHints() { hints.clear() }

/**
 * The PR detail query key, the source of the head SHA.
 * @param repo
 * @param number
 */
export function prMetaKey(repo, number) { return ghQueryKey(getPR, [repo, number]) }

/**
 * The head SHA to key the diff by: the cached PR detail's, else the last one a diff read returned,
 * else '' (not known yet).
 * @param {string} repo
 * @param {number} number
 */
export function knownHead(repo, number) {
  return validSha(queryClient.getQueryData(prMetaKey(repo, number))?.headRefOid) ?? headHint(repo, number)
}

/**
 * Ask the detail query for the PR's current head (it revalidates if mounted, else on next show).
 * @param repo
 * @param number
 * @param head
 */
function headMoved(repo, number, head) {
  rememberHead(repo, number, head)
  queryClient.invalidate(prMetaKey(repo, number))
  return new HeadMovedError(head)
}

/**
 * Page 1 of the changed-file list, verified against `sha`. With no `sha` the page is returned
 * under the caller's key and also seeded under the key of the head it describes.
 * @param {string} repo
 * @param {number} number
 * @param {string} sha
 * @param {{ priority?: 'low' }} [opts]
 */
export async function fetchDiffFiles(repo, number, sha, opts) {
  const page = await listPRFilesPage(repo, number, opts)
  const head = validSha(page?.headRefOid)
  if (!head) return page
  rememberHead(repo, number, head)
  if (head === sha) return page
  queryClient.setQueryData(ghQueryKey(listPRDiffFiles, [repo, number, head]), page)
  if (!sha) return page
  throw headMoved(repo, number, head)
}

/**
 * Fetcher behind `useGh`: its name is part of the query key.
 * @param repo
 * @param number
 * @param sha
 */
export async function listPRDiffFiles(repo, number, sha) { return fetchDiffFiles(repo, number, sha) }

/**
 * A later page of the file list (by cursor), verified against `sha`.
 * @param repo
 * @param number
 * @param sha
 * @param cursor
 */
export async function listPRDiffFilesAfter(repo, number, sha, cursor) {
  const page = await listPRFilesPage(repo, number, { after: cursor })
  const head = validSha(page?.headRefOid)
  if (head && sha && head !== sha) throw headMoved(repo, number, head)
  return page
}

/**
 * One file's patch, verified against `sha`.
 * @param repo
 * @param number
 * @param sha
 * @param path
 * @param indexHint
 */
export async function getPRDiffPatch(repo, number, sha, path, indexHint) {
  const res = await getPRFilePatch(repo, number, path, { indexHint })
  const head = validSha(res?.headSha)
  if (head && sha && head !== sha) throw headMoved(repo, number, head)
  return res
}

/**
 * A cached immutable value (undefined when absent).
 * @param fn
 * @param deps
 */
export function readImmutable(fn, deps) { return queryClient.get(keyString(ghQueryKey(fn, deps)))?.data }

/**
 * Read an immutable key: the cached value with no gh call, else fetch it once (concurrent callers
 * share the request) and keep it for the life of the key. A value `keep` rejects is returned but
 * not kept.
 * @template T
 * @param {Function} fn  the named fetcher the key is built from
 * @param {any[]} deps
 * @param {() => Promise<T>} run
 * @param {(value: T) => boolean} [keep]
 * @returns {Promise<T>}
 */
export function fetchImmutable(fn, deps, run, keep = () => true) {
  const keyStr = keyString(ghQueryKey(fn, deps))
  const hit = queryClient.get(keyStr)
  if (hit) return Promise.resolve(hit.data)
  const { promise, release } = queryClient.fetch(keyStr, run)
  return promise.then(
    value => { release(); if (!keep(value)) queryClient.delete(keyStr); return value },
    err => { release(); throw err },
  )
}

/**
 * Drop the cached immutable values for these `[fn, deps]` pairs (a manual refresh).
 * @param pairs
 */
export function forgetImmutable(pairs) {
  for (const [fn, deps] of pairs) queryClient.delete(keyString(ghQueryKey(fn, deps)))
}
