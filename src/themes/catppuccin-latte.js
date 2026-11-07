/** catppuccin-latte.js — Catppuccin Latte (light) color scheme. */
export default {
  pr:    { open: '#2f7620', merged: '#8839ef', closed: '#c40e35', draft: '#666b80', conflict: '#976014' },
  issue: { open: '#2f7620', closed: '#666b80' },
  ci:    { pass: '#2f7620', fail: '#c40e35', pending: '#976014', running: '#976014' },
  review: { approved: '#2f7620', changes: '#c40e35', pending: '#976014' },
  ui: {
    bg:           '#eff1f5',
    fg:           '#4c4f69',
    selected:     '#145ff5',
    muted:        '#4c4f69',
    dim:          '#7c7f93',
    border:       '#abb0bf',
    borderActive: '#145ff5',
    headerBg:     '#e6e9ef',
    activeBg:     '#e6e9ef',
    divider:      '#abb0bf',
    rowHover:     '#eff1f5',
  },
  diff: {
    addBg: '#d9f0d3', addFg: '#2f7620', addSign: '#2f7620',
    delBg: '#f9d9dc', delFg: '#c40e35', delSign: '#c40e35',
    ctxFg: '#4c4f69', hunkFg: '#7c7f93', hunkBg: '#e6e9ef',
    threadBg: '#e6e9ef', threadBorder: '#145ff5', cursorBg: '#d9e8ff',
  },
  syntax: {
    keyword: '#8839ef', string: '#2f7620', comment: '#666b80',
    number: '#bc4501', fn: '#145ff5', builtin: '#d41c2c',
    variable: '#bc4501', type: '#0374a1', operator: '#8839ef',
    tag: '#2f7620', attr: '#0374a1', literal: '#bc4501',
    meta: '#976014', regexp: '#2f7620', default: '#4c4f69',
  },
}
