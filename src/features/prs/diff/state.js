// @ts-nocheck
/**
 * src/features/prs/diff/state.js — diff loading, navigation, overlays, and action callbacks.
 */

import { logSwallowed } from '../../../contain.js'
import { useState, useMemo, useEffect, useRef, useCallback } from 'react'
import { openUrl } from '../../../services/platform.js'
import { useStdout } from 'ink'
import { useActionResolver, useKeymapInput } from '../../../config/keymap.js'
import { useGh } from '../../../hooks/useGh.js'
import { getPRDiff, listPRCommentsPage, addPRLineComment, replyToComment, editPRComment, deletePRComment, mergePR, getRepoInfo, reviewPR } from '../../../executor.js'
import { contextFooterHints } from '../../../ui/actions.js'
import { usePendingWrite } from '../../../hooks/usePendingWrite.js'
import { getAICodeReview, AIError } from '../../../ai/index.js'
import { loadConfig } from '../../../config.js'
import { useKeyScope } from '../../../keyscope.js'
import { sanitize } from '../../../utils.js'
import { flattenFiles } from '../diff-parser.js'
import { usePRDiffFiles } from './files.js'
import { rememberMergeMethod } from '../merge-methods.js'
import { openInEditor } from '../../../editor.js'
import { getLang } from './highlight.js'
import { buildTreeRows } from './tree.js'
import { openEditorSync } from './editor.js'

const _cfg = loadConfig()
const _diffCfg = _cfg.diff
const _editorCfg = _cfg.editor

/** Own the diff session, keyboard routing, and mutation lifecycle.
 * @param {object} props
 * @param {number} props.prNumber
 * @param {string} props.repo
 * @param {Function} props.onBack
 * @param {Function} props.onViewComments
 */
export function useDiffState({ prNumber, repo, onBack, onViewComments }) {
  useKeyScope('view')
  const { stdout } = useStdout()
  const visibleHeight = Math.max(5, (stdout?.rows || 24) - 6)

  // The file list (paths and counts, no patch text) is fetched first and alone so it never queues
  // behind secondary calls on the gh concurrency cap (#451); everything else loads after it lands.
  // File patches then load one at a time around the cursor (#509): no all-or-nothing size gate.
  const [focusFile, setFocusFile] = useState(0)
  const diffFiles = usePRDiffFiles({ repo, prNumber, focusIndex: focusFile })
  const { files, stats: diffStats, mode, refetch, isStale: diffStale } = diffFiles
  const error = diffFiles.error || diffFiles.refreshError
  // Fetched this visit (not merely cached): secondary calls must not race the revalidation.
  const hasDiff = diffFiles.hasList
  const diffReady = hasDiff && (!diffStale || Boolean(error))
  // Stale data on screen + failed revalidation: keep the diff, surface a banner instead of an error screen.
  const diffRefreshError = diffFiles.refreshError
  const diffError = diffFiles.error

  // The PR detail is read by the file hook (it carries the head SHA the diff is keyed by).
  const prMeta = diffFiles.prMeta
  const { data: repoInfo } = useGh(getRepoInfo, [repo], { ttl: 300_000, enabled: diffReady })
  const headRefOid = /^[0-9a-f]{40}$/.test(prMeta?.headRefOid) ? prMeta.headRefOid : null
  const { data: commentsPage, refetch: refetchComments, mutate: mutatePage } = useGh(listPRCommentsPage, [repo, prNumber], { enabled: diffReady })
  const comments = commentsPage?.comments
  // `truncated` rides in the payload next to the list, so an edit of the list keeps it.
  const mutateComments = useCallback((fn) => mutatePage(prev => ({ truncated: false, ...prev, comments: fn(prev?.comments || []) })), [mutatePage])
  const [cursor, setCursor] = useState(0)
  const [scrollOffset, setScrollOffset] = useState(0)
  const [dialog, setDialog] = useState(null)
  const [mergeChoice, setMergeChoice] = useState(null) // { strategy, msg } awaiting the merge confirm
  const [compose, setCompose] = useState(null)
  // compose types:
  //   new comment: { mode: 'new', commentType, body }
  //   reply:       { mode: 'reply', rootCommentId, body }
  //   edit:        { mode: 'edit', commentId, body }
  //   delete:      { mode: 'delete', commentId, commentBody }
  const COMMENT_TYPES = ['comment', 'suggestion', 'request-changes']
  const [commentStatus, setCommentStatus] = useState(null)
  // One status timer: a new message cancels the previous timeout, so a stale timeout
  // can never clear a later (or sticky pending) message.
  const statusTimer = useRef(null)
  useEffect(() => () => { clearTimeout(statusTimer.current) }, [])
  const flash = (msg, ms = 0) => {
    clearTimeout(statusTimer.current)
    setCommentStatus(msg)
    if (ms) statusTimer.current = setTimeout(() => setCommentStatus(null), ms)
  }
  const { run: pendingRun } = usePendingWrite((msg) => flash(msg))
  // Resolves true only when fn actually ran (false when ignored as a double submit).
  const runWrite = async (label, fn) => {
    let ran = false
    await pendingRun(label, async () => { ran = true; return fn() })
    return ran
  }
  const [splitView, setSplitView] = useState(_diffCfg.defaultView === 'split')
  const resolveAction = useActionResolver(['global', 'diff'])
  const footerKeys = useMemo(
    () => contextFooterHints('prs', 'diff').map(h => (h.label === 'split' && splitView ? { ...h, label: 'unified' } : h)),
    [splitView],
  )
  const resolveConfirm = useActionResolver(['dialog'])

  // Feature: file tree view
  const [showTree, setShowTree] = useState(false)
  const [treeCursor, setTreeCursor] = useState(0)

  // Feature: find/search
  const [findQuery, setFindQuery] = useState('')
  const [findActive, setFindActive] = useState(false)

  // Feature: go-to-line
  const [gotoActive, setGotoActive] = useState(false)
  const [gotoInput, setGotoInput] = useState('')

  // Feature: file jump fuzzy search
  const [fileJumpActive, setFileJumpActive] = useState(false)

  // Feature: AI inline code review
  const [aiReview, setAiReview]               = useState(null)
  const [aiReviewLoading, setAiReviewLoading] = useState(false)
  const [aiReviewError, setAiReviewError]     = useState(null)
  const [aiPostStatus, setAiPostStatus]       = useState(null)

  // Suppress global 1-9 tab key handler when any overlay is active
  useKeyScope('dialog', !!(gotoActive || findActive || compose || showTree || dialog || fileJumpActive || aiReview || aiReviewLoading))

  // Cleanup transient input states on unmount so they don't bleed into re-mounts
  useEffect(() => () => {
    setFindActive(false)
    setFindQuery('')
    setGotoActive(false)
    setGotoInput('')
    setCompose(null)
  }, [])

  const rows  = useMemo(() => flattenFiles(files), [files])

  // filename → language, computed once per diff fetch
  const langCache = useMemo(() => {
    const map = new Map()
    for (const f of files) map.set(f.filename, getLang(f.filename))
    return map
  }, [files])

  const fileStartIndices = useMemo(() =>
    rows.reduce((acc, row, i) => { if (row.type === 'file-header') acc.push(i); return acc }, [])
  , [rows])

  // The file under the cursor decides which patches load (this one and the next few).
  useEffect(() => {
    let index = 0
    for (let i = 0; i < fileStartIndices.length && fileStartIndices[i] <= cursor; i += 1) index = i
    setFocusFile(prev => (prev === index ? prev : index))
  }, [cursor, fileStartIndices])

  // A patch arriving above the cursor changes how many rows precede it; keep the cursor on the
  // same line of the same file instead of letting the view slide.
  const prevLayout = useRef({ starts: fileStartIndices, files, rows })
  useEffect(() => {
    const prev = prevLayout.current
    prevLayout.current = { starts: fileStartIndices, files, rows }
    if (prev.rows === rows) return
    let fi = 0
    for (let i = 0; i < prev.starts.length && prev.starts[i] <= cursor; i += 1) fi = i
    const name = prev.files[fi]?.filename
    const ni = name == null ? -1 : files.findIndex(f => f.filename === name)
    if (ni < 0) return
    const newStart = fileStartIndices[ni]
    const length = (fileStartIndices[ni + 1] ?? rows.length) - newStart
    const next = newStart + Math.min(cursor - prev.starts[fi], Math.max(0, length - 1))
    if (next !== cursor) {
      const delta = next - cursor
      setCursor(next)
      setScrollOffset(o => Math.max(0, o + delta))
    }
  }, [rows]) // eslint-disable-line react-hooks/exhaustive-deps

  // File tree rows
  const treeRows = useMemo(() => buildTreeRows(files), [files])

  const commentsByLine = useMemo(() => {
    const map = new Map()
    for (const c of (comments || [])) {
      const line = c.line || c.originalLine
      const key = `${c.path}:${line}`
      if (!map.has(key)) map.set(key, [])
      map.get(key).push(c)
    }
    return map
  }, [comments])

  const commentThreadIndices = useMemo(() =>
    rows.reduce((acc, row, i) => {
      const lineNum = row.newLine ?? row.oldLine
      if (row.filename && lineNum != null && commentsByLine.has(`${row.filename}:${lineNum}`))
        acc.push(i)
      return acc
    }, [])
  , [rows, commentsByLine])

  // Find matches
  const findMatches = useMemo(() => {
    if (!findQuery) return []
    const q = findQuery.toLowerCase()
    return rows.reduce((acc, row, i) => {
      if (row.type !== 'file-header' && row.type !== 'file-note' && row.type !== 'hunk' && row.text?.toLowerCase().includes(q))
        acc.push(i)
      return acc
    }, [])
  }, [rows, findQuery])

  const moveCursor = (delta) => {
    setCursor(prev => {
      const next = Math.max(0, Math.min(rows.length - 1, prev + delta))
      if (next < scrollOffset) setScrollOffset(next)
      if (next >= scrollOffset + visibleHeight) setScrollOffset(next - visibleHeight + 1)
      return next
    })
  }

  const jumpTo = (idx) => {
    const n = Math.max(0, Math.min(rows.length - 1, idx))
    setCursor(n)
    setScrollOffset(Math.max(0, n - Math.floor(visibleHeight / 2)))
  }

  const jumpToMatch = (dir) => {
    if (!findMatches.length) return
    if (dir === 'next') {
      const next = findMatches.find(i => i > cursor) ?? findMatches[0]
      jumpTo(next)
    } else {
      const prev = [...findMatches].reverse().find(i => i < cursor) ?? findMatches[findMatches.length - 1]
      jumpTo(prev)
    }
  }

  const openFilesInBrowser = () => {
    // prMeta.url comes from the GitHub API and already reflects the
    // correct host (github.com or a GHES instance). Fall back to a
    // GH_HOST-aware constructed URL if prMeta hasn't loaded yet.
    const baseUrl = prMeta?.url
      || `https://${process.env.GH_HOST || 'github.com'}/${repo}/pull/${prNumber}`
    openUrl(`${baseUrl}/files`)
  }

  useKeymapInput((input, key) => {
    const id = resolveAction(input, key)

    // findActive — handled by TextInput, here we only handle exit keys
    if (findActive) {
      if (key.escape) {
        setFindActive(false)
        setFindQuery('')
        return
      }
      if (key.return) {
        setFindActive(false)
        if (findMatches.length > 0) jumpTo(findMatches[0])
        return
      }
      return
    }

    // gotoActive — handled by TextInput
    if (gotoActive) {
      if (key.escape) { setGotoActive(false); setGotoInput(''); return }
      if (key.return) {
        const lineNum = parseInt(gotoInput, 10)
        if (!isNaN(lineNum)) {
          const idx = rows.findIndex(r => r.newLine === lineNum || r.oldLine === lineNum)
          if (idx >= 0) jumpTo(idx)
        }
        setGotoActive(false)
        setGotoInput('')
        return
      }
      return
    }

    // fileJumpActive — captured by FuzzySearch component (dialog)
    if (fileJumpActive) return

    // aiReview overlay — captured by AIReviewPane component
    if (aiReview) return

    // showTree — capture j/k/Enter/Esc/t
    if (showTree) {
      if (key.escape || id === 'diff.tree') {
        setShowTree(false)
        return
      }
      if (id === 'cursor.down') {
        setTreeCursor(prev => Math.min(treeRows.length - 1, prev + 1))
        return
      }
      if (id === 'cursor.up') {
        setTreeCursor(prev => Math.max(0, prev - 1))
        return
      }
      if (key.return) {
        const treeRow = treeRows[treeCursor]
        if (treeRow && treeRow.type === 'file') {
          // Jump diff cursor to the file's first row
          const fileIdx = fileStartIndices[files.findIndex(f => f.filename === treeRow.filename)]
          setShowTree(false)
          if (fileIdx != null) jumpTo(fileIdx)
        }
        return
      }
      return
    }

    // Inline compose keyboard handling
    if (compose) {
      if (key.escape) { setCompose(null); return }

      // delete confirm
      if (compose.mode === 'delete') {
        const confirm = resolveConfirm(input, key)
        if (confirm === 'dialog.yes') {
          const deleteId = compose.commentId
          runWrite('Deleting comment', () => {
            mutateComments(prev => (prev || []).filter(c => c.id !== deleteId))
            return deletePRComment(repo, deleteId)
          })
            .then(ran => { if (ran) flash('Deleted', 3000) })
            .catch(err => {
              refetchComments()
              flash(`Failed: ${err.message}`, 3000)
            })
          // The confirm closes either way; an ignored run already announced "still in progress".
          setCompose(null)
        } else if (confirm === 'dialog.no') {
          setCompose(null)
        }
        return
      }

      // comment type picker (new comment only) — Tab cycles, not arrows (arrows move text cursor)
      if (compose.mode === 'new' && key.tab) {
        const idx = COMMENT_TYPES.indexOf(compose.commentType)
        setCompose(c => ({ ...c, commentType: COMMENT_TYPES[(idx + 1) % COMMENT_TYPES.length] }))
        return
      }

      if ((key.ctrl && key.return) || resolveConfirm(input, key) === 'dialog.submit') {
        const body = compose.body.trim()
        if (compose.mode === 'new') {
          const row = rows[cursor]
          if (body && row) {
            if (!headRefOid) {
              setCommentStatus('PR metadata still loading — please retry')
              setTimeout(() => setCommentStatus(null), 3000)
              setCompose(null)
              return
            }
            const optimisticId = `optimistic-${Date.now()}`
            const optimisticComment = {
              id: optimisticId, body, path: row.filename,
              line: row.newLine || row.oldLine,
              side: row.type === 'del' ? 'LEFT' : 'RIGHT',
              createdAt: new Date().toISOString(), pending: true,
              user: { login: '…' }, inReplyToId: null,
            }
            runWrite('Posting comment', () => {
              mutateComments(prev => [...(prev || []), optimisticComment])
              setCompose(null)
              return addPRLineComment(repo, prNumber, {
                body, path: row.filename,
                line: row.newLine || row.oldLine,
                side: row.type === 'del' ? 'LEFT' : 'RIGHT',
                commitId: headRefOid,
              })
            }).then(ran => {
              if (!ran) return
              flash('Comment added', 3000)
              refetchComments()
            }).catch(err => {
              mutateComments(prev => (prev || []).filter(c => c.id !== optimisticId))
              flash(`Failed: ${err.message}`, 3000)
            })
          }
        } else if (compose.mode === 'reply') {
          if (body) {
            runWrite('Sending reply', () => {
              setCompose(null)
              return replyToComment(repo, prNumber, compose.rootCommentId, body)
            })
              .then(ran => { if (ran) { flash('Reply sent', 3000); refetchComments() } })
              .catch(err => flash(`Failed: ${err.message}`, 3000))
          } else {
            setCompose(null)
          }
          return
        } else if (compose.mode === 'edit') {
          if (body) {
            const editId = compose.commentId
            runWrite('Updating comment', () => {
              mutateComments(prev => (prev || []).map(c => c.id === editId ? { ...c, body } : c))
              setCompose(null)
              return editPRComment(repo, editId, body)
            })
              .then(ran => { if (ran) flash('Comment updated', 3000) })
              .catch(err => {
                refetchComments()
                flash(`Failed: ${err.message}`, 3000)
              })
          } else {
            setCompose(null)
          }
          return
        }
        setCompose(null)
        return
      }
      // Ctrl+E opens editor — bare 'e' is a normal character handled by TextInput
      if (resolveConfirm(input, key) === 'dialog.editor' && compose.mode !== 'delete') {
        const edited = openEditorSync(compose.body)
        setCompose(c => ({ ...c, body: edited }))
        return
      }
      return
    }

    if (dialog) return

    if (id === 'pr.merge' && prMeta?.state === 'OPEN') {
      // The picker is built from repoInfo (allowed methods, admin rights): never open it before that loads.
      if (!repoInfo) { flash('Loading repository settings… try again in a moment', 3000); return }
      setDialog('merge'); return
    }
    if (id === 'pr.approve' && prMeta?.state === 'OPEN') { setDialog('approve-body'); return }
    if (id === 'pr.request-changes' && prMeta?.state === 'OPEN') { setDialog('reqchanges-body'); return }

    // open current file at current line in editor
    if (id === 'pr.open-editor') {
      const row = rows[cursor]
      if (row?.filename) {
        const line = row.newLine || row.oldLine || 1
        openInEditor(row.filename, line, _editorCfg).catch(err => logSwallowed('prs.diff.open-editor', err))
      }
      return
    }

    if (id === 'pr.open-browser') { openFilesInBrowser(); return }
    if (id === 'diff.file-jump') { setFileJumpActive(true); return }
    if (id === 'list.refresh') { refetch(); return }

    if (id === 'cursor.top') { jumpTo(0); return }
    if (id === 'cursor.bottom') { jumpTo(rows.length - 1); return }
    // Esc: clear find query first, then go back on second Esc
    if (key.escape && findQuery) { setFindQuery(''); return }
    if (id === 'app.back') { onBack(); return }
    if (id === 'pr.comments') { onViewComments(); return }
    if (id === 'cursor.down') { moveCursor(1);  return }
    if (id === 'cursor.up')   { moveCursor(-1); return }

    if (id === 'diff.next-file') {
      const next = fileStartIndices.find(i => i > cursor)
      if (next != null) jumpTo(next)
      return
    }
    if (id === 'diff.prev-file') {
      const prev = [...fileStartIndices].reverse().find(i => i < cursor)
      if (prev != null) jumpTo(prev)
      return
    }

    // next/prev comment thread
    if (id === 'diff.next-thread') {
      const next = commentThreadIndices.find(i => i > cursor)
      if (next != null) jumpTo(next)
      return
    }
    if (id === 'diff.prev-thread') {
      const prev = [...commentThreadIndices].reverse().find(i => i < cursor)
      if (prev != null) jumpTo(prev)
      return
    }
    // next/prev search match
    if (id === 'diff.find-next') { if (findQuery && findMatches.length > 0) jumpToMatch('next'); return }
    if (id === 'diff.find-prev') { if (findQuery && findMatches.length > 0) jumpToMatch('prev'); return }

    if (id === 'diff.split') { setSplitView(v => !v); return }

    // toggle file tree
    if (id === 'diff.tree') {
      setShowTree(v => !v)
      setTreeCursor(0)
      return
    }

    // open find (only when not in compose/tree/findActive)
    if (id === 'list.search') {
      setFindActive(true)
      return
    }

    if (id === 'diff.goto-line') { setGotoActive(true); setGotoInput(''); return }

    // comment / reply / edit / delete act on the thread at the cursor line
    if (id === 'diff.comment' || id === 'diff.edit-comment' || id === 'diff.delete-comment') {
      const row = rows[cursor]
      const isCodeRow = row && row.type !== 'file-header' && row.type !== 'file-note' && row.filename
      const lineNum = isCodeRow ? (row.newLine ?? row.oldLine) : null
      const lineKey = lineNum != null ? `${row.filename}:${lineNum}` : null
      const lineComments = lineKey ? commentsByLine.get(lineKey) : null
      const sorted = lineComments?.length
        ? [...lineComments].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))
        : []
      const lastComment = sorted[sorted.length - 1]
      if (id === 'diff.comment') {
        const rootId = sorted.filter(c => !c.inReplyToId)[0]?.id
        if (rootId) setCompose({ mode: 'reply', rootCommentId: rootId, body: '' })
        else if (row && row.type !== 'file-header' && row.type !== 'file-note') setCompose({ mode: 'new', commentType: 'comment', body: '' })
      } else if (lastComment && id === 'diff.edit-comment') {
        setCompose({ mode: 'edit', commentId: lastComment.id, body: lastComment.body || '' })
      } else if (lastComment) {
        setCompose({ mode: 'delete', commentId: lastComment.id, commentBody: lastComment.body || '' })
      }
      return
    }

    // trigger AI code review
    if (id === 'diff.ai-review') {
      if (aiReviewLoading) return
      const config = loadConfig()
      if (config.aiReviewEnabled === false) {
        setAiReviewError('AI Code Review is disabled in Settings (,)')
        setTimeout(() => setAiReviewError(null), 3000)
        return
      }
      setAiReviewLoading(true)
      setAiReviewError(null)
      // The review needs the whole diff, so fetch it now (the pane itself only holds the files in view).
      getPRDiff(repo, prNumber).then(diffText => getAICodeReview({
        diff:     diffText || '',
        prTitle:  sanitize(prMeta?.title || `PR #${prNumber}`),
        prBody:   sanitize((prMeta?.body || '').slice(0, 500)),
        authorHint: prMeta?.author?.login,
      }))
        .then(result => { setAiReview(result) })
        .catch(err => {
          setAiReviewError(err instanceof AIError ? err.message : 'AI review failed')
          setTimeout(() => setAiReviewError(null), 5000)
        })
        .finally(() => setAiReviewLoading(false))
      return
    }
  })

  const handleAiJumpTo = (file, line) => {
    if (!file) return
    const idx = line != null
      ? rows.findIndex(r => r.filename === file && (r.newLine === line || r.oldLine === line))
      : rows.findIndex(r => r.filename === file)
    if (idx >= 0) jumpTo(idx)
  }

  // handleAiPost accepts an optional custom body (edited by the user in the
  // interactive review flow). Falls back to suggestion.comment if not provided.
  const handleAiPost = (suggestion, customBody) => {
    const body = (typeof customBody === 'string' && customBody.trim())
      ? customBody.trim()
      : suggestion.comment

    if (!headRefOid) {
      setAiPostStatus('error: PR metadata not loaded')
      setTimeout(() => setAiPostStatus(null), 4000)
      return
    }
    if (!suggestion?.line) {
      setAiPostStatus('error: no line number for this suggestion')
      setTimeout(() => setAiPostStatus(null), 3000)
      return
    }
    setAiPostStatus('posting...')
    runWrite('Posting AI comment', () => addPRLineComment(repo, prNumber, {
      body,
      path:     suggestion.file,
      line:     suggestion.line,
      side:     'RIGHT',
      commitId: headRefOid,
    }))
      .then(ran => {
        if (!ran) { setAiPostStatus(null); return }
        setAiPostStatus('posted')
        refetch()
        setTimeout(() => setAiPostStatus(null), 2000)
      })
      .catch(err => {
        setAiPostStatus(`error: ${err.message}`)
        setTimeout(() => setAiPostStatus(null), 5000)
      })
  }

  // Choosing a method never merges by itself: a confirm (default No; an admin bypass also needs the PR
  // number typed) always follows, then the write runs through runWrite as before.
  const submitMerge = (val) => {
    const strategy = typeof val === 'object' ? val.value : val
    const msg = typeof val === 'object' ? val.text : undefined
    rememberMergeMethod(repo, strategy)
    setMergeChoice({ strategy, msg })
    setDialog('merge-confirm')
  }

  const confirmMerge = () => {
    if (!mergeChoice) return
    const { strategy, msg } = mergeChoice
    const admin = strategy.startsWith('admin-')
    setDialog(null)
    runWrite(`Merging #${prNumber}`, () => mergePR(repo, prNumber, strategy, msg || undefined, admin ? { allowAdmin: true } : undefined))
      .then(ran => { if (ran) onBack() })
      .catch(err => {
        flash(`✗ Merge failed: ${err.message}`, 5000)
      })
  }

  const submitApproval = async (values) => {
    setDialog(null)
    try {
      if (!await runWrite(`Approving PR #${prNumber}`, () => reviewPR(repo, prNumber, 'approve', values.body || ''))) return
      flash(`✓ Approved PR #${prNumber}`, 3000)
    } catch (err) {
      flash(`✗ ${err.message}`, 5000)
    }
  }

  const submitChanges = async (values) => {
    setDialog(null)
    try {
      if (!await runWrite(`Requesting changes on PR #${prNumber}`, () => reviewPR(repo, prNumber, 'request-changes', values.body || ''))) return
      flash(`✓ Requested changes on PR #${prNumber}`, 3000)
    } catch (err) {
      flash(`✗ ${err.message}`, 5000)
    }
  }

  return {
    stdout, visibleHeight, diffStats, focusFile, totalFiles: diffFiles.totalFiles, listComplete: diffFiles.listComplete, listError: diffFiles.listError,
    commentsTruncated: !!commentsPage?.truncated,
    prMeta, repoInfo, mode, error: diffError, diffRefreshError, cursor, scrollOffset, dialog, setDialog,
    mergeChoice, compose, setCompose, COMMENT_TYPES, commentStatus, splitView,
    footerKeys, showTree, treeCursor, findQuery, setFindQuery, findActive,
    findMatches, gotoActive, gotoInput, setGotoInput, fileJumpActive, setFileJumpActive,
    aiReview, setAiReview, aiReviewLoading, aiReviewError, setAiReviewError,
    aiPostStatus, setAiPostStatus, files, rows, langCache, fileStartIndices,
    treeRows, commentsByLine, jumpTo, handleAiJumpTo, handleAiPost,
    repo, submitMerge, confirmMerge, submitApproval, submitChanges
  }
}
