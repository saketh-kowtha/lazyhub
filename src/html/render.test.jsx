// Render-level acceptance tests for HTML in Markdown bodies (T1 to T3, T5, T6/T7/T17/T18 at row level,
// T12, T19, T21, T22) plus the hostile corpus pushed through getMarkdownRows.
import { describe, it, expect, vi } from 'vitest'
import React from 'react'
import { Box } from 'ink'
import { render } from 'ink-testing-library'
import { createRequire } from 'node:module'
import { readdirSync, readFileSync } from 'node:fs'
import { getMarkdownRows, displayWidth, stripAnsi } from '../utils.js'
import { HOSTILE, BOMBS } from './fixtures/hostile.js'
import { LIMITS, newBudget } from './types.js'
import { parseSegment } from './parse.js'
import { layout } from './layout.js'

const theme = {
  ui: { selected: 'cyan', muted: 'grey', dim: 'grey', headerBg: 'blue', border: 'grey' },
  pr: { draft: 'grey' },
  ci: { pending: 'yellow', pass: 'green' },
}

// eslint-disable-next-line no-control-regex
const BAD = /[\x00-\x08\x0b-\x1f\x7f-\x9f\u061c\u180e\u200b-\u200f\u202a-\u202e\u2060-\u2064\u2066-\u206f\ufeff\u{e0000}-\u{e007f}]/u

function frame(body, width = 76, cols = 100) {
  const rows = getMarkdownRows(body, width, theme)
  const out = render(<Box flexDirection="column" width={cols}>{rows}</Box>)
  const text = stripAnsi(out.lastFrame() ?? '')
  out.unmount()
  return text
}

const lines = (body, width) => frame(body, width).split('\n').map(l => l.trimEnd())

describe('T1 details and summary', () => {
  const body = '<details><summary>Logs</summary>\n\nsome **md**\n\n</details>\n\nafter'
  it('renders an expanded section with Markdown inside', () => {
    const out = frame(body)
    expect(out).toContain('\u25be Logs')
    expect(out).toMatch(/\u2502\s+some md/)
    expect(out).not.toContain('<details>')
    expect(out).not.toContain('<summary>')
    expect(out).not.toContain('**')
    expect(out).toContain('after')
  })
  it('stops indenting after the closing tag', () => {
    const l = lines(body)
    expect(l.find(x => x.includes('after')).trim()).toBe('after')
  })
  it('a missing summary shows Details and an unclosed section auto-closes', () => {
    const out = frame('<details>\ninner text\n</details>')
    expect(out).toContain('\u25be Details')
    expect(frame('<details><summary>S</summary>\n\nbody')).toMatch(/\u2502\s+body/)
  })
})

describe('T2 inline styling', () => {
  it('styles spans, brackets kbd, breaks lines and draws a rule', () => {
    const out = frame('<b>x</b> <i>y</i> <kbd>Ctrl</kbd> <sub>s</sub> <br> after\n\n<hr>')
    expect(out).toContain('x y [Ctrl] s')
    expect(out).toContain('after')
    expect(out).toContain('\u2500'.repeat(10))
    expect(out).not.toMatch(/[<>]/)
  })
  it('mixes inline HTML with Markdown emphasis and keeps code spans literal', () => {
    const out = frame('Use <b>bold</b>, **md** and `<i>raw</i>` together')
    expect(out).toContain('Use bold, md and')
    expect(out).toContain('<i>raw</i>')
  })
  it('renders lists, headings, blockquotes and pre', () => {
    const out = frame('<h2>Title</h2>\n<ul><li>one<li>two<ul><li>nested</ul></ul>\n\n<blockquote>quoted</blockquote>\n\n<pre>a  b\n  c</pre>')
    expect(out).toContain('Title')
    expect(out).toContain('\u2022 one')
    expect(out).toContain('\u2022 nested')
    expect(out).toMatch(/\u2502\s+quoted/)
    expect(out).toContain('a  b')
    expect(out).not.toMatch(/<\/?(h2|ul|li|blockquote|pre)>/)
  })
  it('honours ol start', () => {
    expect(frame('<ol start="5"><li>a</li><li>b</li></ol>')).toContain('6. b')
  })
})

describe('T3/T4 links', () => {
  it('always shows the real host after link text', () => {
    expect(frame('<a href="https://evil.com">https://github.com</a>')).toContain('https://github.com \u2039evil.com\u203a')
  })
  it('a link whose text is its URL is shown once', () => {
    const out = frame('<a href="https://github.com/a/b">https://github.com/a/b</a>')
    expect(out).not.toContain('\u2039')
  })
  it('unsafe links lose their target', () => {
    for (const id of ['js-url', 'js-url-case', 'js-url-hex-tab', 'js-url-dec-entity', 'data-url-leading-space']) {
      const out = frame(HOSTILE.find(f => f.id === id).input)
      expect(out, id).toContain('x \u2039unsafe link removed\u203a')
      expect(out, id).not.toContain('alert')
    }
  })
  it('T10 shows the real host and flags credentials', () => {
    const out = frame(HOSTILE.find(f => f.id === 'userinfo-host').input)
    expect(out).toContain('\u2039evil.com/x\u203a')
    expect(out).toContain('credentials in URL')
    expect(out).not.toContain('github.com')
  })
  it('T9 shows an international host as punycode', () => {
    expect(frame(HOSTILE.find(f => f.id === 'cyrillic-host').input)).toContain('xn--')
  })
  it('relative links resolve against the GitHub host', () => {
    expect(frame('<a href="/o/r/pull/1">pr</a>')).toContain('\u2039github.com/o/r/pull/1\u203a')
  })
})

describe('T5 images', () => {
  it('shows alt text and the source host and never fetches', () => {
    const require = createRequire(import.meta.url)
    const spies = [
      vi.spyOn(globalThis, 'fetch').mockImplementation(() => { throw new Error('network') }),
      vi.spyOn(require('node:http'), 'request'),
      vi.spyOn(require('node:https'), 'request'),
      vi.spyOn(require('node:dns'), 'lookup'),
      vi.spyOn(require('node:net'), 'connect'),
    ]
    const out = frame('<img src="https://user-images.githubusercontent.com/a.png" alt="shot">')
    expect(out).toContain('[image: shot] \u2039user-images.githubusercontent.com\u203a')
    for (const { input } of HOSTILE) frame(input)
    for (const spy of spies) expect(spy).not.toHaveBeenCalled()
    vi.restoreAllMocks()
  })
  it('handles missing alt, unsafe source and picture', () => {
    expect(frame('<img src="https://x.com/a.png">')).toContain('[image] \u2039x.com\u203a')
    expect(frame('<img src="javascript:x" alt="a">')).toContain('[image: a] \u2039unsafe source removed\u203a')
    expect(frame('<picture><source srcset="https://evil.com/a.webp"><img src="https://x.com/a.png" alt="p"></picture>')).not.toContain('evil.com')
  })
})

describe('T6/T7/T8/T17/T18 hostile text at row level', () => {
  it('no control or spoofing characters and no embedded content ever reach the screen', () => {
    for (const { id, input } of HOSTILE) {
      const out = frame(input)
      expect(out, id).not.toMatch(BAD)
      expect(out, id).not.toContain('\u001b')
    }
  })
  it('T17 drops embedded content with one marker per element', () => {
    const out = frame(HOSTILE.find(f => f.id === 'embedded').input)
    expect(out.replace(/\s+/g, ' ').match(/embedded content removed/g)).toHaveLength(4)
    for (const word of ['alert', '*{}']) expect(out).not.toContain(word)
  })
  it('T18 ignores CSS and font colours but keeps the text', () => {
    const out = frame(HOSTILE.find(f => f.id === 'css-hidden').input)
    expect(out).toContain('hidden')
    expect(out).toContain('c')
  })
  it('T13/T14/T15 broken markup stays visible text', () => {
    expect(frame('before <b')).toContain('before <b')
    expect(frame('<!-- unterminated')).toContain('<!-- unterminated')
    expect(frame('<!-->visible')).toContain('visible')
    expect(frame('<script>alert(1)\n\nnext block')).toContain('next block')
    expect(frame('<![CDATA[<script>x</script>]]>y')).not.toContain('script')
  })
  it('every row of every fixture fits the pane and renders deterministically', () => {
    for (const { id, input } of HOSTILE) {
      for (const el of getMarkdownRows(input, 60, theme)) {
        const out = render(<Box width={80}>{el}</Box>)
        for (const line of stripAnsi(out.lastFrame() ?? '').split('\n')) expect(displayWidth(line.trimEnd()), id).toBeLessThanOrEqual(62)
        out.unmount()
      }
      expect(frame(input), id).toBe(frame(input))
    }
  })
})

describe('T12 tables', () => {
  it('aligns a small table with a bold header and a rule', () => {
    const out = frame('<table><thead><tr><th>Case</th><th>After</th></tr></thead><tbody><tr><td>cold start</td><td>0.6s</td></tr></tbody></table>')
    expect(out).toContain('Case')
    expect(out).toContain('\u2500\u253c\u2500')
    expect(out).toMatch(/cold start \u2502 0\.6s/)
  })
  it('caps a 200 x 100 table at 16 columns and says what was left out', () => {
    const row = n => `<tr>${Array.from({ length: 200 }, (_, c) => `<td>r${n}c${c}</td>`).join('')}</tr>`
    const body = `<table>${Array.from({ length: 100 }, (_, r) => row(r)).join('')}</table>`
    const start = performance.now()
    const rows = getMarkdownRows(body, 76, theme)
    expect(performance.now() - start).toBeLessThan(500)
    const out = frame(body)
    expect(out).toContain('+184 cols')
    for (const line of out.split('\n')) expect(displayWidth(line.trimEnd())).toBeLessThanOrEqual(100)
    expect(rows.length).toBeLessThan(200)
  })
  it('caps rows with a visible notice', () => {
    const body = `<table>${Array.from({ length: 600 }, (_, r) => `<tr><td>r${r}</td></tr>`).join('')}</table>`
    const rows = getMarkdownRows(body, 76, theme)
    const out = render(<Box flexDirection="column" height={800}>{rows}</Box>)
    expect(stripAnsi(out.lastFrame())).toContain('100 more rows')
    out.unmount()
  })
})

describe('T19 single decode', () => {
  it('an entity-encoded tag is text, not markup', () => {
    expect(frame('&amp;lt;b&amp;gt;')).toContain('&lt;b&gt;')
    expect(frame('&lt;b&gt;x&lt;/b&gt;')).toContain('<b>x</b>')
    expect(frame('<p>&amp;lt;b&amp;gt;</p>')).toContain('&lt;b&gt;')
    expect(frame('<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>')).toContain('<script>alert(1)</script>')
  })
  it('code spans and fenced blocks are never parsed as HTML', () => {
    expect(frame('see `<b>x</b>` here <i>i</i>')).toContain('<b>x</b>')
    const out = frame('<b>x</b>\n\n```text\n<b>y</b>\n<script>z</script>\n```')
    expect(out).toContain('<b>y</b>')
    expect(out).toContain('<script>z</script>')
  })
  it('the callers hand getMarkdownRows undecoded bodies', () => {
    // PR detail and issue timeline pass pr.body / issue.body straight through; no other layer decodes.
    for (const file of ['../features/prs/detail/content-rows.jsx', '../features/issues/timeline-rows.jsx']) {
      const src = readFileSync(new URL(file, import.meta.url), 'utf8')
      expect(src).toMatch(/getMarkdownRows\((pr|issue)\.body,/)
    }
  })
})

describe('T21 row cap', () => {
  it('keeps exactly 2000 rows and names the open key', () => {
    const body = '<ul>' + '<li>item</li>'.repeat(2500) + '</ul>'
    const rows = getMarkdownRows(body, 76, theme)
    expect(rows).toHaveLength(LIMITS.MAX_ROWS + 1)
    const out = render(<Box flexDirection="column">{rows.slice(-1)}</Box>)
    expect(stripAnsi(out.lastFrame())).toContain('open in browser (o)')
    out.unmount()
  })
})

// Wall time depends on the runner (coverage instrumentation makes it several times slower), so these tests assert
// bounded work (row cap, token budget) and linear scaling. The absolute figures are in the PR description.
function best(fn, runs = 3) {
  fn()
  return Math.min(...Array.from({ length: runs }, () => {
    const start = performance.now()
    fn()
    return performance.now() - start
  }))
}

describe('T20 body budget', { timeout: 30_000 }, () => {
  for (const [name, input] of Object.entries(BOMBS)) {
    it(`${name} bomb stays bounded in rows and scales linearly`, () => {
      const rows = getMarkdownRows(input, 76, theme)
      expect(rows.length).toBeLessThanOrEqual(LIMITS.MAX_ROWS + 1)
      const lead = '<b>x</b> '
      const small = lead + input.slice(0, 32 * 1024)
      const big = lead + input.slice(0, LIMITS.MAX_BYTES)
      const t1 = Math.max(best(() => getMarkdownRows(small, 76, theme)), 2)
      const t16 = best(() => getMarkdownRows(big, 76, theme), 2)
      expect(t16).toBeLessThanOrEqual(t1 * 80)
    })
  }
  it('layout stops at the row cap instead of laying out the whole body', () => {
    const body = '<b>x</b> text '.repeat(40000)
    const tree = parseSegment(body, { budget: newBudget() })
    const ctx = { width: 76, base: 'https://example.org/', md: false, st0: {} }
    const lines = layout(tree.children, ctx)
    expect(lines.length).toBeLessThanOrEqual(LIMITS.MAX_ROWS + 1)
    expect(ctx.cap.left).toBeLessThanOrEqual(0)
  })
  it('a body with no HTML renders exactly as before', () => {
    const rows = getMarkdownRows('# Title\n\n- a\n- b\n\ntext **bold**', 76, theme)
    expect(rows.map(r => r.key)).toEqual(['h-0', 'br-1', 'li-2', 'li-3', 'br-4', 'p-5-0'])
  })
})

describe('T22 real-world body', () => {
  const body = [
    '## Summary',
    '',
    '<p align="center"><a href="https://github.com/o/r/actions"><img src="https://img.shields.io/badge/build-passing-green" alt="build"></a></p>',
    '',
    'Fixes the flaky retry <b>and</b> adds backoff.<br>See the logs below.',
    '',
    '<details>',
    '<summary>Test logs (click to expand)</summary>',
    '',
    '```',
    '$ npm test',
    'ok',
    '```',
    '',
    'Only **3** tests were slow.',
    '',
    '</details>',
    '',
    '<table>',
    '<tr><th>Case</th><th>Before</th><th>After</th></tr>',
    '<tr><td>cold start</td><td>1.9s</td><td>0.6s</td></tr>',
    '</table>',
    '',
    '<img src="https://user-images.githubusercontent.com/1/shot.png" alt="flamegraph" width="600">',
    '',
    'Thanks <a href="https://github.com/alice">@alice</a>!',
  ].join('\n')

  it('leaves no raw tags and uses only theme tokens', () => {
    const out = frame(body)
    expect(out).not.toMatch(/<\/?(p|a|img|b|br|details|summary|table|tr|th|td)\b/)
    expect(out).toContain('[image: build] \u2039img.shields.io\u203a')
    expect(out).toContain('\u25be Test logs (click to expand)')
    expect(out).toMatch(/\u2502\s+\$ npm test/)
    expect(out).toContain('cold start')
    expect(out).toContain('@alice \u2039github.com/alice\u203a')
    expect(out).toMatchSnapshot()
  })

  it('no literal colours in src/html', () => {
    const dir = new URL('.', import.meta.url).pathname
    for (const file of readdirSync(dir).filter(f => /\.(js|jsx)$/.test(f) && !f.includes('.test.') && f !== 'hostile.js')) {
      const src = readFileSync(dir + file, 'utf8')
      expect(src, file).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
      expect(src, file).not.toMatch(/(color|backgroundColor)[=:]\s*['"]/)
    }
  })
})
