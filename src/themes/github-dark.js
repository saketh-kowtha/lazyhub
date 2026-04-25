export default {
  pr:    { open: '#3fb950', merged: '#a371f7', closed: '#f85149', draft: '#8b949e', conflict: '#d29922' },
  issue: { open: '#3fb950', closed: '#8b949e' },
  ci:    { pass: '#3fb950', fail: '#f85149', pending: '#d29922', running: '#d29922' },
  ui: {
    selected:     '#58a6ff',
    muted:        '#8b949e',
    dim:          '#484f58',
    border:       '#30363d',
    borderActive: '#58a6ff',
    headerBg:     '#161b22',
    activeBg:     '#1f2937',
    divider:      '#21262d',
    rowHover:     '#1c2128',
  },
  diff: {
    addBg: '#0d2a17', addFg: '#3fb950', addSign: '#56d364',
    delBg: '#2a0d0d', delFg: '#f85149', delSign: '#ff7b72',
    ctxFg: '#c9d1d9', hunkFg: '#8b949e', hunkBg: '#161b22',
    threadBg: '#161b22', threadBorder: '#388bfd', cursorBg: '#1f3a5f',
  },
  syntax: {
    keyword: '#ff7b72', string: '#a5d6ff', comment: '#6e7681',
    number: '#79c0ff', fn: '#d2a8ff', builtin: '#ffa657',
    variable: '#ffa657', type: '#79c0ff', operator: '#ff7b72',
    tag: '#7ee787', attr: '#79c0ff', literal: '#79c0ff',
    meta: '#ffa657', regexp: '#a5d6ff', default: '#c9d1d9',
  },
}
