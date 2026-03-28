/**
 * src/utils.js — shared utility functions
 */

import React, { useState, useEffect } from 'react'
import { Box, Text, useInput } from 'ink'
import { appendFileSync, readFileSync, existsSync, mkdirSync, writeFileSync } from 'fs'
import { join, isAbsolute, dirname } from 'path'
import { homedir, tmpdir } from 'os'
import chalk from 'chalk'
import hljs from 'highlight.js'
import { ThemeProvider, useTheme } from './theme.js'

const LOG_FILE = join(homedir(), '.config', 'lazyhub', 'debug.log')

/**
 * Global logger for debugging.
 */
export const logger = {
  info:  (msg) => log('INFO', msg),
  error: (msg, err) => log('ERROR', `${msg}${err ? `\n${err.stack || err}` : ''}`),
  debug: (msg) => log('DEBUG', msg),
}

function log(level, msg) {
  try {
    const timestamp = new Date().toISOString()
    const line = `[${timestamp}] [${level}] ${msg}\n`
    // Ensure dir exists
    const dir = dirname(LOG_FILE)
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    appendFileSync(LOG_FILE, line, 'utf8')
  } catch {
    // ignore logging failures
  }
}

/**
 * Resolves paths starting with ~/ or relative paths.
 */
export function resolvePath(p) {
  if (!p) return p
  if (typeof p !== 'string') return p
  if (p.startsWith('~/')) return join(homedir(), p.slice(2))
  if (isAbsolute(p)) return p
  return join(process.cwd(), p)
}

/**
 * Strips ANSI escape codes from a string to prevent Terminal Injection.
 */
export function stripAnsi(str) {
  if (typeof str !== 'string') return str
  // eslint-disable-next-line no-control-regex
  return str.replace(/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g, '')
}

/**
 * Sanitize untrusted text for rendering.
 * Strips ANSI codes and potentially other dangerous characters.
 */
export function sanitize(str) {
  return stripAnsi(String(str || ''))
}

/**
 * Safely applies a color (hex or keyword) to a chalk instance.
 */
export function colorChalk(color) {
  if (typeof color !== 'string' || !color) return chalk.reset
  if (color.startsWith('#')) return chalk.hex(color)
  if (typeof chalk[color] === 'function') return chalk[color]
  try { return chalk.keyword(color) } catch { return chalk.reset }
}

/**
 * Safely applies a background color (hex or keyword) to a chalk instance.
 */
export function bgColorChalk(color) {
  if (typeof color !== 'string' || !color) return chalk.reset
  if (color.startsWith('#')) return chalk.bgHex(color)
  const bgName = 'bg' + color.charAt(0).toUpperCase() + color.slice(1).replace('grey', 'Gray')
  if (typeof chalk[bgName] === 'function') return chalk[bgName]
  try { return chalk.bgKeyword(color) } catch { return chalk.reset }
}

/**
 * Safely applies foreground and background colors (hex or keyword) to a string using chalk.
 */
export function applyThemeStyle(text, fg, bg) {
  const safeText = String(text ?? '')
  let s = chalk
  if (typeof fg === 'string' && fg) {
    if (fg.startsWith('#')) s = s.hex(fg)
    else if (typeof s[fg] === 'function') s = s[fg]
    else s = s.keyword(fg)
  }
  if (typeof bg === 'string' && bg) {
    if (bg.startsWith('#')) s = s.bgHex(bg)
    else {
      const bgName = 'bg' + bg.charAt(0).toUpperCase() + bg.slice(1).replace('grey', 'Gray')
      if (typeof s[bgName] === 'function') s = s[bgName]
      else s = s.bgKeyword(bg)
    }
  }
  return s(safeText)
}

/**
 * Maps highlight.js scope names to chalk styles for TUI rendering.
 */
const themeMap = {
  keyword: chalk.magenta,
  string: chalk.green,
  number: chalk.yellow,
  comment: chalk.gray,
  function: chalk.blue,
  class: chalk.cyan,
  'attr-name': chalk.yellow,
  'attr-value': chalk.green,
  tag: chalk.blue,
}

function highlightCode(code, lang) {
  const safeCode = String(code || '')
  try {
    const highlighted = lang ? hljs.highlight(safeCode, { language: lang }) : hljs.highlightAuto(safeCode)
    // This is a very simplified HTML -> ANSI converter for hljs output
    // In a real app we might want a more robust parser, but for small blocks this works.
    return highlighted.value
      .replace(/<span class="hljs-(.*?)">([\s\S]*?)<\/span>/g, (_, type, content) => {
        const style = themeMap[type] || ((s) => s)
        // Handle nested spans recursively if needed, but usually hljs is flat enough
        return style(content.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&'))
      })
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
  } catch {
    return safeCode
  }
}

export function getMarkdownRows(text, maxWidth = 80, t) {
  const safeText = String(text || '')
  if (!safeText) return []

  const lines = safeText.split('\n')
  const rows = []
  let inCodeBlock = false
  let codeBuffer = []
  let codeLang = ''

  lines.forEach((line, i) => {
    if (line.startsWith('```')) {
      if (inCodeBlock) {
        // End of block
        const code = codeBuffer.join('\n')
        const highlighted = highlightCode(code, codeLang)
        highlighted.split('\n').forEach((hl, j) => {
          rows.push(
            <Box key={`code-${i}-${j}`} paddingX={1} backgroundColor={t.ui.headerBg}>
              <Text>{hl || ' '}</Text>
            </Box>
          )
        })
        codeBuffer = []
        inCodeBlock = false
      } else {
        // Start of block
        inCodeBlock = true
        codeLang = line.slice(3).trim()
      }
      return
    }

    if (inCodeBlock) {
      codeBuffer.push(line)
      return
    }

    // Headers
    if (line.startsWith('#')) {
      const level = line.match(/^#+/)[0].length
      const content = line.replace(/^#+\s*/, '')
      rows.push(
        <Box key={`h-${i}`} marginBottom={0} marginTop={0} paddingX={1}>
          <Text bold color={t.ui.selected} underline={level === 1}>
            {level === 1 ? content.toUpperCase() : content}
          </Text>
        </Box>
      )
      return
    }

    // List items
    if (line.trim().startsWith('* ') || line.trim().startsWith('- ') || /^\d+\.\s/.test(line.trim())) {
      const content = line.trim().replace(/^[*-\d.]+\s+/, '')
      rows.push(
        <Box key={`li-${i}`} paddingLeft={2} paddingX={1}>
          <Text color={t.ui.muted}>• </Text>
          <Text>{renderInline(content, t)}</Text>
        </Box>
      )
      return
    }

    // Blank lines
    if (!line.trim()) {
      rows.push(<Box key={`br-${i}`} height={1} />)
      return
    }

    // Regular paragraphs (with simple word wrap)
    const wrappedLines = wrapLine(line, maxWidth)
    wrappedLines.forEach((wl, j) => {
      rows.push(
        <Box key={`p-${i}-${j}`} paddingX={1}>
          <Text>{renderInline(wl, t)}</Text>
        </Box>
      )
    })
  })

  return rows
}

function wrapLine(text, width) {
  const safeText = String(text || '')
  if (width <= 0) return [safeText]
  const words = safeText.split(' ')
  const lines = []
  let currentLine = ''

  words.forEach(word => {
    if ((currentLine + word).length > width) {
      lines.push(currentLine.trim())
      currentLine = word + ' '
    } else {
      currentLine += word + ' '
    }
  })
  lines.push(currentLine.trim())
  return lines
}

function renderInline(text, t) {
  const safeText = String(text || '')
  // Simple regex for bold and italic
  
  // This is a very basic inline renderer. For a production TUI, 
  // we'd use a real Markdown AST parser.
  return safeText.split(/(`.*?`|\*\*.*?\*\*|\*.*?\*)/g).map((part, i) => {
    if (part.startsWith('`') && part.endsWith('`')) {
      return <Text key={i} color={t.ci.pending} backgroundColor={t.ui.headerBg}> {part.slice(1, -1)} </Text>
    }
    if (part.startsWith('**') && part.endsWith('**')) {
      return <Text key={i} bold>{part.slice(2, -2)}</Text>
    }
    if (part.startsWith('*') && part.endsWith('*')) {
      return <Text key={i} italic>{part.slice(1, -1)}</Text>
    }
    return <Text key={i}>{part}</Text>
  })
}

/**
 * A basic text input component with cursor support and common shortcuts.
 */
export function TextInput({ value = '', onChange, placeholder, focus, mask, onEnter }) {
  const { t } = useTheme()
  const safeValue = String(value || '')
  const [cursor, setCursor] = useState(safeValue.length)

  // Sync cursor if value changes externally
  useEffect(() => {
    if (cursor > safeValue.length) setCursor(safeValue.length)
  }, [safeValue, cursor])

  useInput((input, key) => {
    if (!focus) return

    if (key.return) {
      if (onEnter) onEnter()
      return
    }

    if (key.leftArrow) {
      setCursor(c => Math.max(0, c - 1))
      return
    }
    if (key.rightArrow) {
      setCursor(c => Math.min(safeValue.length, c + 1))
      return
    }

    if (key.ctrl && input === 'a') { // Ctrl+A: start of line
      setCursor(0)
      return
    }
    if (key.ctrl && input === 'e') { // Ctrl+E: end of line
      setCursor(safeValue.length)
      return
    }
    if (key.ctrl && input === 'u') { // Ctrl+U: clear line
      if (onChange) onChange('')
      setCursor(0)
      return
    }
    if (key.ctrl && input === 'k') { // Ctrl+K: clear to end of line
      if (onChange) onChange(safeValue.slice(0, cursor))
      return
    }

    if (key.backspace || key.delete) {
      if (cursor > 0) {
        const nextValue = safeValue.slice(0, cursor - 1) + safeValue.slice(cursor)
        if (onChange) onChange(nextValue)
        setCursor(c => c - 1)
      }
      return
    }

    if (input && !key.ctrl && !key.meta) {
      const nextValue = safeValue.slice(0, cursor) + input + safeValue.slice(cursor)
      if (onChange) onChange(nextValue)
      setCursor(c => c + input.length)
    }
  })

  const renderedValue = mask ? mask.repeat(safeValue.length) : safeValue
  const beforeCursor = renderedValue.slice(0, cursor)
  const atCursor = renderedValue.slice(cursor, cursor + 1) || ' '
  const afterCursor = renderedValue.slice(cursor + 1)

  return (
    <Box>
      {safeValue.length === 0 && !focus ? (
        <Text color={t.ui.dim}>{placeholder}</Text>
      ) : (
        <Box>
          <Text>{beforeCursor}</Text>
          <Text backgroundColor={focus ? t.ui.selected : undefined} color={focus ? 'black' : undefined}>
            {atCursor}
          </Text>
          <Text>{afterCursor}</Text>
        </Box>
      )}
    </Box>
  )
}
