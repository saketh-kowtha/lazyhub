import { describe, it, expect } from 'vitest'
import { hasMarkup, htmlBlockStart } from './detect.js'

describe('hasMarkup', () => {
  it('spots tags, comments and declarations only', () => {
    expect(hasMarkup('a <b>x</b>')).toBe(true)
    expect(hasMarkup('<!-- c -->')).toBe(true)
    expect(hasMarkup('</p>')).toBe(true)
    expect(hasMarkup('1 < 2 and 3 > 2')).toBe(false)
    expect(hasMarkup('a <3 b')).toBe(false)
    expect(hasMarkup('plain')).toBe(false)
  })
})

describe('htmlBlockStart', () => {
  it('starts block-level tags, ending at a blank line', () => {
    for (const line of ['<details>', '<div align="center">', '  <table>', '</div>', '<h1>x</h1>', '<p>', '<hr/>']) {
      expect(htmlBlockStart(line, true), line).not.toBeNull()
    }
    expect(htmlBlockStart('<details>', false)).toEqual({ end: 'blank' })
  })
  it('does not start on inline tags, indented code or text', () => {
    expect(htmlBlockStart('<b>bold</b> text', true)).toBeNull()
    expect(htmlBlockStart('    <div>', true)).toBeNull()
    expect(htmlBlockStart('text <div>', true)).toBeNull()
  })
  it('a complete tag alone on a line starts a block only after a blank line', () => {
    expect(htmlBlockStart('<span>', true)).not.toBeNull()
    expect(htmlBlockStart('<span>', false)).toBeNull()
  })
  it('raw text, comments and declarations end at their closer', () => {
    const pre = htmlBlockStart('<pre>', false)
    expect(pre.end).toBe('line')
    expect(pre.done('x </PRE>')).toBe(true)
    expect(htmlBlockStart('<pre>x</pre>', false)).toEqual({ end: 'blank' })
    expect(htmlBlockStart('<!-- a', false).done('b -->')).toBe(true)
    expect(htmlBlockStart('<!-- a -->', false)).toEqual({ end: 'blank' })
    expect(htmlBlockStart('<![CDATA[ a', false).done(']]>')).toBe(true)
  })
})
