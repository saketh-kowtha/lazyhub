/**
 * src/features/prs/diff.jsx — PR diff view with syntax highlighting + line comments
 */

import React, { useState, useMemo, useRef, useCallback, useContext, useEffect } from 'react'
import { Box, Text, useInput, useStdout } from 'ink'
import { spawnSync } from 'child_process'
import { writeFileSync, readFileSync, mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import chalk from 'chalk'
import hljs from 'highlight.js'
import { useKeyScope } from '../../keyscope.js'
import { useGh } from '../../hooks/useGh.js'
import { getPRDiff, listPRComments, addPRLineComment, getPRDiffStats, getPR as getPRMeta, replyToComment, editPRComment, deletePRComment, mergePR, getRepoInfo } from '../../executor.js'
import { OptionPicker } from '../../components/dialogs/OptionPicker.jsx'
import { ConfirmDialog } from '../../components/dialogs/ConfirmDialog.jsx'
import { FuzzySearch } from '../../components/dialogs/FuzzySearch.jsx'
import { FooterKeys } from '../../components/FooterKeys.jsx'
import { AIReviewPane } from '../../components/AIReviewPane.jsx'
import { getAICodeReview, AIError } from '../../ai.js'
import { loadConfig } from '../../config.js'
import { useTheme } from '../../theme.js'
import { AppContext } from '../../context.js'
import { TextInput, colorChalk, bgColorChalk, applyThemeStyle, sanitize, shortAge } from '../../utils.js'
import { CommentThread } from '../../components/CommentThread.jsx'
import { Spinner } from '../../components/Spinner.jsx'
import { openInEditor } from '../../editor.js'

const _cfg = loadConfig()
const _diffCfg = _cfg.diff
const _editorCfg = _cfg.editor
const stripAnsi = s => (s || '').replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '')

const MERGE_OPTIONS_BASE = [
  { value: 'merge',  label: '--merge',  description: 'Create a merge commit' },
  { value: 'squash', label: '--squash', description: 'Squash all commits into one' },
  { value: 'rebase', label: '--rebase', description: 'Rebase onto base branch' },
]
const MERGE_OPTION_ADMIN = { value: 'admin', label: '--admin', description: 'Bypass branch protection (admin only)' }

function getLang(filename) {
  if (!filename) return null
  const ext = (filename.split('.').pop() || '').toLowerCase()
  const map = {
    js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript',
    ts: 'typescript', tsx: 'typescript',
    py: 'python', rb: 'ruby', go: 'go', rs: 'rust',
    java: 'java', kt: 'kotlin', swift: 'swift',
    cpp: 'cpp', cc: 'cpp', cxx: 'cpp', c: 'c', h: 'c',
    cs: 'csharp', php: 'php',
    sh: 'bash', bash: 'bash', zsh: 'bash',
    json: 'json', yaml: 'yaml', yml: 'yaml',
    xml: 'xml', html: 'html', htm: 'html',
    css: 'css', scss: 'scss', less: 'less',
    md: 'markdown', sql: 'sql',
    graphql: 'graphql', gql: 'graphql',
  }
  return map[ext] || null
}

function openEditorSync(initial) {
  const raw = process.env.EDITOR || process.env.VISUAL || 'vi'
  if (!raw || /[\0\n\r]/.test(raw)) return initial
  const [editorBin, ...editorArgs] = raw.split(/\s+/).filter(Boolean)
  let tmpDir
  try {
    tmpDir = mkdtempSync(join(tmpdir(), 'lazyhub-'))
    const tmp = join(tmpDir, 'comment.md')
    writeFileSync(tmp, initial || '', { mode: 0o600 })
    process.stdout.write('\x1b[?1049l')
    const result = spawnSync(editorBin, [...editorArgs, tmp], { stdio: 'inherit' })
    // Re-enter alternate screen after editor exits
    process.stdout.write('\x1b[?1049h\x1b[H')
    if (result.status !== 0) return initial
    return readFileSync(tmp, 'utf8')
  } catch { return initial }
  finally { try { if (tmpDir) rmSync(tmpDir, { recursive: true, force: true }) } catch {} }
}

// ─── hljs HTML → chalk ───────────────────────────────────────────────────────
// Converts highlight.js HTML output to chalk-colored terminal strings.
// Preserves the bgColor on every character so the add/del background shows through.

function getClsColor(t) {
  return {
    'hljs-keyword':           t.syntax.keyword,
    'hljs-built_in':          t.syntax.builtin,
    'hljs-type':              t.syntax.type,
    'hljs-literal':           t.syntax.literal,
    'hljs-number':            t.syntax.number,
    'hljs-operator':          t.syntax.operator,
    'hljs-punctuation':       t.syntax.default,
    'hljs-property':          t.syntax.attr,
    'hljs-regexp':            t.syntax.regexp,
    'hljs-string':            t.syntax.string,
    'hljs-subst':             t.syntax.default,
    'hljs-symbol':            t.syntax.literal,
    'hljs-class':             t.syntax.type,
    'hljs-function':          t.syntax.fn,
    'hljs-title':             t.syntax.fn,
    'hljs-title class_':      t.syntax.type,
    'hljs-title function_':   t.syntax.fn,
    'hljs-params':            t.syntax.default,
    'hljs-comment':           t.syntax.comment,
    'hljs-doctag':            t.syntax.comment,
    'hljs-meta':              t.syntax.meta,
    'hljs-tag':               t.syntax.tag,
    'hljs-name':              t.syntax.tag,
    'hljs-attr':              t.syntax.attr,
    'hljs-attribute':         t.syntax.attr,
    'hljs-variable':          t.syntax.variable,
    'hljs-variable language_': t.syntax.builtin,
    'hljs-selector-tag':      t.syntax.tag,
    'hljs-selector-class':    t.syntax.fn,
    'hljs-selector-id':       t.syntax.builtin,
    'hljs-addition':          t.syntax.string,
    'hljs-deletion':          t.syntax.keyword,
  }
}

function htmlToChalk(html, bgColor, t) {
  const parts = []
  const colorStack = []
  const clsColor = getClsColor(t)
  let i = 0

  while (i < html.length) {
    if (html[i] !== '<') {
      const end = html.indexOf('<', i)
      const raw = end === -1 ? html.slice(i) : html.slice(i, end)
      const text = raw
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
      if (text) {
        const fg = colorStack.filter(Boolean).at(-1) || t.syntax.default
        parts.push(applyThemeStyle(text, fg, bgColor))
      }
      i = end === -1 ? html.length : end
      continue
    }

    const end = html.indexOf('>', i)
    if (end === -1) { i++; continue }
    const tag = html.slice(i + 1, end)

    if (tag.startsWith('/span')) {
      colorStack.pop()
    } else if (tag.startsWith('span')) {
      const m = tag.match(/class="([^"]+)"/)
      const cls = m ? m[1] : null
      const color = cls ? (clsColor[cls] ?? clsColor[cls.split(' ')[0]] ?? null) : null
      colorStack.push(color)
    }
    i = end + 1
  }

  return parts.join('')
}

// Module-level cache: (lang:bgColor:code) → chalk string. Survives re-renders.
// Cap at 5000 entries with simple FIFO eviction.
const _syntaxCache = new Map()
const _SYNTAX_CACHE_MAX = 5000

function syntaxHighlight(code, lang, bgColor, t) {
  if (!lang) {
    return applyThemeStyle(code, t.syntax.default, bgColor)
  }
  const cacheKey = `${lang}:${bgColor}:${code}`
  if (_syntaxCache.has(cacheKey)) return _syntaxCache.get(cacheKey)

  let result
  try {
    const { value } = hljs.highlight(code, { language: lang, ignoreIllegals: true })
    result = htmlToChalk(value, bgColor, t)
  } catch {
    result = applyThemeStyle(code, t.syntax.default, bgColor)
  }

  if (_syntaxCache.size >= _SYNTAX_CACHE_MAX) {
    _syntaxCache.delete(_syntaxCache.keys().next().value)
  }
  _syntaxCache.set(cacheKey, result)
  return result
}

// ─── Diff parser ──────────────────────────────────────────────────────────────

function parseDiff(diffText) {
  if (!diffText) return []
  const files = []
  let currentFile = null
  let oldLine = 0
  let newLine = 0

  for (const raw of diffText.split('\n')) {
    if (raw.startsWith('diff --git')) {
      currentFile = { header: raw, filename: '', addCount: 0, delCount: 0, lines: [] }
      files.push(currentFile)
      oldLine = 0; newLine = 0
    } else if (raw.startsWith('+++ ') && currentFile) {
      currentFile.filename = raw.slice(4).replace(/^b\//, '')
    } else if (raw.startsWith('@@') && currentFile) {
      const m = raw.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/)
      if (m) { oldLine = parseInt(m[1], 10); newLine = parseInt(m[2], 10) }
      currentFile.lines.push({ type: 'hunk', text: raw, oldLine: null, newLine: null })
    } else if (currentFile) {
      if (raw.startsWith('+')) {
        currentFile.lines.push({ type: 'add', text: raw.slice(1), oldLine: null, newLine: newLine++ })
        currentFile.addCount++
      } else if (raw.startsWith('-')) {
        currentFile.lines.push({ type: 'del', text: raw.slice(1), oldLine: oldLine++, newLine: null })
        currentFile.delCount++
      } else {
        currentFile.lines.push({
          type: 'ctx',
          text: raw.startsWith(' ') ? raw.slice(1) : raw,
          oldLine: oldLine++,
          newLine: newLine++,
        })
      }
    }
  }
  return files
}

function flattenFiles(files) {
  const rows = []
  for (const file of files) {
    rows.push({ type: 'file-header', filename: file.filename, addCount: file.addCount, delCount: file.delCount })
    for (const line of file.lines) rows.push({ ...line, filename: file.filename })
  }
  return rows
}

// ─── File tree builder ────────────────────────────────────────────────────────

function buildTreeRows(files) {
  // Build tree structure
  const root = { name: '', isFile: false, addCount: 0, delCount: 0, children: new Map() }

  for (const file of files) {
    const parts = file.filename.split('/')
    let node = root
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i]
      const isFile = i === parts.length - 1
      if (!node.children.has(part)) {
        node.children.set(part, {
          name: part,
          isFile,
          addCount: 0,
          delCount: 0,
          filename: isFile ? file.filename : null,
          children: new Map(),
        })
      }
      const child = node.children.get(part)
      if (isFile) {
        child.addCount = file.addCount
        child.delCount = file.delCount
        child.filename = file.filename
      }
      node = child
    }
  }

  // Flatten via pre-order traversal with prefix computation
  const rows = []

  function traverse(node, depth, lastFlags) {
    const children = [...node.children.values()]
    children.forEach((child, idx) => {
      const isLast = idx === children.length - 1
      // Build prefix from parent flags
      let prefix = ''
      for (let d = 0; d < depth; d++) {
        prefix += lastFlags[d] ? '   ' : '│  '
      }
      prefix += isLast ? '└──' : '├──'

      rows.push({
        type: child.isFile ? 'file' : 'dir',
        name: child.name,
        depth,
        prefix,
        filename: child.filename,
        addCount: child.addCount,
        delCount: child.delCount,
      })

      if (!child.isFile) {
        traverse(child, depth + 1, [...lastFlags, isLast])
      }
    })
  }

  traverse(root, 0, [])
  return rows
}

// ─── Diff line renderer ───────────────────────────────────────────────────────
// Gutter: cursor(1) oldLn(4) newLn(4) sign(2) code

const DiffLine = React.memo(({ row, isSelected, lang, isMatch, t }) => {
  let cur
  if (isSelected) {
    cur = applyThemeStyle('▶', '#ffffff', t.diff.cursorBg)
  } else if (isMatch) {
    cur = colorChalk('#e3b341')('◆')
  } else {
    cur = ' '
  }

  const gutterOld = row.oldLine != null ? String(row.oldLine).padStart(4) : '    '
  const gutterNew = row.newLine != null ? String(row.newLine).padStart(4) : '    '

  if (row.type === 'file-header') {
    const line =
      colorChalk(t.ui.selected).bold(`━━ ${row.filename} `) +
      colorChalk(t.ci.pass)(`+${row.addCount}`) +
      colorChalk(t.syntax.default)(' / ') +
      colorChalk(t.ci.fail)(`-${row.delCount}`)
    return <Text wrap="truncate">{cur + line}</Text>
  }

  if (row.type === 'hunk') {
    return (
      <Text wrap="truncate">
        {cur + applyThemeStyle(`${gutterOld}${gutterNew}   ${row.text}`, t.diff.hunkFg, t.diff.hunkBg)}
      </Text>
    )
  }

  if (row.type === 'add') {
    const signFg = isSelected ? '#ffffff' : t.diff.addSign
    const sign   = isSelected ? '▶' : '+'
    const gutter = applyThemeStyle(`${gutterOld}${gutterNew} ${sign} `, signFg, t.diff.addBg)
    return <Text wrap="truncate">{cur + gutter + syntaxHighlight(row.text, lang, t.diff.addBg, t)}</Text>
  }

  if (row.type === 'del') {
    const signFg = isSelected ? '#ffffff' : t.diff.delSign
    const sign   = isSelected ? '▶' : '-'
    const gutter = applyThemeStyle(`${gutterOld}${gutterNew} ${sign} `, signFg, t.diff.delBg)
    return <Text wrap="truncate">{cur + gutter + syntaxHighlight(row.text, lang, t.diff.delBg, t)}</Text>
  }

  // ctx — highlight the full gutter+code with cursor bg when selected
  const bgGutter = isSelected
    ? applyThemeStyle(`${gutterOld}${gutterNew}   `, t.ui.selected, t.diff.cursorBg)
    : colorChalk(t.ui.dim)(`${gutterOld}${gutterNew}   `)
  const code = syntaxHighlight(row.text, lang, isSelected ? t.diff.cursorBg : null, t)
  return <Text wrap="truncate">{cur + bgGutter + code}</Text>
})

// ─── Thread renderer ──────────────────────────────────────────────────────────

function renderThreads(comments, t) {
  // Sort all by createdAt
  const sorted = [...comments].sort((a, b) =>
    new Date(a.createdAt) - new Date(b.createdAt)
  )

  // Separate top-level and replies
  const topLevel = sorted.filter(c => !c.inReplyToId)
  const replies = sorted.filter(c => c.inReplyToId)

  const elements = []

  for (const comment of topLevel) {
    // Header line
    elements.push(
      <Box key={`${comment.id}-header`} gap={1}>
        <Text color={t.diff.threadBorder}>┃</Text>
        <Text color={t.ui.selected} bold>@{comment.user?.login}</Text>
        <Text color={t.ui.dim}>·</Text>
        <Text color={t.ui.dim}>{shortAge(comment.createdAt)}</Text>
      </Box>
    )
    // Body lines
    const bodyLines = (comment.body || '').split('\n')
    for (let i = 0; i < bodyLines.length; i++) {
      elements.push(
        <Box key={`${comment.id}-body-${i}`}>
          <Text color={t.diff.threadBorder}>┃ </Text>
          <Text color={t.diff.ctxFg} wrap="truncate">{sanitize(bodyLines[i])}</Text>
        </Box>
      )
    }
    // Empty line after top-level comment
    elements.push(
      <Box key={`${comment.id}-spacer`}>
        <Text color={t.diff.threadBorder}>┃</Text>
      </Box>
    )

    // Replies to this comment
    const commentReplies = replies.filter(r => r.inReplyToId === comment.id)
    for (const reply of commentReplies) {
      elements.push(
        <Box key={`${reply.id}-header`} gap={1}>
          <Text color={t.diff.threadBorder}>┃  </Text>
          <Text color={t.ui.selected} bold>@{reply.user?.login}</Text>
          <Text color={t.ui.dim}>·</Text>
          <Text color={t.ui.dim}>{shortAge(reply.createdAt)}</Text>
        </Box>
      )
      const replyLines = (reply.body || '').split('\n')
      for (let i = 0; i < replyLines.length; i++) {
        elements.push(
          <Box key={`${reply.id}-body-${i}`}>
            <Text color={t.diff.threadBorder}>┃   </Text>
            <Text color={t.diff.ctxFg} wrap="truncate">{sanitize(replyLines[i])}</Text>
          </Box>
        )
      }
    }
  }

  return elements
}

// ─── Component ────────────────────────────────────────────────────────────────

const FOOTER_KEYS_UNIFIED = [
  { key: 'j/k',  label: 'scroll' },
  { key: 'gg/G', label: 'top/bottom' },
  { key: ']/[',  label: 'file' },
  { key: 'f',    label: 'jump to file' },
  { key: ':',    label: 'go to line' },
  { key: 'E',    label: 'open in editor' },
  { key: 'c',    label: 'comment' },
  { key: 'r/e/d', label: 'reply/edit/delete thread' },
  { key: 'n/N',  label: 'next/prev thread or match' },
  { key: 'A',    label: 'AI review' },
  { key: 'v',    label: 'comments' },
  { key: 's',    label: 'split view' },
  { key: 't',    label: 'file tree' },
  { key: '/',    label: 'find' },
  { key: 'S',    label: 'settings' },
  { key: 'Esc',  label: 'back' },
]

const FOOTER_KEYS_SPLIT = [
  { key: 'j/k',  label: 'scroll' },
  { key: 'gg/G', label: 'top/bottom' },
  { key: ']/[',  label: 'file' },
  { key: 'f',    label: 'jump to file' },
  { key: ':',    label: 'go to line' },
  { key: 'E',    label: 'open in editor' },
  { key: 'c',    label: 'comment' },
  { key: 'r/e/d', label: 'reply/edit/delete thread' },
  { key: 'n/N',  label: 'next/prev thread or match' },
  { key: 'A',    label: 'AI review' },
  { key: 'v',    label: 'comments' },
  { key: 's',    label: 'unified view' },
  { key: 't',    label: 'file tree' },
  { key: '/',    label: 'find' },
  { key: 'S',    label: 'settings' },
  { key: 'Esc',  label: 'back' },
]

// ─── Split view renderer ──────────────────────────────────────────────────────

function renderSplitView(rows, scrollOffset, visibleHeight, cursor, langCache, colWidth, t) {
  const result = []
  const slice = rows.slice(scrollOffset, scrollOffset + visibleHeight)

  let i = 0
  while (i < slice.length) {
    const row = slice[i]
    const idx = scrollOffset + i
    // del+add pairs: del highlights when cursor is on either side
    const nextIsPairedAdd = row.type === 'del' && slice[i + 1]?.type === 'add'
    const isSelected = idx === cursor || (nextIsPairedAdd && (scrollOffset + i + 1) === cursor)

    // Full-width rows (file-header, hunk)
    if (row.type === 'file-header' || row.type === 'hunk') {
      const lang = langCache.get(row.filename)
      result.push(
        <Box key={idx}>
          <DiffLine row={row} isSelected={isSelected} lang={lang} t={t} />
        </Box>
      )
      i++
      continue
    }

    if (row.type === 'ctx') {
      const lang = langCache.get(row.filename)
      const code = syntaxHighlight(row.text, lang, null, t)
      const gutter = colorChalk(t.ui.dim)(`${String(row.oldLine ?? '').padStart(4)}${String(row.newLine ?? '').padStart(4)}   `)
      const line = isSelected ? applyThemeStyle(gutter + code, null, t.diff.cursorBg) : gutter + code
      result.push(
        <Box key={idx}>
          <Box width={colWidth} overflow="hidden"><Text wrap="truncate">{line}</Text></Box>
          <Text color={t.ui.dim}>│</Text>
          <Box width={colWidth} overflow="hidden"><Text wrap="truncate">{line}</Text></Box>
        </Box>
      )
      i++
      continue
    }

    // del/add: try to pair them
    if (row.type === 'del') {
      const nextRow = slice[i + 1]
      const lang = langCache.get(row.filename)

      const delCur    = isSelected ? applyThemeStyle('▶', '#ffffff', t.diff.cursorBg) : ' '
      const delGutter = applyThemeStyle(`${String(row.oldLine ?? '').padStart(4)}     - `, isSelected ? '#ffffff' : t.diff.delSign, isSelected ? t.diff.cursorBg : t.diff.delBg)
      const delCode   = syntaxHighlight(row.text, lang, isSelected ? t.diff.cursorBg : t.diff.delBg, t)
      const delLine   = delCur + delGutter + delCode

      if (nextRow && nextRow.type === 'add') {
        const addSelected = idx === cursor || (scrollOffset + i + 1) === cursor
        const addCur    = addSelected ? applyThemeStyle('▶', '#ffffff', t.diff.cursorBg) : ' '
        const addGutter = applyThemeStyle(`    ${String(nextRow.newLine ?? '').padStart(4)} + `, addSelected ? '#ffffff' : t.diff.addSign, addSelected ? t.diff.cursorBg : t.diff.addBg)
        const addCode   = syntaxHighlight(nextRow.text, langCache.get(nextRow.filename), addSelected ? t.diff.cursorBg : t.diff.addBg, t)
        const addLine   = addCur + addGutter + addCode

        result.push(
          <Box key={idx}>
            <Box width={colWidth} overflow="hidden"><Text wrap="truncate">{delLine}</Text></Box>
            <Text color={t.ui.dim}>│</Text>
            <Box width={colWidth} overflow="hidden"><Text wrap="truncate">{addLine}</Text></Box>
          </Box>
        )
        i += 2
      } else {
        result.push(
          <Box key={idx}>
            <Box width={colWidth} overflow="hidden"><Text wrap="truncate">{delLine}</Text></Box>
            <Text color={t.ui.dim}>│</Text>
            <Box width={colWidth} overflow="hidden"><Text> </Text></Box>
          </Box>
        )
        i++
      }
      continue
    }

    if (row.type === 'add') {
      // Unpaired add
      const lang    = langCache.get(row.filename)
      const addCur  = isSelected ? applyThemeStyle('▶', '#ffffff', t.diff.cursorBg) : ' '
      const addGutter = applyThemeStyle(`    ${String(row.newLine ?? '').padStart(4)} + `, isSelected ? '#ffffff' : t.diff.addSign, isSelected ? t.diff.cursorBg : t.diff.addBg)
      const addCode   = syntaxHighlight(row.text, lang, isSelected ? t.diff.cursorBg : t.diff.addBg, t)
      const addLine   = addCur + addGutter + addCode

      result.push(
        <Box key={idx}>
          <Box width={colWidth} overflow="hidden"><Text> </Text></Box>
          <Text color={t.ui.dim}>│</Text>
          <Box width={colWidth} overflow="hidden"><Text wrap="truncate">{addLine}</Text></Box>
        </Box>
      )
      i++
      continue
    }

    i++
  }

  return result
}

export function PRDiff({ prNumber, repo, onBack, onViewComments }) {
  useKeyScope('view')
  const { t } = useTheme()
  const { stdout } = useStdout()
  const visibleHeight = Math.max(5, (stdout?.rows || 24) - 6)

  const { data: diffStats } = useGh(getPRDiffStats, [repo, prNumber])
  const isLargeDiff = ((diffStats?.additions || 0) + (diffStats?.deletions || 0)) > 5000
  const [diffWarningAck, setDiffWarningAck] = useState(false)

  const { data: prMeta } = useGh(getPRMeta, [repo, prNumber], { ttl: 300_000 })
  const { data: repoInfo } = useGh(getRepoInfo, [repo], { ttl: 300_000 })
  const headRefOid = /^[0-9a-f]{40}$/.test(prMeta?.headRefOid) ? prMeta.headRefOid : null
  const { data: diffText, loading, error, refetch } = useGh(getPRDiff, [repo, prNumber])
  const { data: comments, refetch: refetchComments, mutate: mutateComments } = useGh(listPRComments, [repo, prNumber])
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
  const [splitView, setSplitView] = useState(_diffCfg.defaultView === 'split')
  const lastKeyRef  = useRef(null)
  const lastKeyTimer = useRef(null)

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

  const files = useMemo(() => parseDiff(diffText || ''), [diffText])
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

  useInput((input, key) => {
    // Large diff warning intercept
    if (isLargeDiff && !diffWarningAck) {
      if (key.return) { setDiffWarningAck(true); return }
      if (input === 'o') {
        import('execa').then(({ execa }) => {
          const cmd = process.platform === 'darwin' ? 'open' : 'xdg-open'
          execa(cmd, [`https://github.com/${repo}/pull/${prNumber}/files`]).catch(() => {})
        })
        return
      }
      if (key.escape || input === 'q') { onBack(); return }
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
      if (key.escape || input === 't') {
        setShowTree(false)
        return
      }
      if (input === 'j' || key.downArrow) {
        setTreeCursor(prev => Math.min(treeRows.length - 1, prev + 1))
        return
      }
      if (input === 'k' || key.upArrow) {
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
        if (input === 'y') {
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
        } else if (input === 'n') {
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

      if ((key.ctrl && key.return) || (key.ctrl && (input === 'g' || input === '\x07'))) {
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
      if (key.ctrl && input === 'e' && compose.mode !== 'delete') {
        const edited = openEditorSync(compose.body)
        setCompose(c => ({ ...c, body: edited }))
        return
      }
      return
    }

    if (dialog) return

    if (input === 'm' && prMeta?.state === 'OPEN') { setDialog('merge'); return }

    // E — open current file at current line in editor
    if (input === 'E') {
      const row = rows[cursor]
      if (row?.filename) {
        const line = row.newLine || row.oldLine || 1
        openInEditor(row.filename, line, _editorCfg).catch(() => {})
      }
      return
    }

    if (input === 'f') { setFileJumpActive(true); return }

    // gg → jump to top
    if (input === 'g') {
      if (lastKeyRef.current === 'g') {
        clearTimeout(lastKeyTimer.current)
        lastKeyRef.current = null
        jumpTo(0)
        return
      }
      lastKeyRef.current = 'g'
      lastKeyTimer.current = setTimeout(() => { lastKeyRef.current = null }, 400)
      return
    }
    lastKeyRef.current = null

    if (input === 'G')  { jumpTo(rows.length - 1); return }
    // Esc: clear find query first, then go back on second Esc
    if (key.escape && findQuery) { setFindQuery(''); return }
    if (key.escape || input === 'q') { onBack(); return }
    if (input === 'v')  { onViewComments(); return }
    if (input === 'j' || key.downArrow) { moveCursor(1);  return }
    if (input === 'k' || key.upArrow)   { moveCursor(-1); return }

    if (input === ']') {
      const next = fileStartIndices.find(i => i > cursor)
      if (next != null) jumpTo(next)
      return
    }
    if (input === '[') {
      const prev = [...fileStartIndices].reverse().find(i => i < cursor)
      if (prev != null) jumpTo(prev)
      return
    }

    // n/N: next/prev thread or match
    if (input === 'n') {
      if (findQuery && findMatches.length > 0) {
        jumpToMatch('next')
      } else {
        const next = commentThreadIndices.find(i => i > cursor)
        if (next != null) jumpTo(next)
      }
      return
    }
    if (input === 'N') {
      if (findQuery && findMatches.length > 0) {
        jumpToMatch('prev')
      } else {
        const prev = [...commentThreadIndices].reverse().find(i => i < cursor)
        if (prev != null) jumpTo(prev)
      }
      return
    }

    if (input === 's') { setSplitView(v => !v); return }

    // t: toggle file tree
    if (input === 't') {
      setShowTree(v => !v)
      setTreeCursor(0)
      return
    }

    // /: open find (only when not in compose/tree/findActive)
    if (input === '/') {
      setFindActive(true)
      return
    }

    if (input === ':') { setGotoActive(true); setGotoInput(''); return }

    if (input === 'c') {
      const row = rows[cursor]
      if (row && row.type !== 'file-header') {
        setCompose({ mode: 'new', commentType: 'comment', body: '' })
      }
      return
    }

    // e/d — edit/delete on thread at cursor line (no fallback action)
    if (input === 'e' || input === 'd') {
      const row = rows[cursor]
      const isCodeRow = row && row.type !== 'file-header' && row.filename
      const lineNum = isCodeRow ? (row.newLine ?? row.oldLine) : null
      const lineKey = lineNum != null ? `${row.filename}:${lineNum}` : null
      const lineComments = lineKey ? commentsByLine.get(lineKey) : null
      if (lineComments?.length) {
        const sorted = [...lineComments].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))
        const lastComment = sorted[sorted.length - 1]
        if (input === 'e' && lastComment) {
          setCompose({ mode: 'edit', commentId: lastComment.id, body: lastComment.body || '' })
        } else if (input === 'd' && lastComment) {
          setCompose({ mode: 'delete', commentId: lastComment.id, commentBody: lastComment.body || '' })
        }
      }
      return
    }

    // r — reply on thread at cursor line, or refetch if no thread there
    if (input === 'r') {
      const row = rows[cursor]
      const isCodeRow = row && row.type !== 'file-header' && row.filename
      const lineNum = isCodeRow ? (row.newLine ?? row.oldLine) : null
      const lineKey = lineNum != null ? `${row.filename}:${lineNum}` : null
      const lineComments = lineKey ? commentsByLine.get(lineKey) : null
      if (lineComments?.length) {
        const sorted = [...lineComments].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))
        const roots = sorted.filter(c => !c.inReplyToId)
        const rootId = roots[0]?.id
        if (rootId) setCompose({ mode: 'reply', rootCommentId: rootId, body: '' })
      } else {
        refetch()
      }
      return
    }

    // A — trigger AI code review
    if (input === 'A') {
      if (aiReviewLoading) return
      const config = loadConfig()
      if (config.aiReviewEnabled === false) {
        setAiReviewError('AI Code Review is disabled in Settings (s)')
        setTimeout(() => setAiReviewError(null), 3000)
        return
      }
      const apiKey = config.ai?.anthropicApiKey
      if (!apiKey) {
        setAiReviewError('No API key — set Anthropic API key in Settings (s)')
        setTimeout(() => setAiReviewError(null), 4000)
        return
      }
      setAiReviewLoading(true)
      setAiReviewError(null)
      getAICodeReview({
        diff:     diffText || '',
        prTitle:  sanitize(prMeta?.title || `PR #${prNumber}`),
        prBody:   sanitize((prMeta?.body || '').slice(0, 500)),
        apiKey,
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

  if (isLargeDiff && !diffWarningAck) {
    return (
      <Box flexDirection="column" flexGrow={1} paddingX={2} paddingY={1}>
        <Text color={t.ci.pending} bold>⚠ Large diff: +{diffStats.additions} -{diffStats.deletions} across {diffStats.changedFiles} files</Text>
        <Text color={t.ui.muted}>This may take a moment to render.</Text>
        <Box marginTop={1} gap={3}>
          <Text color={t.ui.selected}>[Enter] Load anyway</Text>
          <Text color={t.ui.muted}>[o] Open in browser</Text>
          <Text color={t.ui.dim}>[Esc] Back</Text>
        </Box>
      </Box>
    )
  }

  if (dialog === 'merge') {
    const mergeOpts = !repoInfo || repoInfo.viewerPermission === 'ADMIN'
      ? [...MERGE_OPTIONS_BASE, MERGE_OPTION_ADMIN]
      : MERGE_OPTIONS_BASE
    return (
      <OptionPicker
        title={`Merge PR #${prNumber}: ${sanitize(prMeta?.title || '')}`}
        options={mergeOpts}
        promptText="Commit message (optional)"
        onSubmit={(val) => {
          const strategy = typeof val === 'object' ? val.value : val
          const msg = typeof val === 'object' ? val.text : undefined
          if (strategy === 'admin') {
            setAdminMergeMsg(msg || '')
            setDialog('merge-admin')
          } else {
            setDialog(null)
            mergePR(repo, prNumber, strategy, msg)
              .then(() => onBack())
              .catch(err => {
                setCommentStatus(`✗ Merge failed: ${err.message}`)
                setTimeout(() => setCommentStatus(null), 5000)
              })
          }
        }}
        onCancel={() => setDialog(null)}
      />
    )
  }

  if (dialog === 'merge-admin') {
    return (
      <OptionPicker
        title={`Merge method (admin bypass) — PR #${prNumber}`}
        options={MERGE_OPTIONS_BASE}
        onSubmit={(val) => {
          const method = typeof val === 'object' ? val.value : val
          // Preserve the commit message the user typed in the prior picker,
          // whether it's still the raw string or was already wrapped into
          // {strategy, msg} by an earlier pass through this dialog.
          const priorMsg = typeof adminMergeMsg === 'object' ? adminMergeMsg.msg : adminMergeMsg
          const nextMsg  = (typeof val === 'object' && val.text) ? val.text : priorMsg
          setAdminMergeMsg({ strategy: `admin-${method}`, msg: nextMsg })
          setDialog('merge-admin-confirm')
        }}
        onCancel={() => setDialog('merge')}
      />
    )
  }

  if (dialog === 'merge-admin-confirm') {
    const pending = typeof adminMergeMsg === 'object' ? adminMergeMsg : { strategy: 'admin-merge', msg: adminMergeMsg }
    return (
      <ConfirmDialog
        message={`⚠ ADMIN BYPASS: merge PR #${prNumber} via --${pending.strategy.replace('admin-', '')} bypassing branch protection?`}
        destructive={true}
        onConfirm={() => {
          setDialog(null)
          mergePR(repo, prNumber, pending.strategy, pending.msg || undefined)
            .then(() => onBack())
            .catch(err => {
              setCommentStatus(`✗ Merge failed: ${err.message}`)
              setTimeout(() => setCommentStatus(null), 5000)
            })
        }}
        onCancel={() => setDialog('merge-admin')}
      />
    )
  }

  if (loading) return (
    <Box flexDirection="column" flexGrow={1} paddingX={1}>
      <Box gap={1}><Spinner /><Text color={t.ui.muted}>Loading diff…</Text></Box>
    </Box>
  )
  if (error) return (
    <Box flexDirection="column" flexGrow={1} paddingX={1}>
      <Text color={t.ci.fail}>⚠ Failed to load diff — r to retry</Text>
    </Box>
  )

  const colWidth = Math.floor(((stdout?.columns || 80) - 2) / 2)
  // Always reserve COMPOSE_HEIGHT rows so the diff never jumps when compose opens/closes
  const COMPOSE_HEIGHT  = 6
  const effectiveHeight = Math.max(3, visibleHeight - COMPOSE_HEIGHT)
  // No row cap — virtual slice keeps rendering O(visibleHeight) regardless of diff size
  const visibleRows = rows.slice(scrollOffset, scrollOffset + effectiveHeight)

  return (
    <Box flexDirection="column" flexGrow={1}>
      <Box paddingX={1} justifyContent="space-between">
        <Text color={t.ui.selected} bold>PR #{prNumber} Diff</Text>
        {commentStatus && <Text color={t.ci.pass}>{commentStatus}</Text>}
        {splitView && <Text color={t.ui.muted}>[split]</Text>}
        <Text color={t.ui.dim}>{cursor + 1} / {rows.length}</Text>
      </Box>

      <Box flexDirection="row" flexGrow={1} overflow="hidden">
        {/* File tree side pane — 24 cols, persistent when showTree */}
        {showTree && (
          <Box width={24} flexDirection="column" borderStyle="single" borderColor={t.ui.border} overflow="hidden">
            <Box paddingX={1}>
              <Text color={t.ui.selected} bold>Files </Text>
              <Text color={t.ui.dim}>{files.length}</Text>
            </Box>
            <Box flexDirection="column" flexGrow={1} overflow="hidden">
              {treeRows.map((treeRow, i) => {
                const isTreeSelected = i === treeCursor
                const fileGlyph = treeRow.type === 'dir' ? '▸' : '●'
                return (
                  <Box key={i} backgroundColor={isTreeSelected ? t.ui.headerBg : undefined} paddingX={1}>
                    <Text color={isTreeSelected ? t.ui.selected : (treeRow.type === 'dir' ? t.ui.muted : t.diff.ctxFg)} wrap="truncate">
                      {treeRow.prefix.replace(/[─└├│]/g, c => ({ '─': '─', '└': '└', '├': '├', '│': '│' }[c] || c))}{fileGlyph} {treeRow.name}
                    </Text>
                  </Box>
                )
              })}
            </Box>
          </Box>
        )}
        {/* Diff content */}
        <Box flexDirection="column" flexGrow={1} overflow="hidden">
          {splitView
            ? renderSplitView(rows, scrollOffset, effectiveHeight, cursor, langCache, colWidth, t)
            : visibleRows.map((row, i) => {
                const idx = scrollOffset + i
                const isSelected = idx === cursor
                const isMatch = findQuery ? findMatches.includes(idx) : false
                const lang = langCache.get(row.filename)
                const lineNum = row.newLine ?? row.oldLine
                const lineKey = `${row.filename}:${lineNum}`
                const hasComment = row.filename && lineNum != null &&
                  commentsByLine.has(lineKey)
                return (
                  <Box key={idx} flexDirection="column">
                    <DiffLine row={row} isSelected={isSelected} lang={lang} isMatch={isMatch} t={t} />
                    {hasComment && (
                      <Box paddingX={1} flexDirection="column" borderStyle="single" borderColor={t.diff.threadBorder}>
                        <CommentThread comments={commentsByLine.get(lineKey)} t={t} />
                      </Box>
                    )}
                  </Box>
                )
              })
          }
        </Box>
      </Box>

      {fileJumpActive && (
        <Box flexDirection="column" borderStyle="round" borderColor={t.ui.selected} paddingX={1} marginX={1}>
          <FuzzySearch
            items={files.map(f => ({ name: f.filename }))}
            searchFields={['name']}
            onSubmit={(item) => {
              const fileIdx = fileStartIndices[files.findIndex(f => f.filename === item.name)]
              if (fileIdx != null) jumpTo(fileIdx)
              setFileJumpActive(false)
            }}
            onCancel={() => setFileJumpActive(false)}
          />
        </Box>
      )}

      {aiReviewLoading && (
        <Box borderStyle="round" borderColor={t.ui.selected} paddingX={2} marginX={1}>
          <Text color={t.ui.muted}>Analyzing diff with Claude…</Text>
        </Box>
      )}

      {aiReviewError && (
        <Box borderStyle="round" borderColor={t.ci.fail} paddingX={2} marginX={1}>
          <Text color={t.ci.fail}>{aiReviewError}</Text>
        </Box>
      )}

      {aiReview && (
        <AIReviewPane
          suggestions={aiReview.suggestions}
          summary={aiReview.summary}
          onJumpTo={handleAiJumpTo}
          onPost={handleAiPost}
          onClose={() => { setAiReview(null); setAiReviewError(null); setAiPostStatus(null) }}
          postStatus={aiPostStatus}
          onOpenEditor={openEditorSync}
        />
      )}

      {findActive && (
        <Box borderStyle="round" borderColor={t.ui.selected} paddingX={1} marginX={1}>
          <Text color={t.ui.dim}>/</Text>
          <TextInput
            value={findQuery}
            onChange={setFindQuery}
            focus={true}
          />
          <Text color={t.ui.dim}>  {findMatches.length > 0 ? `${findMatches.indexOf(cursor) + 1 || '?'}/${findMatches.length}` : 'no matches'}  [n/N] jump  [Enter] done  [Esc] clear</Text>
        </Box>
      )}
      {!findActive && findQuery && (
        <Box paddingX={2}>
          <Text color={t.ui.dim}>/ {findQuery}  ({findMatches.length} matches)  [n/N] jump  [/] edit  [Esc] clear</Text>
        </Box>
      )}

      {gotoActive && (
        <Box borderStyle="round" borderColor={t.ui.selected} paddingX={1} marginX={1}>
          <Text color={t.ui.dim}>:</Text>
          <TextInput
            value={gotoInput}
            onChange={setGotoInput}
            focus={true}
          />
          <Text color={t.ui.dim}>  go to line — [Enter] jump  [Esc] cancel</Text>
        </Box>
      )}

      {compose && (() => {
        const row = rows[cursor]
        if (compose.mode === 'delete') {
          return (
            <Box flexDirection="column" flexGrow={1} borderStyle="round" borderColor={t.ci.fail} paddingX={1}>
              <Text color={t.ci.fail} bold>Delete comment?</Text>
              <Text color={t.ui.dim} wrap="truncate">  "{stripAnsi(compose.commentBody || '').slice(0, 70)}"</Text>
              <Text color={t.ui.dim}>[y] confirm  [n / Esc] cancel</Text>
            </Box>
          )
        }
        if (compose.mode === 'reply') {
          return (
            <Box flexDirection="column" flexGrow={1} borderStyle="round" borderColor={t.diff.threadBorder} paddingX={1}>
              <Text color={t.ui.muted} bold>Reply to thread</Text>
              <Box>
                <TextInput
                  value={compose.body}
                  onChange={(v) => setCompose(c => ({ ...c, body: v }))}
                  focus={true}
                  placeholder="Type your reply…"
                />
              </Box>
              <Text color={t.ui.dim}>[Ctrl+G] send  [Ctrl+E] editor  [Esc] cancel</Text>
            </Box>
          )
        }
        if (compose.mode === 'edit') {
          return (
            <Box flexDirection="column" flexGrow={1} borderStyle="round" borderColor={t.diff.threadBorder} paddingX={1}>
              <Text color={t.ui.muted} bold>Edit comment</Text>
              <TextInput value={compose.body} onChange={(v) => setCompose(c => ({ ...c, body: v }))} focus={true} />
              <Text color={t.ui.dim}>[Ctrl+G] save  [Ctrl+E] editor  [Esc] cancel</Text>
            </Box>
          )
        }
        // mode === 'new'
        return (
          <Box flexDirection="column"
            borderStyle="round" borderColor={t.diff.threadBorder}
            paddingX={1} marginX={1} marginBottom={0}>
            <Box gap={1}>
              <Text color={t.ui.dim}>❯ Line {row?.newLine ?? row?.oldLine}</Text>
              <Text color={t.diff.ctxFg} wrap="truncate">{(row?.text || '').slice(0, 60)}</Text>
            </Box>
            <Box gap={3}>
              {COMMENT_TYPES.map(type => {
                const isActive = compose.commentType === type
                return (
                  <Text key={type} color={isActive ? t.ui.selected : t.ui.dim} bold={isActive}>
                    {isActive ? '[' : ' '}{type}{isActive ? ']' : ' '}
                  </Text>
                )
              })}
            </Box>
            <Box>
              {!compose.body && <Text color={t.ui.dim} italic>Type your comment. Ctrl+E for $EDITOR.</Text>}
              <TextInput value={compose.body} onChange={(v) => setCompose(c => ({ ...c, body: v }))} focus={true} />
              {!compose.body && <Text color={t.ui.selected}>▍</Text>}
            </Box>
            <Text color={t.ui.dim}>[Tab] type  [Ctrl+G] submit  [Ctrl+E] editor  [Esc] cancel</Text>
          </Box>
        )
      })()}
      <FooterKeys keys={splitView ? FOOTER_KEYS_SPLIT : FOOTER_KEYS_UNIFIED} />
    </Box>
  )
}
