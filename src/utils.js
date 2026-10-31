// @ts-nocheck
// TODO(#197): legacy Ink markdown/chalk utilities need dedicated JS typedef cleanup.
/**
 * src/utils.js — shared utility functions
 */

/* eslint-disable no-unused-vars */
import React, { useState, useEffect } from 'react'
import { Box, Text, useInput } from 'ink'
/* eslint-enable no-unused-vars */
import chalk from 'chalk'
import { getHljs } from './highlight.js'
import stringWidth from 'string-width'
import { useTheme } from './theme.js'
import { sanitize } from './utils-core.js'

export { logger, getLogs, resolvePath, stripAnsi, decodeHtmlEntities, sanitize } from './utils-core.js'

/**
 * Copy text to the system clipboard using platform-native tools.
 * Uses pbcopy (macOS), clip (Windows), or xclip (Linux).
 * @param {string} text - The text to copy.
 * @returns {Promise<import('execa').ExecaChildProcess>} Promise resolving when copy completes.
 */
export function copyToClipboard(text) {
  return import('execa').then(({ execa }) => {
    const [cmd, args] =
      process.platform === 'darwin' ? ['pbcopy', []] :
      process.platform === 'win32'  ? ['clip',   []] :
                                      ['xclip',  ['-selection', 'clipboard']]
    const proc = execa(cmd, args)
    proc.stdin?.end(text)
    return proc
  })
}

/**
 * Safely applies a color (hex or keyword) to a chalk instance.
 * @param {string} color - Hex code or chalk color name.
 * @returns {import('chalk').Chalk} A chalk style function.
 */
export function colorChalk(color) {
  if (typeof color !== 'string' || !color) return chalk.reset
  if (color.startsWith('#')) return chalk.hex(color)
  if (typeof chalk[color] === 'function') return chalk[color]
  try { return chalk.keyword(color) } catch { return chalk.reset }
}

/**
 * Safely applies a background color (hex or keyword) to a chalk instance.
 * @param {string} color - Hex code or chalk color name.
 * @returns {import('chalk').Chalk} A chalk style function.
 */
export function bgColorChalk(color) {
  if (typeof color !== 'string' || !color) return chalk.reset
  if (color.startsWith('#')) return chalk.bgHex(color)
  const bgName = 'bg' + color.charAt(0).toUpperCase() + color.slice(1).replace('grey', 'Gray')
  if (typeof chalk[bgName] === 'function') return chalk[bgName]
  try { return chalk.bgKeyword(color) } catch { return chalk.reset }
}

/**
 * Safely applies foreground and background colors to a string using chalk.
 * @param {string} text - The text to style.
 * @param {string} [fg] - Foreground color (hex or name).
 * @param {string} [bg] - Background color (hex or name).
 * @returns {string} The styled string.
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

/**
 * Internal helper to highlight code using highlight.js and convert to ANSI.
 * @param {string} code - Raw code to highlight.
 * @param {string} [lang] - Language identifier.
 * @returns {string} ANSI styled code string.
 */
function highlightCode(code, lang) {
  const safeCode = String(code || '')
  try {
    const hljs = getHljs()
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

/**
 * Converts markdown text into an array of Ink Box/Text elements.
 * Handles headers, lists, code blocks (with syntax highlighting), and paragraphs.
 * @param {string} text - The markdown content.
 * @param {number} [maxWidth=80] - Maximum width for word wrapping.
 * @param {Object} t - The theme object.
 * @returns {Array<import('react').ReactElement>} Array of Ink elements.
 */
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

/**
 * Word-wraps a string into multiple lines.
 * @param {string} text - The input text.
 * @param {number} width - Maximum character width.
 * @returns {Array<string>} Array of wrapped lines.
 */
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

/**
 * Renders inline markdown styles (bold, italic, code) into Ink components.
 * @param {string} text - The inline text.
 * @param {Object} t - The theme object.
 * @returns {Array<import('react').ReactElement>} Array of Ink elements.
 */
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
 * Returns a compact age string ≤4 chars for list row timestamps.
 * @param {string|number|Date} ts
 */
export function shortAge(ts) {
  if (!ts) return '    '
  const s = Math.floor((Date.now() - new Date(ts).getTime()) / 1000)
  if (s < 60)         return 'now'
  if (s < 3600)       return `${Math.floor(s / 60)}m`
  if (s < 86400)      return `${Math.floor(s / 3600)}h`
  if (s < 86400 * 14) return `${Math.floor(s / 86400)}d`
  if (s < 86400 * 60) return `${Math.floor(s / (86400 * 7))}w`
  if (s < 86400 * 365) return `${Math.floor(s / (86400 * 30))}mo`
  return `${Math.floor(s / (86400 * 365))}y`
}

/**
 * A basic text input component with cursor support and common shortcuts.
 * @param {Object} props - Component props.
 * @param {string} props.value - Current input value.
 * @param {Function} props.onChange - Callback on value change.
 * @param {string} [props.placeholder] - Text to show when empty.
 * @param {boolean} [props.focus] - Whether the input is active.
 * @param {string} [props.mask] - Optional character for masking.
 * @param {Function} [props.onEnter] - Callback on Enter keypress.
 * @returns {import('react').ReactElement} The rendered Ink component.
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

/**
 * Return the display width of a string in a terminal, accounting for wide
 * characters (CJK ideographs, emoji, etc. which occupy 2 columns each) and
 * zero-width characters (combiners, ZWJ, VS-16, etc. which occupy 0 columns).
 *
 * Delegates to the `string-width` npm package for full Unicode compliance,
 * including ZWJ family emoji, regional indicator flags, and variation selectors.
 *
 * @param {string} str
 * @returns {number} Visual column width
 */
export function displayWidth(str) {
  if (!str) return 0
  return stringWidth(str)
}

/**
 * Expand TAB characters to spaces at tab stops (no config key exists, default 4),
 * so width math and the terminal agree. Display-width aware for wide characters.
 * @param {string} text
 * @param {number} [width]
 */
export function expandTabs(text, width = 4) {
  if (typeof text !== 'string' || !text.includes('\t')) return text
  let out = ''
  let col = 0
  for (const ch of text) {
    if (ch === '\t') {
      const n = width - (col % width)
      out += ' '.repeat(n)
      col += n
    } else {
      out += ch
      col += stringWidth(ch)
    }
  }
  return out
}

/**
 * Truncate a string to at most `maxWidth` display columns, accounting for
 * wide characters.  Does NOT add ellipsis — callers can append if needed.
 * @param {string} str
 * @param {number} maxWidth
 * @returns {string}
 */
export function truncateToWidth(str, maxWidth) {
  if (!str || maxWidth <= 0) return ''
  let width = 0
  let result = ''
  for (const char of str) {
    const cw = displayWidth(char)
    if (width + cw > maxWidth) break
    result += char
    width += cw
  }
  return result
}

/**
 * Truncate to at most `maxWidth` display columns, ending in "…" when anything
 * was cut.  Strings that already fit are returned unchanged.
 * @param {string} str
 * @param {number} maxWidth
 * @returns {string}
 */
export function truncateEllipsis(str, maxWidth) {
  if (!str || maxWidth <= 0) return ''
  if (displayWidth(str) <= maxWidth) return str
  return truncateToWidth(str, maxWidth - 1) + '…'
}

/**
 * Fit a GitHub login into a column: drops the redundant "[bot]" suffix of app
 * accounts, then truncates with an ellipsis (never mid-name without a marker).
 * @param {string} login
 * @param {number} maxWidth
 * @returns {string}
 */
export function formatLogin(login, maxWidth) {
  return truncateEllipsis(String(login || '').replace(/\[bot\]$/, ''), maxWidth)
}

/**
 * Pad a string on the right to exactly `targetWidth` display columns.
 * Uses spaces to fill.  Wide chars are counted correctly.
 * @param {string} str
 * @param {number} targetWidth
 * @returns {string}
 */
export function padEndWidth(str, targetWidth) {
  const w = displayWidth(str)
  if (w >= targetWidth) return str
  return str + ' '.repeat(targetWidth - w)
}

/**
 * Pad a string on the left to exactly `targetWidth` display columns.
 * @param {string} str
 * @param {number} targetWidth
 * @returns {string}
 */
export function padStartWidth(str, targetWidth) {
  const w = displayWidth(str)
  if (w >= targetWidth) return str
  return ' '.repeat(targetWidth - w) + str
}

// Deterministic color from author login — 8 accent buckets, stable across renders
const _AUTHOR_COLOR_PALETTE = [
  '#7dcfff', '#7aa2f7', '#bb9af7', '#f7768e',
  '#9ece6a', '#e0af68', '#73daca', '#ff9e64',
]
/**
 * authorColor — deterministic accent color derived from a GitHub login string.
 * Returns one of 8 palette colors, stable across renders for the same login.
 *
 * @param {string} login - GitHub username / login handle
 * @returns {string|undefined} Hex color string, or undefined if login is falsy
 */
export function authorColor(login) {
  if (!login) return undefined
  const h = [...String(login)].reduce((a, c) => a + c.charCodeAt(0), 0)
  return _AUTHOR_COLOR_PALETTE[h % _AUTHOR_COLOR_PALETTE.length]
}

// eslint-disable-next-line no-control-regex
const CONTROL_CHARS_RE = /[\x00-\x08\x0b-\x1f\x7f-\x9f]/g

/**
 * Make one line of untrusted log text safe to draw (#463): ANSI and entities go
 * through sanitize(), TABs expand to tab stops (so columns stay aligned and the
 * frame cannot break), and any other control character is dropped.
 * @param {string} line
 * @returns {string}
 */
export function cleanLogLine(line) {
  return sanitize(expandTabs(String(line ?? ''))).replace(CONTROL_CHARS_RE, '')
}
