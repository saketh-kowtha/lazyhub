/**
 * Aurora Dark — cool navy/slate, lavender+cyan accents.
 */

export default {
  isDark: true,

  palette: {
    gray: ['#0d1117', '#13181f', '#161b22', '#21262d', '#30363d', '#484f58', '#6e7681', '#8b949e', '#b1bac4', '#c9d1d9', '#e6edf3', '#f0f6fc', '#ffffff'],
    accent: { primary: '#79c0ff', secondary: '#d2a8ff', tertiary: '#56d364' },
    green: { 3: '#56d364', 5: '#3fb950' },
    red: { 3: '#f85149', 5: '#da3633' },
    yellow: { 3: '#e3b341', 5: '#d29922' },
    blue: { 3: '#79c0ff', 5: '#58a6ff' },
    purple: { 3: '#d2a8ff', 5: '#bc8cff' },
    cyan: { 3: '#56d4dd', 5: '#39c5cf' },
  },

  semantic: {
    bg: {
      canvas: 'palette.gray.0',
      surface: 'palette.gray.1',
      elevated: 'palette.gray.2',
      overlay: 'palette.gray.3',
    },
    fg: {
      default: 'palette.gray.10',
      muted: 'palette.gray.8',
      subtle: 'palette.gray.6',
      onAccent: 'palette.gray.0',
    },
    border: {
      default: 'palette.gray.4',
      subtle: 'palette.gray.3',
      active: 'palette.accent.primary',
      strong: 'palette.gray.5',
    },
    state: {
      success: 'palette.green.3',
      danger: 'palette.red.3',
      warning: 'palette.yellow.3',
      info: 'palette.cyan.3',
    },
    accent: {
      primary: 'palette.accent.primary',
      secondary: 'palette.accent.secondary',
      tertiary: 'palette.accent.tertiary',
    },
    mode: {
      normal: 'palette.accent.primary',
      search: 'palette.yellow.3',
      command: 'palette.accent.secondary',
      visual: 'palette.accent.tertiary',
      compose: 'palette.cyan.3',
    },
  },

  pr: {
    open: '#3fb950',
    merged: '#a371f7',
    closed: '#f85149',
    draft: '#8b949e',
    conflict: '#e3b341',
  },
  issue: {
    open: '#3fb950',
    closed: '#a371f7',
  },
  ci: {
    pass: '#3fb950',
    fail: '#f85149',
    pending: '#e3b341',
    running: '#79c0ff',
  },
  ui: {
    selected: '#79c0ff',
    muted: '#8b949e',
    dim: '#6e7681',
    border: '#30363d',
    borderActive: '#79c0ff',
    headerBg: '#21262d',
    activeBg: '#161b22',
    divider: '#21262d',
    rowHover: '#161b22',
  },
  diff: {
    addBg: '#0f2c17',
    addFg: '#56d364',
    addSign: '#3fb950',
    delBg: '#2c0f0f',
    delFg: '#f85149',
    delSign: '#da3633',
    ctxFg: '#b1bac4',
    hunkFg: '#79c0ff',
    hunkBg: '#0d2135',
    threadBg: '#161b22',
    threadBorder: '#30363d',
    cursorBg: '#21262d',
  },
  syntax: {
    keyword: '#ff7b72',
    string: '#a5d6ff',
    comment: '#6e7681',
    number: '#79c0ff',
    function: '#d2a8ff',
    operator: '#ff7b72',
    type: '#ffa657',
    variable: '#e6edf3',
    property: '#79c0ff',
    punctuation: '#c9d1d9',
  },
}
