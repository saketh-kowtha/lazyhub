/**
 * terminal.js — the default theme (#566). Built only from the 16 ANSI named colours, so every
 * colour is whatever the user's terminal scheme says it is (the way lazygit behaves). Selection
 * is a bold accent plus the gutter glyph, never colour alone. `undefined` means "the terminal's
 * own default foreground/background", which no named colour can express.
 */
export default {
  pr:    { open: 'green', merged: 'magenta', closed: 'red', draft: 'gray', conflict: 'yellow' },
  issue: { open: 'green', closed: 'gray' },
  ci:    { pass: 'green', fail: 'red', pending: 'yellow', running: 'yellow' },
  review: { approved: 'green', changes: 'red', pending: 'yellow' },
  ui: {
    bg:           undefined,
    fg:           undefined,
    selected:     'cyan',
    muted:        'gray',
    dim:          'gray',
    border:       'gray',
    borderActive: 'cyan',
    headerBg:     undefined,
    activeBg:     undefined,
    divider:      'gray',
    rowHover:     undefined,
  },
  diff: {
    addBg: undefined, addFg: 'green', addSign: 'greenBright',
    delBg: undefined, delFg: 'red', delSign: 'redBright',
    ctxFg: undefined, hunkFg: 'cyan', hunkBg: undefined,
    threadBg: undefined, threadBorder: 'blue', cursorBg: 'blue',
  },
  syntax: {
    keyword: 'magenta', string: 'green', comment: 'gray',
    number: 'yellow', fn: 'blue', builtin: 'cyan',
    variable: 'yellowBright', type: 'cyan', operator: 'magenta',
    tag: 'blue', attr: 'yellow', literal: 'yellow',
    meta: 'cyan', regexp: 'red', default: undefined,
  },
}
