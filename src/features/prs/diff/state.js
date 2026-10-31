// @ts-nocheck
/**
 * src/features/prs/diff/state.js — diff loading, navigation, overlays, and action callbacks.
 */

import { useState, useMemo, useContext, useEffect } from 'react'
import { useStdout } from 'ink'
import { useActionResolver, useKeymapInput } from '../../../config/keymap.js'
import { useGh } from '../../../hooks/useGh.js'
import { getPRDiff, listPRComments, addPRLineComment, getPR as getPRMeta, replyToComment, editPRComment, deletePRComment, mergePR, getRepoInfo, reviewPR } from '../../../executor.js'
import { contextFooterHints } from '../../../ui/actions.js'
import { usePendingWrite } from '../../../hooks/usePendingWrite.js'
import { getAICodeReview, AIError } from '../../../ai/index.js'
import { loadConfig } from '../../../config.js'
import { AppContext } from '../../../context.js'
import { useKeyScope } from '../../../keyscope.js'
import { sanitize } from '../../../utils.js'
import { parseDiff, flattenFiles } from '../diff-parser.js'
import { openInEditor } from '../../../editor.js'
import { getLang } from './highlight.js'
import { buildTreeRows } from './tree.js'
import { openEditorSync } from './editor.js'

const _cfg = loadConfig()
const _diffCfg = _cfg.diff
const _editorCfg = _cfg.editor

/**
 * True when gh refused the diff because it is too large (HTTP 406 and friends).
 * @param {Error|null|undefined} err
 */
function isDiffTooLarge(err) {
  if (!err) return false
  const text = `${err.message || ''} ${err.stderr || ''}`
  return /\b406\b|too[ _]large|too big|diff exceeded|exceeds the maximum/i.test(text)
}

/**
 * Count +/- lines and files from raw unified diff text (single pass).
 * Only lines inside a hunk count: `+++`/`---` are file headers only before the first `@@`.
 * @param {string} [text]
 */
function countDiffStats(text) {
  const stats = { additions: 0, deletions: 0, changedFiles: 0 }
  if (!text) return stats
  let inHunk = false
  for (const line of text.split('\n')) {
    if (line.startsWith('diff --git ')) { stats.changedFiles++; inHunk = false }
    else if (line.startsWith('@@')) inHunk = true
    else if (inHunk && line.startsWith('+')) stats.additions++
    else if (inHunk && line.startsWith('-')) stats.deletions++
  }
  return stats
}

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

  // The diff is fetched first and alone so it never queues behind secondary
  // calls on the gh concurrency cap (#451); everything else loads after it lands.
  const { data: diffText, loading, error, refetch, isStale: diffStale } = useGh(getPRDiff, [repo, prNumber])
  // Fetched this visit (not merely cached): secondary calls must not race the revalidation.
  const hasDiff = typeof diffText === 'string'
  const diffReady = hasDiff && (!diffStale || Boolean(error))
  // Stale data on screen + failed revalidation: keep the diff, surface a banner instead of an error screen.
  const diffRefreshError = hasDiff ? error : null
  const diffError = hasDiff ? null : error
  const diffTooLarge = isDiffTooLarge(diffError)
  // Large-diff gate is decided from the diff text itself: no separate stats call,
  // and the warning is decided in the same frame the diff arrives.
  const diffStats = useMemo(() => countDiffStats(diffText), [diffText])
  const isLargeDiff = (diffStats.additions + diffStats.deletions) > 5000
  const [diffWarningAck, setDiffWarningAck] = useState(false)

  const { data: prMeta } = useGh(getPRMeta, [repo, prNumber], { ttl: 300_000, enabled: diffReady })
  const { data: repoInfo } = useGh(getRepoInfo, [repo], { ttl: 300_000, enabled: diffReady })
  const headRefOid = /^[0-9a-f]{40}$/.test(prMeta?.headRefOid) ? prMeta.headRefOid : null
  const { data: comments, refetch: refetchComments, mutate: mutateComments } = useGh(listPRComments, [repo, prNumber], { enabled: diffReady })
  const [cursor, setCursor] = useState(0)
  const [scrollOffset, setScrollOffset] = useState(0)
  const [dialog, setDialog] = useState(null)
  const [adminMergeMsg, setAdminMergeMsg] = useState('')
  const [compose, setCompose] = useState(null)
  // compose types:
  //   new comment: { mode: 'new', commentType, body }
  //   reply:       { mode: 'reply', rootCommentId, body }
  //   edit:        { mode: 'edit', commentId, body }
  //   delete:      { mode: 'delete', commentId, commentBody }
  const COMMENT_TYPES = ['comment', 'suggestion', 'request-changes']
  const [commentStatus, setCommentStatus] = useState(null)
  const { run: pendingRun } = usePendingWrite(setCommentStatus)
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
  const { notifyDialog } = useContext(AppContext)
  useEffect(() => {
    notifyDialog(!!(gotoActive || findActive || compose || showTree || dialog || fileJumpActive || aiReview || aiReviewLoading))
    return () => notifyDialog(false)
  }, [gotoActive, findActive, compose, showTree, dialog, fileJumpActive, aiReview, aiReviewLoading, notifyDialog])

  // Cleanup transient input states on unmount so they don't bleed into re-mounts
  useEffect(() => () => {
    setFindActive(false)
    setFindQuery('')
    setGotoActive(false)
    setGotoInput('')
    setCompose(null)
  }, [])

  const skipParse = isLargeDiff && !diffWarningAck
  const files = useMemo(() => (skipParse ? [] : parseDiff(diffText || '')), [diffText, skipParse])
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
      if (row.type !== 'file-header' && row.type !== 'hunk' && row.text?.toLowerCase().includes(q))
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
    import('execa').then(({ execa }) => {
      const cmd = process.platform === 'darwin' ? 'open' : 'xdg-open'
      // prMeta.url comes from the GitHub API and already reflects the
      // correct host (github.com or a GHES instance). Fall back to a
      // GH_HOST-aware constructed URL if prMeta hasn't loaded yet.
      const baseUrl = prMeta?.url
        || `https://${process.env.GH_HOST || 'github.com'}/${repo}/pull/${prNumber}`
      execa(cmd, [`${baseUrl}/files`]).catch(() => {})
    })
  }

  useKeymapInput((input, key) => {
    const id = resolveAction(input, key)

    // gh refused the diff as too large: only browser/back make sense
    if (diffTooLarge) {
      if (id === 'pr.open-browser') { openFilesInBrowser(); return }
      if (id === 'app.back') { onBack(); return }
      return
    }

    // Large diff warning intercept
    if (isLargeDiff && !diffWarningAck) {
      if (key.return) { setDiffWarningAck(true); return }
      if (id === 'pr.open-browser') { openFilesInBrowser(); return }
      if (id === 'app.back') { onBack(); return }
      return
    }

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
          mutateComments(prev => (prev || []).filter(c => c.id !== deleteId))
          setCompose(null)
          deletePRComment(repo, deleteId)
            .then(() => { setCommentStatus('Deleted'); setTimeout(() => setCommentStatus(null), 3000) })
            .catch(err => {
              refetchComments()
              setCommentStatus(`Failed: ${err.message}`)
              setTimeout(() => setCommentStatus(null), 3000)
            })
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
            mutateComments(prev => [...(prev || []), optimisticComment])
            setCompose(null)
            setCommentStatus('Posting…')
            addPRLineComment(repo, prNumber, {
              body, path: row.filename,
              line: row.newLine || row.oldLine,
              side: row.type === 'del' ? 'LEFT' : 'RIGHT',
              commitId: headRefOid,
            }).then(() => {
              setCommentStatus('Comment added')
              setTimeout(() => setCommentStatus(null), 3000)
              refetchComments()
            }).catch(err => {
              mutateComments(prev => (prev || []).filter(c => c.id !== optimisticId))
              setCommentStatus(`Failed: ${err.message}`)
              setTimeout(() => setCommentStatus(null), 3000)
            })
          }
        } else if (compose.mode === 'reply') {
          if (body) {
            setCompose(null)
            replyToComment(repo, prNumber, compose.rootCommentId, body)
              .then(() => { setCommentStatus('Reply sent'); refetchComments(); setTimeout(() => setCommentStatus(null), 3000) })
              .catch(err => { setCommentStatus(`Failed: ${err.message}`); setTimeout(() => setCommentStatus(null), 3000) })
          } else {
            setCompose(null)
          }
          return
        } else if (compose.mode === 'edit') {
          if (body) {
            const editId = compose.commentId
            mutateComments(prev => (prev || []).map(c => c.id === editId ? { ...c, body } : c))
            setCompose(null)
            editPRComment(repo, editId, body)
              .then(() => { setCommentStatus('Comment updated'); setTimeout(() => setCommentStatus(null), 3000) })
              .catch(err => {
                refetchComments()
                setCommentStatus(`Failed: ${err.message}`)
                setTimeout(() => setCommentStatus(null), 3000)
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

    if (id === 'pr.merge' && prMeta?.state === 'OPEN') { setDialog('merge'); return }
    if (id === 'pr.approve' && prMeta?.state === 'OPEN') { setDialog('approve-body'); return }
    if (id === 'pr.request-changes' && prMeta?.state === 'OPEN') { setDialog('reqchanges-body'); return }

    // open current file at current line in editor
    if (id === 'pr.open-editor') {
      const row = rows[cursor]
      if (row?.filename) {
        const line = row.newLine || row.oldLine || 1
        openInEditor(row.filename, line, _editorCfg).catch(() => {})
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
      const isCodeRow = row && row.type !== 'file-header' && row.filename
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
        else if (row && row.type !== 'file-header') setCompose({ mode: 'new', commentType: 'comment', body: '' })
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
      getAICodeReview({
        diff:     diffText || '',
        prTitle:  sanitize(prMeta?.title || `PR #${prNumber}`),
        prBody:   sanitize((prMeta?.body || '').slice(0, 500)),
        authorHint: prMeta?.author?.login,
      })
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
    addPRLineComment(repo, prNumber, {
      body,
      path:     suggestion.file,
      line:     suggestion.line,
      side:     'RIGHT',
      commitId: headRefOid,
    })
      .then(() => {
        setAiPostStatus('posted')
        refetch()
        setTimeout(() => setAiPostStatus(null), 2000)
      })
      .catch(err => {
        setAiPostStatus(`error: ${err.message}`)
        setTimeout(() => setAiPostStatus(null), 5000)
      })
  }

  const submitMerge = (val) => {
    const strategy = typeof val === 'object' ? val.value : val
    const msg = typeof val === 'object' ? val.text : undefined
    if (strategy === 'admin') {
      setAdminMergeMsg(msg || '')
      setDialog('merge-admin')
    } else {
      setDialog(null)
      runWrite(`Merging #${prNumber}`, () => mergePR(repo, prNumber, strategy, msg))
        .then(ran => { if (ran) onBack() })
        .catch(err => {
          setCommentStatus(`✗ Merge failed: ${err.message}`)
          setTimeout(() => setCommentStatus(null), 5000)
        })
    }
  }

  const selectAdminMethod = (val) => {
    const method = typeof val === 'object' ? val.value : val
    // Preserve the commit message the user typed in the prior picker,
    // whether it's still the raw string or was already wrapped into
    // {strategy, msg} by an earlier pass through this dialog.
    const priorMsg = typeof adminMergeMsg === 'object' ? adminMergeMsg.msg : adminMergeMsg
    const nextMsg  = (typeof val === 'object' && val.text) ? val.text : priorMsg
    setAdminMergeMsg({ strategy: `admin-${method}`, msg: nextMsg })
    setDialog('merge-admin-confirm')
  }

  const confirmAdminMerge = () => {
    const pending = typeof adminMergeMsg === 'object' ? adminMergeMsg : { strategy: 'admin-merge', msg: adminMergeMsg }
    setDialog(null)
    runWrite(`Merging #${prNumber}`, () => mergePR(repo, prNumber, pending.strategy, pending.msg || undefined, { allowAdmin: true }))
      .then(ran => { if (ran) onBack() })
      .catch(err => {
        setCommentStatus(`✗ Merge failed: ${err.message}`)
        setTimeout(() => setCommentStatus(null), 5000)
      })
  }

  const submitApproval = async (values) => {
    setDialog(null)
    try {
      if (!await runWrite(`Approving PR #${prNumber}`, () => reviewPR(repo, prNumber, 'approve', values.body || ''))) return
      setCommentStatus(`✓ Approved PR #${prNumber}`)
      setTimeout(() => setCommentStatus(null), 3000)
    } catch (err) {
      setCommentStatus(`✗ ${err.message}`)
      setTimeout(() => setCommentStatus(null), 5000)
    }
  }

  const submitChanges = async (values) => {
    setDialog(null)
    try {
      if (!await runWrite(`Requesting changes on PR #${prNumber}`, () => reviewPR(repo, prNumber, 'request-changes', values.body || ''))) return
      setCommentStatus(`✓ Requested changes on PR #${prNumber}`)
      setTimeout(() => setCommentStatus(null), 3000)
    } catch (err) {
      setCommentStatus(`✗ ${err.message}`)
      setTimeout(() => setCommentStatus(null), 5000)
    }
  }

  return {
    stdout, visibleHeight, diffStats, isLargeDiff, diffTooLarge, diffWarningAck,
    prMeta, repoInfo, loading: loading && !hasDiff, error: diffError, diffRefreshError, cursor, scrollOffset, dialog, setDialog,
    adminMergeMsg, compose, setCompose, COMMENT_TYPES, commentStatus, splitView,
    footerKeys, showTree, treeCursor, findQuery, setFindQuery, findActive,
    findMatches, gotoActive, gotoInput, setGotoInput, fileJumpActive, setFileJumpActive,
    aiReview, setAiReview, aiReviewLoading, aiReviewError, setAiReviewError,
    aiPostStatus, setAiPostStatus, files, rows, langCache, fileStartIndices,
    treeRows, commentsByLine, jumpTo, handleAiJumpTo, handleAiPost,
    submitMerge, selectAdminMethod, confirmAdminMerge, submitApproval, submitChanges
  }
}
