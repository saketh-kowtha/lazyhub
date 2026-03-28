export default {
  pr:    { open: '#9ece6a', merged: '#bb9af7', closed: '#565f89', draft: '#565f89' },
  issue: { open: '#9ece6a', closed: '#565f89' },
  ci:    { pass: '#9ece6a', fail: '#f7768e', pending: '#e0af68', running: '#e0af68' },
  ui: {
    selected: '#7aa2f7', muted: '#a9b1d6', dim: '#565f89',
    border: '#292e42', headerBg: '#16161e',
  },
  diff: {
    addBg: '#1a2a1a', addFg: '#9ece6a', addSign: '#9ece6a',
    delBg: '#2a1a1e', delFg: '#f7768e', delSign: '#f7768e',
    ctxFg: '#a9b1d6', hunkFg: '#565f89', hunkBg: '#16161e',
    threadBg: '#16161e', threadBorder: '#7aa2f7', cursorBg: '#1f2a4a',
  },
  syntax: {
    keyword: '#bb9af7', string: '#9ece6a', comment: '#565f89',
    number: '#ff9e64', fn: '#7aa2f7', builtin: '#f7768e',
    variable: '#ff9e64', type: '#2ac3de', operator: '#bb9af7',
    tag: '#f7768e', attr: '#7aa2f7', literal: '#ff9e64',
    meta: '#e0af68', regexp: '#9ece6a', default: '#a9b1d6',
  },
}
