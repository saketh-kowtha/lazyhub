/**
 * src/features/prs/diff.jsx — PR diff view with syntax highlighting + line comments
 */

import React, { useState, useMemo, useRef, useCallback } from 'react'
import { Box, Text, useInput, useStdout } from 'ink'
import chalk from 'chalk'
import hljs from 'highlight.js'
import { useGh } from '../../hooks/useGh.js'
import { getPRDiff, listPRComments, addPRLineComment, getPRDiffStats } from '../../executor.js'
import { OptionPicker } from '../../components/dialogs/OptionPicker.jsx'
import { FooterKeys } from '../../components/FooterKeys.jsx'
import { t } from '../../theme.js'

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

// ─── Diff line renderer ───────────────────────────────────────────────────────
// Gutter format:  oldLn(4) newLn(4) sign(2) code

function renderDiffLine(row, isSelected, langCache) {
  const gutterOld = row.oldLine != null ? String(row.oldLine).padStart(4) : '    '
  const gutterNew = row.newLine != null ? String(row.newLine).padStart(4) : '    '

  if (row.type === 'file-header') {
    const line =
      chalk.hex(t.ui.selected).bold(`━━ ${row.filename} `) +
      chalk.hex(t.ci.pass)(`+${row.addCount}`) +
      chalk.hex(t.syntax.default)(' / ') +
      chalk.hex(t.ci.fail)(`-${row.delCount}`)
    return isSelected ? chalk.bgHex(t.diff.cursorBg)(line) : line
  }

  if (row.type === 'hunk') {
    const line = chalk.bgHex(t.diff.hunkBg).hex(t.diff.hunkFg)(
      `${gutterOld}${gutterNew}   ${row.text}`
    )
    return isSelected ? chalk.bgHex(t.diff.cursorBg)(line) : line
  }

  const lang = langCache.get(row.filename)

  if (row.type === 'add') {
    const gutter = chalk.bgHex(t.diff.addBg).hex(t.diff.addSign)(`${gutterOld}${gutterNew} + `)
    const code   = syntaxHighlight(row.text, lang, t.diff.addBg)
    const line   = gutter + code
    return isSelected ? chalk.bgHex(t.diff.cursorBg)(line) : line
  }

  if (row.type === 'del') {
    const gutter = chalk.bgHex(t.diff.delBg).hex(t.diff.delSign)(`${gutterOld}${gutterNew} - `)
    const code   = syntaxHighlight(row.text, lang, t.diff.delBg)
    const line   = gutter + code
    return isSelected ? chalk.bgHex(t.diff.cursorBg)(line) : line
  }

  // ctx — no background, full syntax highlight
  const gutter = chalk.hex(t.ui.dim)(`${gutterOld}${gutterNew}   `)
  const code   = syntaxHighlight(row.text, lang, null)
  const line   = gutter + code
  return isSelected ? chalk.bgHex(t.diff.cursorBg)(line) : line
}

// ─── Component ────────────────────────────────────────────────────────────────

const FOOTER_KEYS_UNIFIED = [
  { key: 'j/k',  label: 'scroll' },
  { key: 'gg/G', label: 'top/bottom' },
  { key: ']/[',  label: 'file' },
  { key: 'c',    label: 'comment' },
  { key: 'n/N',  label: 'thread' },
  { key: 'v',    label: 'comments' },
  { key: 's',    label: 'split view' },
  { key: 'Esc',  label: 'back' },
]

const FOOTER_KEYS_SPLIT = [
  { key: 'j/k',  label: 'scroll' },
  { key: 'gg/G', label: 'top/bottom' },
  { key: ']/[',  label: 'file' },
  { key: 'c',    label: 'comment' },
  { key: 'n/N',  label: 'thread' },
  { key: 'v',    label: 'comments' },
  { key: 's',    label: 'unified view' },
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

  const { data: diffText, loading, error, refetch } = useGh(getPRDiff, [repo, prNumber])
  const { data: comments } = useGh(listPRComments, [repo, prNumber])
  const [cursor, setCursor] = useState(0)
  const [scrollOffset, setScrollOffset] = useState(0)
  const [dialog, setDialog] = useState(null)
  const [commentStatus, setCommentStatus] = useState(null)
  const [splitView, setSplitView] = useState(false)
  const lastKeyRef  = useRef(null)
  const lastKeyTimer = useRef(null)

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

  const commentsByLine = useMemo(() => {
    const map = new Map()
    for (const c of (comments || [])) {
      const key = `${c.path}:${c.line}`
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
    if (input === 'n') {
      const next = commentThreadIndices.find(i => i > cursor)
      if (next != null) jumpTo(next)
      return
    }
    if (input === 'N') {
      const prev = [...commentThreadIndices].reverse().find(i => i < cursor)
      if (prev != null) jumpTo(prev)
      return
    }
    if (input === 's') { setSplitView(v => !v); return }

    if (input === 'c') {
      const row = rows[cursor]
      if (row && row.type !== 'file-header') setDialog('comment')
      return
    }
  })

  // ── Comment dialog ──
  if (dialog === 'comment') {
    const row = rows[cursor]
    return (
      <Box flexDirection="column" flexGrow={1}>
        <Box marginBottom={1} paddingX={1}>
          <Text color={t.ui.muted}>Commenting on: </Text>
          <Text color={t.diff.ctxFg} wrap="truncate">{row?.text}</Text>
        </Box>
        <OptionPicker
          title="Comment type"
          options={[
            { value: 'comment',         label: 'Comment',         description: 'Leave a regular comment' },
            { value: 'suggestion',      label: 'Suggestion',      description: 'Suggest a code change' },
            { value: 'request-changes', label: 'Request changes', description: 'Request changes on this PR' },
          ]}
          promptText="Comment body"
          onSubmit={async (val) => {
            const { value: _v, text } = typeof val === 'object' ? val : { value: val, text: '' }
            if (!text) { setDialog(null); return }
            try {
              await addPRLineComment(repo, prNumber, {
                body: text,
                path: row.filename,
                line: row.newLine || row.oldLine,
                side: 'RIGHT',
              })
              setCommentStatus('Comment added')
              setTimeout(() => setCommentStatus(null), 3000)
            } catch (err) {
              setCommentStatus(`Failed: ${err.message}`)
              setTimeout(() => setCommentStatus(null), 3000)
            }
            setDialog(null)
          }}
          onCancel={() => setDialog(null)}
        />
      </Box>
    )
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
  const MAX_ROWS = 2000
  const displayRows = rows.length > MAX_ROWS ? rows.slice(0, MAX_ROWS) : rows
  const visibleRows = displayRows.slice(scrollOffset, scrollOffset + visibleHeight)

  return (
    <Box flexDirection="column" flexGrow={1}>
      <Box paddingX={1} justifyContent="space-between">
        <Text color={t.ui.selected} bold>PR #{prNumber} Diff</Text>
        {commentStatus && <Text color={t.ci.pass}>{commentStatus}</Text>}
        {splitView && <Text color={t.ui.muted}>[split]</Text>}
        <Text color={t.ui.dim}>{cursor + 1} / {rows.length}</Text>
      </Box>

      <Box flexDirection="column" flexGrow={1} overflow="hidden">
        {splitView
          ? renderSplitView(displayRows, scrollOffset, visibleHeight, cursor, langCache, colWidth)
          : visibleRows.map((row, i) => {
              const idx = scrollOffset + i
              const isSelected = idx === cursor
              const rendered = renderDiffLine(row, isSelected, langCache)
              const hasComment = row.filename && row.newLine != null &&
                commentsByLine.has(`${row.filename}:${row.newLine}`)
              return (
                <Box key={idx} flexDirection="column">
                  <Text wrap="truncate">{rendered}</Text>
                  {hasComment && (
                    <Box paddingX={2} flexDirection="column" borderStyle="single" borderColor={t.diff.threadBorder}>
                      {commentsByLine.get(`${row.filename}:${row.newLine}`).map(c => (
                        <Box key={c.id} gap={1}>
                          <Text color={t.diff.threadBorder}>┃</Text>
                          <Text color={t.ui.selected} bold>{c.user?.login}</Text>
                          <Text color={t.ui.dim}>{c.body?.slice(0, 60)}</Text>
                        </Box>
                      ))}
                    </Box>
                  )}
                </Box>
              )
            })
        }
      </Box>

      {rows.length > MAX_ROWS && (
        <Box paddingX={1}>
          <Text color={t.ci.pending}>⚠ Diff truncated at {MAX_ROWS} rows — [o] open in browser for full diff</Text>
        </Box>
      )}

      <FooterKeys keys={splitView ? FOOTER_KEYS_SPLIT : FOOTER_KEYS_UNIFIED} />
    </Box>
  )
}
