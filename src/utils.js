import React, { useState, useEffect } from 'react'
import { Box, Text, useInput } from 'ink'
import { join, isAbsolute } from 'path'
import { homedir } from 'os'

/**
 * Resolves paths starting with ~/ or relative paths.
 */
export function resolvePath(p) {
  if (!p) return p
  if (p.startsWith('~/')) return join(homedir(), p.slice(2))
  if (isAbsolute(p)) return p
  return join(process.cwd(), p)
}
import { t } from './theme.js'

/**
 * src/utils.js — shared utility functions
 */

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
  return stripAnsi(str || '')
}

import hljs from 'highlight.js'
import chalk from 'chalk'

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
  try {
    const highlighted = lang ? hljs.highlight(code, { language: lang }) : hljs.highlightAuto(code)
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
    return code
  }
}

export function getMarkdownRows(text, maxWidth = 80) {
  if (!text) return []

  const lines = text.split('\n')
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
          <Text>{renderInline(content)}</Text>
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
          <Text>{renderInline(wl)}</Text>
        </Box>
      )
    })
  })

  return rows
}

function wrapLine(text, width) {
  const words = text.split(' ')
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

function renderInline(text) {
  // Simple regex for bold and italic
  let parts = [text]
  
  // Bold **text**
  const boldRegex = /\*\*(.*?)\*\*/g
  // Italic *text*
  const italicRegex = /\*(.*?)\*/g
  // Inline code `text`
  const codeRegex = /`(.*?)`/g

  // This is a very basic inline renderer. For a production TUI, 
  // we'd use a real Markdown AST parser.
  return text.split(/(`.*?`|\*\*.*?\*\*|\*.*?\*)/g).map((part, i) => {
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
export function TextInput({ value, onChange, placeholder, focus, mask, onEnter }) {
  const [cursor, setCursor] = useState(value?.length || 0)

  // Sync cursor if value changes externally
  useEffect(() => {
    if (cursor > value?.length) setCursor(value?.length || 0)
  }, [value, cursor])

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
      setCursor(c => Math.min(value.length, c + 1))
      return
    }

    if (key.ctrl && input === 'a') { // Ctrl+A: start of line
      setCursor(0)
      return
    }
    if (key.ctrl && input === 'e') { // Ctrl+E: end of line
      setCursor(value.length)
      return
    }
    if (key.ctrl && input === 'u') { // Ctrl+U: clear line
      onChange('')
      setCursor(0)
      return
    }
    if (key.ctrl && input === 'k') { // Ctrl+K: clear to end of line
      onChange(value.slice(0, cursor))
      return
    }

    if (key.backspace || key.delete) {
      if (cursor > 0) {
        const nextValue = value.slice(0, cursor - 1) + value.slice(cursor)
        onChange(nextValue)
        setCursor(c => c - 1)
      }
      return
    }

    if (input && !key.ctrl && !key.meta) {
      const nextValue = value.slice(0, cursor) + input + value.slice(cursor)
      onChange(nextValue)
      setCursor(c => c + input.length)
    }
  })

  const renderedValue = mask ? mask.repeat(value.length) : value
  const beforeCursor = renderedValue.slice(0, cursor)
  const atCursor = renderedValue.slice(cursor, cursor + 1) || ' '
  const afterCursor = renderedValue.slice(cursor + 1)

  return (
    <Box>
      {value.length === 0 && !focus ? (
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
