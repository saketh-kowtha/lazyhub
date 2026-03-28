/**
 * src/features/prs/diff.jsx — PR diff view with syntax highlighting + line comments
 */

import React, { useState, useMemo, useRef, useCallback } from 'react'
import { Box, Text, useInput, useStdout } from 'ink'
import chalk from 'chalk'
import hljs from 'highlight.js'
import { format } from 'timeago.js'
import { useGh } from '../../hooks/useGh.js'
import { getPRDiff, listPRComments, addPRLineComment, getPRDiffStats, getPR as getPRMeta } from '../../executor.js'
import { OptionPicker } from '../../components/dialogs/OptionPicker.jsx'
import { FooterKeys } from '../../components/FooterKeys.jsx'
import { loadConfig } from '../../config.js'
import { t } from '../../theme.js'

const _diffCfg = loadConfig().diff

// ─── Language detection ───────────────────────────────────────────────────────

const EXT_LANG = {
  js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript',
  ts: 'typescript', tsx: 'typescript',
  py: 'python',     rb: 'ruby',        go: 'go',          rs: 'rust',
  java: 'java',     kt: 'kotlin',      swift: 'swift',    cs: 'csharp',
  c: 'c',           cpp: 'cpp',        h: 'c',
  sh: 'bash',       bash: 'bash',      zsh: 'bash',
  json: 'json',     yaml: 'yaml',      yml: 'yaml',
  md: 'markdown',   html: 'xml',       xml: 'xml',        css: 'css',
  sql: 'sql',       graphql: 'graphql',
}

function getLang(filename) {
  if (!filename) return null
  const ext = filename.split('.').pop()?.toLowerCase()
  return EXT_LANG[ext] || null
}

// ─── hljs HTML → chalk ───────────────────────────────────────────────────────
// Converts highlight.js HTML output to chalk-colored terminal strings.
// Preserves the bgColor on every character so the add/del background shows through.

const CLS_COLOR = {
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

function htmlToChalk(html, bgColor) {
  const parts = []
  const colorStack = []
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
        parts.push(bgColor ? chalk.bgHex(bgColor).hex(fg)(text) : chalk.hex(fg)(text))
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
      const color = cls ? (CLS_COLOR[cls] ?? CLS_COLOR[cls.split(' ')[0]] ?? null) : null
      colorStack.push(color)
    }
    i = end + 1
  }

  return parts.join('')
}

function syntaxHighlight(code, lang, bgColor) {
  if (!lang) {
    return bgColor
      ? chalk.bgHex(bgColor).hex(t.syntax.default)(code)
      : chalk.hex(t.syntax.default)(code)
  }
  try {
    const { value } = hljs.highlight(code, { language: lang, ignoreIllegals: true })
    return htmlToChalk(value, bgColor)
  } catch {
    return bgColor
      ? chalk.bgHex(bgColor).hex(t.syntax.default)(code)
      : chalk.hex(t.syntax.default)(code)
  }
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
//
// cursor is a dedicated leading column — always visible regardless of the
// per-character bg colors already applied to the rest of the line.
// chalk.bgHex(cursorBg)(fullLine) doesn't work on lines that already carry
// per-character chalk bg colors, so we use a ▶ prefix instead.

function renderDiffLine(row, isSelected, langCache, isMatch) {
  let cur
  if (isSelected) {
    cur = chalk.bgHex(t.diff.cursorBg).hex('#ffffff').bold('▶')
  } else if (isMatch) {
    cur = chalk.hex('#e3b341')('◆')
  } else {
    cur = ' '
  }

  const gutterOld = row.oldLine != null ? String(row.oldLine).padStart(4) : '    '
  const gutterNew = row.newLine != null ? String(row.newLine).padStart(4) : '    '

  if (row.type === 'file-header') {
    const line =
      chalk.hex(t.ui.selected).bold(`━━ ${row.filename} `) +
      chalk.hex(t.ci.pass)(`+${row.addCount}`) +
      chalk.hex(t.syntax.default)(' / ') +
      chalk.hex(t.ci.fail)(`-${row.delCount}`)
    return cur + line
  }

  if (row.type === 'hunk') {
    return cur + chalk.bgHex(t.diff.hunkBg).hex(t.diff.hunkFg)(
      `${gutterOld}${gutterNew}   ${row.text}`
    )
  }

  const lang = langCache.get(row.filename)

  if (row.type === 'add') {
    const signFg = isSelected ? '#ffffff' : t.diff.addSign
    const sign   = isSelected ? '▶' : '+'
    const gutter = chalk.bgHex(t.diff.addBg).hex(signFg)(`${gutterOld}${gutterNew} ${sign} `)
    return cur + gutter + syntaxHighlight(row.text, lang, t.diff.addBg)
  }

  if (row.type === 'del') {
    const signFg = isSelected ? '#ffffff' : t.diff.delSign
    const sign   = isSelected ? '▶' : '-'
    const gutter = chalk.bgHex(t.diff.delBg).hex(signFg)(`${gutterOld}${gutterNew} ${sign} `)
    return cur + gutter + syntaxHighlight(row.text, lang, t.diff.delBg)
  }

  // ctx — highlight the full gutter+code with cursor bg when selected
  const bgGutter = isSelected
    ? chalk.bgHex(t.diff.cursorBg).hex(t.ui.selected)(`${gutterOld}${gutterNew}   `)
    : chalk.hex(t.ui.dim)(`${gutterOld}${gutterNew}   `)
  const code = syntaxHighlight(row.text, lang, isSelected ? t.diff.cursorBg : null)
  return cur + bgGutter + code
}

// ─── Thread renderer ──────────────────────────────────────────────────────────

function renderThreads(comments) {
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
        <Text color={t.ui.dim}>{format(comment.createdAt)}</Text>
      </Box>
    )
    // Body lines
    const bodyLines = (comment.body || '').split('\n')
    for (let i = 0; i < bodyLines.length; i++) {
      elements.push(
        <Box key={`${comment.id}-body-${i}`}>
          <Text color={t.diff.threadBorder}>┃ </Text>
          <Text wrap="truncate">{bodyLines[i]}</Text>
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
          <Text color={t.ui.dim}>{format(reply.createdAt)}</Text>
        </Box>
      )
      const replyLines = (reply.body || '').split('\n')
      for (let i = 0; i < replyLines.length; i++) {
        elements.push(
          <Box key={`${reply.id}-body-${i}`}>
            <Text color={t.diff.threadBorder}>┃   </Text>
            <Text wrap="truncate">{replyLines[i]}</Text>
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
  { key: ':',    label: 'go to line' },
  { key: 'c',    label: 'comment' },
  { key: 'n/N',  label: 'next/prev thread or match' },
  { key: 'v',    label: 'comments' },
  { key: 's',    label: 'split view' },
  { key: 't',    label: 'file tree' },
  { key: '/',    label: 'find' },
  { key: 'Esc',  label: 'back' },
]

const FOOTER_KEYS_SPLIT = [
  { key: 'j/k',  label: 'scroll' },
  { key: 'gg/G', label: 'top/bottom' },
  { key: ']/[',  label: 'file' },
  { key: ':',    label: 'go to line' },
  { key: 'c',    label: 'comment' },
  { key: 'n/N',  label: 'next/prev thread or match' },
  { key: 'v',    label: 'comments' },
  { key: 's',    label: 'unified view' },
  { key: 't',    label: 'file tree' },
  { key: '/',    label: 'find' },
  { key: 'Esc',  label: 'back' },
]

// ─── Split view renderer ──────────────────────────────────────────────────────

function renderSplitView(rows, scrollOffset, visibleHeight, cursor, langCache, colWidth) {
  const result = []
  const slice = rows.slice(scrollOffset, scrollOffset + visibleHeight)

  let i = 0
  while (i < slice.length) {
    const row = slice[i]
    const idx = scrollOffset + i
    const isSelected = idx === cursor

    // Full-width rows (file-header, hunk)
    if (row.type === 'file-header' || row.type === 'hunk') {
      const rendered = renderDiffLine(row, isSelected, langCache)
      result.push(
        <Box key={idx}>
          <Text wrap="truncate">{rendered}</Text>
        </Box>
      )
      i++
      continue
    }

    if (row.type === 'ctx') {
      const lang = langCache.get(row.filename)
      const code = syntaxHighlight(row.text, lang, null)
      const gutter = chalk.hex(t.ui.dim)(`${String(row.oldLine ?? '').padStart(4)}${String(row.newLine ?? '').padStart(4)}   `)
      const line = isSelected ? chalk.bgHex(t.diff.cursorBg)(gutter + code) : gutter + code
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

      const delGutter = chalk.bgHex(t.diff.delBg).hex(t.diff.delSign)(`${String(row.oldLine ?? '').padStart(4)}     - `)
      const delCode   = syntaxHighlight(row.text, lang, t.diff.delBg)
      const delLine   = isSelected ? chalk.bgHex(t.diff.cursorBg)(delGutter + delCode) : delGutter + delCode

      if (nextRow && nextRow.type === 'add') {
        const addGutter = chalk.bgHex(t.diff.addBg).hex(t.diff.addSign)(`    ${String(nextRow.newLine ?? '').padStart(4)} + `)
        const addCode   = syntaxHighlight(nextRow.text, langCache.get(nextRow.filename), t.diff.addBg)
        const addLine   = isSelected ? chalk.bgHex(t.diff.cursorBg)(addGutter + addCode) : addGutter + addCode

        result.push(
          <Box key={idx}>
            <Box width={colWidth} overflow="hidden"><Text wrap="truncate">{delLine}</Text></Box>
            <Text color={t.ui.dim}>│</Text>
            <Box width={colWidth} overflow="hidden"><Text wrap="truncate">{addLine}</Text></Box>
          </Box>
        )
        i += 2
      } else {
        // Unpaired del
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
      // Unpaired add (del was already consumed or not present before)
      const lang = langCache.get(row.filename)
      const addGutter = chalk.bgHex(t.diff.addBg).hex(t.diff.addSign)(`    ${String(row.newLine ?? '').padStart(4)} + `)
      const addCode   = syntaxHighlight(row.text, lang, t.diff.addBg)
      const addLine   = isSelected ? chalk.bgHex(t.diff.cursorBg)(addGutter + addCode) : addGutter + addCode

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
  const { stdout } = useStdout()
  const visibleHeight = Math.max(5, (stdout?.rows || 24) - 6)

  const { data: diffStats } = useGh(getPRDiffStats, [repo, prNumber])
  const isLargeDiff = ((diffStats?.additions || 0) + (diffStats?.deletions || 0)) > 5000
  const [diffWarningAck, setDiffWarningAck] = useState(false)

  const { data: prMeta } = useGh(getPRMeta, [repo, prNumber], { ttl: 300_000 })
  const headRefOid = prMeta?.headRefOid || null
  const { data: diffText, loading, error, refetch } = useGh(getPRDiff, [repo, prNumber])
  const { data: comments } = useGh(listPRComments, [repo, prNumber])
  const [cursor, setCursor] = useState(0)
  const [scrollOffset, setScrollOffset] = useState(0)
  const [dialog, setDialog] = useState(null)
  const [compose, setCompose] = useState(null)
  // compose = { commentType: 'comment' | 'suggestion' | 'request-changes', body: '' }
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
      if (row.filename && row.newLine != null && commentsByLine.has(`${row.filename}:${row.newLine}`))
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

    // findActive — capture typing
    if (findActive) {
      if (key.escape) {
        setFindActive(false)
        setFindQuery('')
        return
      }
      if (key.return) {
        setFindActive(false)
        // Jump to first match if any
        if (findMatches.length > 0) jumpTo(findMatches[0])
        return
      }
      if (key.backspace || key.delete) {
        setFindQuery(q => q.slice(0, -1))
        return
      }
      if (input && !key.ctrl && !key.meta) {
        setFindQuery(q => q + input)
        return
      }
      return
    }

    // gotoActive — `:123` jump-to-line prompt
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
      if (key.backspace || key.delete) { setGotoInput(s => s.slice(0, -1)); return }
      if (input && /\d/.test(input)) { setGotoInput(s => s + input); return }
      return
    }

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
      if (key.leftArrow) {
        const idx = COMMENT_TYPES.indexOf(compose.commentType)
        setCompose(c => ({ ...c, commentType: COMMENT_TYPES[Math.max(0, idx - 1)] }))
        return
      }
      if (key.rightArrow) {
        const idx = COMMENT_TYPES.indexOf(compose.commentType)
        setCompose(c => ({ ...c, commentType: COMMENT_TYPES[Math.min(COMMENT_TYPES.length - 1, idx + 1)] }))
        return
      }
      if ((key.return && key.ctrl) || (key.ctrl && input === 'g')) {
        const row = rows[cursor]
        const body = compose.body.trim()
        if (body && row) {
          addPRLineComment(repo, prNumber, {
            body,
            path: row.filename,
            line: row.newLine || row.oldLine,
            side: row.type === 'del' ? 'LEFT' : 'RIGHT',
            commitId: headRefOid,
          }).then(() => {
            setCommentStatus('Comment added')
            setTimeout(() => setCommentStatus(null), 3000)
          }).catch(err => {
            setCommentStatus(`Failed: ${err.message}`)
            setTimeout(() => setCommentStatus(null), 3000)
          })
        }
        setCompose(null)
        return
      }
      if (key.backspace || key.delete) {
        setCompose(c => ({ ...c, body: c.body.slice(0, -1) }))
        return
      }
      if (input && !key.ctrl && !key.meta) {
        setCompose(c => ({ ...c, body: c.body + input }))
        return
      }
      return
    }

    if (dialog) return

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
    if (input === 'r')  { refetch(); return }
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
        setCompose({ commentType: 'comment', body: '' })
      }
      return
    }
  })

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

  if (loading) return (
    <Box flexDirection="column" flexGrow={1} paddingX={1}>
      <Text color={t.ui.muted}>Loading diff…</Text>
    </Box>
  )
  if (error) return (
    <Box flexDirection="column" flexGrow={1} paddingX={1}>
      <Text color={t.ci.fail}>⚠ Failed to load diff — r to retry</Text>
    </Box>
  )

  const colWidth = Math.floor(((stdout?.columns || 80) - 2) / 2)
  const MAX_ROWS = _diffCfg.maxLines || 2000
  const displayRows = rows.length > MAX_ROWS ? rows.slice(0, MAX_ROWS) : rows
  const composeBoxHeight = compose ? 6 : 0
  const effectiveHeight = Math.max(3, visibleHeight - composeBoxHeight)
  const visibleRows = displayRows.slice(scrollOffset, scrollOffset + effectiveHeight)

  return (
    <Box flexDirection="column" flexGrow={1}>
      <Box paddingX={1} justifyContent="space-between">
        <Text color={t.ui.selected} bold>PR #{prNumber} Diff</Text>
        {commentStatus && <Text color={t.ci.pass}>{commentStatus}</Text>}
        {splitView && <Text color={t.ui.muted}>[split]</Text>}
        <Text color={t.ui.dim}>{cursor + 1} / {rows.length}</Text>
      </Box>

      <Box flexDirection="column" flexGrow={1} overflow="hidden">
        {showTree ? (
          <>
            <Box paddingX={1} justifyContent="space-between">
              <Text color={t.ui.selected} bold>PR #{prNumber} — {files.length} files changed</Text>
              <Text color={t.ui.dim}>[t/Esc] close tree</Text>
            </Box>
            {treeRows.map((treeRow, i) => {
              const isTreeSelected = i === treeCursor
              return (
                <Box key={i} backgroundColor={isTreeSelected ? t.ui.headerBg : undefined}>
                  <Text color={isTreeSelected ? t.ui.selected : (treeRow.type === 'dir' ? t.ui.muted : t.diff.ctxFg)}>
                    {treeRow.prefix}{treeRow.name}
                  </Text>
                  {treeRow.type === 'file' && (
                    <Box marginLeft={1}>
                      <Text color={t.ci.pass}>+{treeRow.addCount}</Text>
                      <Text color={t.ui.dim}> </Text>
                      <Text color={t.ci.fail}>-{treeRow.delCount}</Text>
                    </Box>
                  )}
                </Box>
              )
            })}
          </>
        ) : (
          splitView
            ? renderSplitView(displayRows, scrollOffset, effectiveHeight, cursor, langCache, colWidth)
            : visibleRows.map((row, i) => {
                const idx = scrollOffset + i
                const isSelected = idx === cursor
                const isMatch = findQuery ? findMatches.includes(idx) : false
                const rendered = renderDiffLine(row, isSelected, langCache, isMatch)
                const lineKey = `${row.filename}:${row.newLine}`
                const hasComment = row.filename && row.newLine != null &&
                  commentsByLine.has(lineKey)
                return (
                  <Box key={idx} flexDirection="column">
                    <Text wrap="truncate">{rendered}</Text>
                    {hasComment && (
                      <Box paddingX={1} flexDirection="column" borderStyle="single" borderColor={t.diff.threadBorder}>
                        {renderThreads(commentsByLine.get(lineKey))}
                      </Box>
                    )}
                  </Box>
                )
              })
        )}
      </Box>

      {rows.length > MAX_ROWS && (
        <Box paddingX={1}>
          <Text color={t.ci.pending}>⚠ Diff truncated at {MAX_ROWS} rows — [o] open in browser for full diff</Text>
        </Box>
      )}

      {findActive && (
        <Box borderStyle="round" borderColor={t.ui.selected} paddingX={1} marginX={1}>
          <Text color={t.ui.dim}>/</Text>
          <Text color={t.ui.selected}>{findQuery}</Text>
          <Text color={t.ui.dim}>█</Text>
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
          <Text color={t.ui.selected}>{gotoInput || ' '}</Text>
          <Text color={t.ui.dim}>  go to line — [Enter] jump  [Esc] cancel</Text>
        </Box>
      )}

      {compose && (() => {
        const row = rows[cursor]
        return (
          <Box flexDirection="column"
            borderStyle="round" borderColor={t.diff.threadBorder}
            paddingX={1} marginX={1} marginBottom={0}>
            <Box gap={1}>
              <Text color={t.ui.dim}>Line {row?.newLine ?? row?.oldLine}:</Text>
              <Text color={t.diff.ctxFg} wrap="truncate">{(row?.text || '').slice(0, 60)}</Text>
            </Box>
            <Box gap={3} marginTop={0}>
              {COMMENT_TYPES.map(type => {
                const isActive = compose.commentType === type
                return (
                  <Text key={type} color={isActive ? t.ui.selected : t.ui.dim} bold={isActive}>
                    {isActive ? '● ' : '○ '}{type}
                  </Text>
                )
              })}
            </Box>
            <Box marginTop={0}>
              <Text color={t.ui.dim}>  </Text>
              <Text color={t.ui.selected}>{compose.body}</Text>
              <Text color={t.ui.dim}>█</Text>
            </Box>
            <Text color={t.ui.dim}>[←→] type  [Ctrl+G] submit  [Esc] cancel</Text>
          </Box>
        )
      })()}
      <FooterKeys keys={splitView ? FOOTER_KEYS_SPLIT : FOOTER_KEYS_UNIFIED} />
    </Box>
  )
}
