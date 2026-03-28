export default {
  pr:    { open: '#40a02b', merged: '#8839ef', closed: '#9ca0b0', draft: '#9ca0b0' },
  issue: { open: '#40a02b', closed: '#9ca0b0' },
  ci:    { pass: '#40a02b', fail: '#d20f39', pending: '#df8e1d', running: '#df8e1d' },
  ui: {
    selected: '#1e66f5', muted: '#4c4f69', dim: '#9ca0b0',
    border: '#ccd0da', headerBg: '#e6e9ef',
  },
  diff: {
    addBg: '#d9f0d3', addFg: '#40a02b', addSign: '#40a02b',
    delBg: '#f9d9dc', delFg: '#d20f39', delSign: '#d20f39',
    ctxFg: '#4c4f69', hunkFg: '#7c7f93', hunkBg: '#e6e9ef',
    threadBg: '#e6e9ef', threadBorder: '#1e66f5', cursorBg: '#d9e8ff',
  },
  syntax: {
    keyword: '#8839ef', string: '#40a02b', comment: '#9ca0b0',
    number: '#fe640b', fn: '#1e66f5', builtin: '#e64553',
    variable: '#fe640b', type: '#04a5e5', operator: '#8839ef',
    tag: '#40a02b', attr: '#04a5e5', literal: '#fe640b',
    meta: '#df8e1d', regexp: '#40a02b', default: '#4c4f69',
  },
}
