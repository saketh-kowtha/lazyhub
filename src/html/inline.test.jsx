// Inline HTML inside Markdown lines, carried containers, GH_HOST and fallbacks.
import { describe, it, expect, afterEach } from 'vitest'
import React from 'react'
import { Box } from 'ink'
import { render } from 'ink-testing-library'
import { getMarkdownRows, stripAnsi } from '../utils.js'

const theme = { ui: { selected: 'cyan', muted: 'grey', dim: 'grey', headerBg: 'blue', border: 'grey' }, ci: { pending: 'yellow' } }

function frame(body, width = 70) {
  const out = render(<Box flexDirection="column" width={76}>{getMarkdownRows(body, width, theme)}</Box>)
  const text = stripAnsi(out.lastFrame() ?? '')
  out.unmount()
  return text
}

describe('inline HTML in Markdown lines', () => {
  it('keeps heading and list markers', () => {
    expect(frame('## A <b>bold</b> title')).toContain('A bold title')
    const list = frame('- one <i>it</i>\n- two')
    expect(list).toContain('• one it')
    expect(list).toContain('• two')
  })
  it('leaves plain angle brackets alone', () => {
    expect(frame('a < b and c > d')).toContain('a < b and c > d')
  })
  it('keeps unclosed inline tags inside their line', () => {
    const out = frame('<b>open\nnext line')
    expect(out).toContain('open')
    expect(out).toContain('next line')
  })
})

describe('carried containers', () => {
  it('nests a blockquote in a details section and closes both', () => {
    const out = frame('<details>\n<summary>S</summary>\n<blockquote>\n\nquoted md **b**\n\n</blockquote>\n\n</details>\n\ndone')
    expect(out).toMatch(/│\s+│\s+quoted md b/)
    expect(out.split('\n').find(l => l.includes('done')).trim()).toBe('done')
  })
})

describe('GH_HOST', () => {
  const saved = process.env.GH_HOST
  afterEach(() => {
    if (saved === undefined) delete process.env.GH_HOST
    else process.env.GH_HOST = saved
  })
  it('relative links resolve against the configured host', () => {
    process.env.GH_HOST = 'ghe.example.com'
    expect(frame('<a href="/o/r/issues/3">issue</a>')).toContain('‹ghe.example.com/o/r/issues/3›')
  })
  it('an explicit base wins', () => {
    const rows = getMarkdownRows('<a href="x">t</a>', 70, theme, { base: 'https://github.com/o/r/' })
    const out = render(<Box flexDirection="column">{rows}</Box>)
    expect(stripAnsi(out.lastFrame())).toContain('‹github.com/o/r/x›')
    out.unmount()
  })
})

describe('bodies without HTML', () => {
  it('are untouched: same rows as the Markdown renderer', () => {
    const rows = getMarkdownRows('# T\n\n```js\nconst a = 1 < 2\n```\n\n1 < 2 > 0', 70, theme)
    expect(rows.map(r => r.key)).toEqual(['h-0', 'br-1', 'code-4-0', 'br-5', 'p-6-0'])
  })
})
