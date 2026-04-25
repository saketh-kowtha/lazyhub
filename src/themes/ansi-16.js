/**
 * ansi-16.js — Standard 16-color ANSI theme for maximum compatibility.
 * Works in any terminal (no hex support required).
 */
export default {
  ui: {
    selected:     'cyan',
    headerBg:     'blue',
    border:       'grey',
    borderActive: 'blueBright',
    muted:        'grey',
    dim:          'grey',
    activeBg:     undefined,
    divider:      'gray',
    rowHover:     undefined,
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
    addBg:    'black',
    addFg:    'green',
    addSign:  'green',
    delBg:    'black',
    delFg:    'red',
    delSign:  'red',
    ctxFg:    'white',
    hunkFg:   'grey',
    hunkBg:   'black',
    threadBg: 'black',
    threadBorder: 'blue',
    cursorBg: 'blue',
  },
  syntax: {
    keyword:  'magenta',
    string:   'green',
    comment:  'grey',
    number:   'yellow',
    fn:       'blue',
    builtin:  'cyan',
    variable: 'white',
    type:     'cyan',
    operator: 'white',
    tag:      'blue',
    attr:     'yellow',
    literal:  'yellow',
    meta:     'grey',
    regexp:   'red',
    default:  'white',
  }
}
