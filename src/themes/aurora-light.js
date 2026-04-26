/**
 * Aurora Light — cream surface, navy ink, periwinkle accents.
 */

export default {
  isDark: false,

  palette: {
    gray: ['#ffffff', '#f6f8fa', '#eaeef2', '#d0d7de', '#bfc7d0', '#9fabb8', '#7d8590', '#656d76', '#424a53', '#32383f', '#1f2328', '#0d1117', '#000000'],
    accent: { primary: '#0969da', secondary: '#8250df', tertiary: '#1a7f37' },
    green: { 3: '#1a7f37', 5: '#116329' },
    red: { 3: '#cf222e', 5: '#a40e26' },
    yellow: { 3: '#9a6700', 5: '#7d4e00' },
    blue: { 3: '#0969da', 5: '#0550ae' },
    purple: { 3: '#8250df', 5: '#6639ba' },
    cyan: { 3: '#1b7c83', 5: '#13606a' },
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
      muted: 'palette.gray.7',
      subtle: 'palette.gray.6',
      onAccent: 'palette.gray.0',
    },
    border: {
      default: 'palette.gray.3',
      subtle: 'palette.gray.2',
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
    open: '#1a7f37',
    merged: '#8250df',
    closed: '#cf222e',
    draft: '#656d76',
    conflict: '#9a6700',
  },
  issue: {
    open: '#1a7f37',
    closed: '#8250df',
  },
  ci: {
    pass: '#1a7f37',
    fail: '#cf222e',
    pending: '#9a6700',
    running: '#0969da',
  },
  ui: {
    selected: '#0969da',
    muted: '#656d76',
    dim: '#7d8590',
    border: '#d0d7de',
    borderActive: '#0969da',
    headerBg: '#eaeef2',
    activeBg: '#f6f8fa',
    divider: '#eaeef2',
    rowHover: '#f6f8fa',
  },
  diff: {
    addBg: '#dafbe1',
    addFg: '#116329',
    addSign: '#1a7f37',
    delBg: '#ffebe9',
    delFg: '#a40e26',
    delSign: '#cf222e',
    ctxFg: '#32383f',
    hunkFg: '#0969da',
    hunkBg: '#ddf4ff',
    threadBg: '#f6f8fa',
    threadBorder: '#d0d7de',
    cursorBg: '#eaeef2',
  },
  syntax: {
    keyword: '#cf222e',
    string: '#0a3069',
    comment: '#7d8590',
    number: '#0969da',
    function: '#8250df',
    operator: '#cf222e',
    type: '#953800',
    variable: '#1f2328',
    property: '#0969da',
    punctuation: '#32383f',
  },
}
