/**
 * theme.js — single source of truth for all colors used in ghui.
 * Import { t } from './theme.js' everywhere — never inline hex strings.
 */

export const t = {
  pr: {
    open:   '#3fb950',
    merged: '#a371f7',
    closed: '#8b949e',
    draft:  '#8b949e',
  },
  issue: {
    open:   '#3fb950',
    closed: '#8b949e',
  },
  ci: {
    pass:    '#3fb950',
    fail:    '#f85149',
    pending: '#d29922',
    running: '#d29922',
  },
  ui: {
    selected:  '#58a6ff',  // focused row + active nav border
    muted:     '#8b949e',  // secondary text
    dim:       '#484f58',  // timestamps, hints
    border:    '#21262d',
    headerBg:  '#161b22',
  },
  diff: {
    addBg:        '#0d2a17',
    addFg:        '#3fb950',
    addSign:      '#56d364',  // '+' gutter sign
    delBg:        '#2a0d0d',
    delFg:        '#f85149',
    delSign:      '#ff7b72',  // '-' gutter sign
    ctxFg:        '#c9d1d9',
    hunkFg:       '#8b949e',
    hunkBg:       '#161b22',
    threadBg:     '#161b22',
    threadBorder: '#388bfd',
    cursorBg:     '#1f3a5f',
  },
  // Syntax highlight palette — maps to hljs class names
  syntax: {
    keyword:  '#ff7b72',  // import, const, function, return…
    string:   '#a5d6ff',  // "strings" and 'strings'
    comment:  '#6e7681',  // // comments
    number:   '#79c0ff',  // 42, 3.14
    fn:       '#d2a8ff',  // function names / titles
    builtin:  '#ffa657',  // console, process, require…
    variable: '#ffa657',  // variable names
    type:     '#79c0ff',  // types, class names
    operator: '#ff7b72',  // +, -, ===, =>
    tag:      '#7ee787',  // <div>, HTML tags
    attr:     '#79c0ff',  // attribute names
    literal:  '#79c0ff',  // true, false, null, undefined
    meta:     '#ffa657',  // decorators, annotations
    regexp:   '#a5d6ff',  // /regex/
    default:  '#c9d1d9',  // plain text (no class)
  },
}
