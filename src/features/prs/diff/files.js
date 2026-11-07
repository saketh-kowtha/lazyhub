// @ts-nocheck
/**
 * src/features/prs/diff/files.js — per-file diff loading (#509).
 *
 * The changed-file list arrives first, by cursor, without patch text, so the tree and the
 * file headers render at once. A file's patch is fetched when the cursor is on it (and the
 * next few files are prefetched), parsed alone, and evicted again when the loaded patches
 * exceed a byte budget and the file is far from the cursor. Nothing is dropped silently:
 * a file that is not loaded yet, that GitHub will not render, or that failed to load stays
 * in the list with a note row.
 */

import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { useGh } from '../../../hooks/useGh.js'
import { listPRFilesPage, getPRFilePatch } from '../../../executor.js'
import { parseDiff } from '../diff-parser.js'

/** Upper bound on the patch text held in memory at once. */
export const PATCH_BUDGET_BYTES = 8 * 1024 * 1024
/** Files after the cursor that are loaded ahead of need. */
export const PREFETCH_FILES = 2

const NOTES = {
  loading: 'Loading this file…',
  omitted: 'GitHub does not render this file\'s diff (it is too large). Open the PR on GitHub to see it.',
  empty: 'No textual changes (binary file, mode change or rename).',
  missing: 'This file is no longer part of the pull request.',
}

/**
 * Parse one file's patch into the shape parseDiff produces.
 * @param {{path: string}} meta
 * @param {{patch: string, oldPath: string|null}} res
 */
function parseFilePatch(meta, res) {
  const old = res.oldPath || meta.path
  const [file] = parseDiff(`diff --git a/${old} b/${meta.path}\n--- a/${old}\n+++ b/${meta.path}\n${res.patch}`)
  if (!file) return null
  file.filename = meta.path
  return file
}

/**
 * @param {object} args
 * @param {string} args.repo
 * @param {number} args.prNumber
 * @param {number} [args.focusIndex] index (in the file list) of the file under the cursor
 * @param {number} [args.budgetBytes]
 */
export function usePRDiffFiles({ repo, prNumber, focusIndex = 0, budgetBytes = PATCH_BUDGET_BYTES }) {
  const { data: first, loading, error, refetch: refetchFirst, isStale } = useGh(listPRFilesPage, [repo, prNumber])

  // Later pages of the file list, by cursor. Page 1 is never requested again by this hook.
  const anchor = first ? `${first.endCursor}|${first.files[0]?.path}|${first.totalCount}` : null
  const scope = `${repo}#${prNumber}|${anchor}`
  const [more, setMore] = useState({ scope, files: [], cursor: null, hasNext: null, total: null, loading: false, error: null })
  const live = more.scope === scope ? more : { scope, files: [], cursor: null, hasNext: null, total: null, loading: false, error: null }
  const nextCursor = live.cursor ?? first?.endCursor ?? null
  const hasNext = live.hasNext ?? first?.hasNextPage ?? false
  const scopeRef = useRef(scope)
  scopeRef.current = scope

  useEffect(() => {
    if (!first || !hasNext || !nextCursor || live.loading || live.error) return
    const at = scope
    setMore(prev => ({ ...(prev.scope === at ? prev : { scope: at, files: [], cursor: null, hasNext: null, total: null }), loading: true, error: null }))
    listPRFilesPage(repo, prNumber, { after: nextCursor }).then(
      page => {
        if (scopeRef.current !== at) return
        setMore(prev => ({
          scope: at, files: [...(prev.scope === at ? prev.files : []), ...page.files],
          cursor: page.endCursor, hasNext: page.hasNextPage, total: page.totalCount, loading: false, error: null,
        }))
      },
      err => { if (scopeRef.current === at) setMore(prev => ({ ...prev, scope: at, loading: false, error: err })) },
    )
  }, [first, hasNext, nextCursor, live.loading, live.error, scope, repo, prNumber])

  const metas = useMemo(() => {
    const seen = new Set()
    return [...(first?.files || []), ...live.files].filter(f => !seen.has(f.path) && seen.add(f.path))
  }, [first, live.files])
  const totalFiles = live.total ?? first?.totalCount ?? metas.length

  // Patches: path -> { status, file?, bytes, error? }. A ref plus a tick, so a completed
  // load re-renders without copying the map.
  const patches = useRef(new Map())
  const [tick, setTick] = useState(0)
  const inFlight = useRef(null)
  const generation = useRef(0)
  useEffect(() => {
    generation.current += 1
    patches.current = new Map()
    inFlight.current = null
    setTick(t => t + 1)
  }, [scope])

  useEffect(() => {
    if (inFlight.current || metas.length === 0) return
    const wanted = [focusIndex, ...Array.from({ length: PREFETCH_FILES }, (_, i) => focusIndex + 1 + i), focusIndex - 1]
      .filter(i => i >= 0 && i < metas.length)
    const index = wanted.find(i => !patches.current.has(metas[i].path))
    if (index === undefined) return
    const meta = metas[index]
    const gen = generation.current
    inFlight.current = meta.path
    patches.current.set(meta.path, { status: 'loading', bytes: 0 })
    getPRFilePatch(repo, prNumber, meta.path, { indexHint: index }).then(
      res => {
        if (generation.current !== gen) return
        const file = res.status === 'ok' ? parseFilePatch(meta, res) : null
        patches.current.set(meta.path, file
          ? { status: 'ok', file, bytes: res.patch.length }
          : { status: res.status === 'ok' ? 'empty' : res.status, bytes: 0 })
      },
      err => {
        if (generation.current !== gen) return
        patches.current.set(meta.path, { status: 'error', bytes: 0, error: err?.message || String(err) })
      },
    ).finally(() => {
      if (generation.current !== gen) return
      inFlight.current = null
      // Evict the loaded files farthest from the cursor while over budget (never the window).
      let bytes = 0
      for (const e of patches.current.values()) bytes += e.bytes
      if (bytes > budgetBytes) {
        const keep = new Set(wanted.map(i => metas[i].path))
        const order = metas.map((m, i) => [m.path, Math.abs(i - focusIndex)]).sort((a, b) => b[1] - a[1])
        for (const [path] of order) {
          if (bytes <= budgetBytes) break
          const e = patches.current.get(path)
          if (!e || e.status !== 'ok' || keep.has(path)) continue
          bytes -= e.bytes
          patches.current.delete(path)
        }
      }
      setTick(t => t + 1)
    })
  }, [metas, focusIndex, tick, repo, prNumber, budgetBytes])

  const files = useMemo(() => metas.map(m => {
    const entry = patches.current.get(m.path)
    if (entry?.status === 'ok') return entry.file
    const note = entry?.status === 'error' ? `Could not load this file: ${entry.error}` : (NOTES[entry?.status] || NOTES.loading)
    return { header: `diff --git a/${m.path} b/${m.path}`, filename: m.path, addCount: m.additions, delCount: m.deletions, lines: [], note }
  }), [metas, tick]) // eslint-disable-line react-hooks/exhaustive-deps

  const stats = useMemo(() => ({
    additions: metas.reduce((n, m) => n + m.additions, 0),
    deletions: metas.reduce((n, m) => n + m.deletions, 0),
    changedFiles: totalFiles,
  }), [metas, totalFiles])

  let loadedFiles = 0
  for (const e of patches.current.values()) if (e.status !== 'loading') loadedFiles += 1

  const refetch = useCallback(() => {
    generation.current += 1
    patches.current = new Map()
    inFlight.current = null
    setMore({ scope: scopeRef.current, files: [], cursor: null, hasNext: null, total: null, loading: false, error: null })
    setTick(t => t + 1)
    refetchFirst()
  }, [refetchFirst])

  return {
    files, stats, totalFiles, loadedFiles,
    listComplete: !hasNext && !live.loading,
    listError: live.error,
    loading: loading && !first, error: first ? null : error, refreshError: first ? error : null,
    isStale, hasList: Boolean(first), refetch,
  }
}
