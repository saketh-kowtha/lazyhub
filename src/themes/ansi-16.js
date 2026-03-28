/**
 * ansi-16.js — Standard 16-color ANSI theme for maximum compatibility.
 * Works in any terminal (no hex support required).
 */
export default {
  ui: {
    selected: 'cyan',
    headerBg: 'blue',
    border:   'grey',
    muted:    'grey',
    dim:      'grey',
  },
  pr: {
    open:     'green',
    closed:   'red',
    merged:   'magenta',
    draft:    'grey',
  },
  issue: {
    open:     'green',
    closed:   'red',
  },
  ci: {
    pass:     'green',
    fail:     'red',
    pending:  'yellow',
  },
  diff: {
    add:      'green',
    del:      'red',
    file:     'cyan',
    hunk:     'magenta',
    ctxFg:    'white',
  }
}
