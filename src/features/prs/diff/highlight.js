// @ts-nocheck
/**
 * src/features/prs/diff/highlight.js — language detection and cached terminal syntax highlighting.
 */

import { getHljs } from '../../../highlight.js'
import { applyThemeStyle } from '../../../utils.js'

/** Resolve a filename extension to a supported highlight language.
 * @param {string} filename
 * @returns {string|null} language identifier
 */
export function getLang(filename) {
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
        .replace(/&#x27;/g, "'")
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

/** Color a code line, preserving its diff background and the bounded cache.
 * @param {string} code
 * @param {string|null} lang
 * @param {string|null} bgColor
 * @param {object} t theme tokens
 * @returns {string} terminal text
 */
export function syntaxHighlight(code, lang, bgColor, t) {
  if (!lang) {
    return applyThemeStyle(code, t.syntax.default, bgColor)
  }
  const cacheKey = `${lang}:${bgColor}:${code}`
  if (_syntaxCache.has(cacheKey)) return _syntaxCache.get(cacheKey)

  let result
  try {
    const { value } = getHljs().highlight(code, { language: lang, ignoreIllegals: true })
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

