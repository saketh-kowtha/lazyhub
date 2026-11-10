import { describe, it, expect } from 'vitest'
import { tokenize } from './tokenize.js'
import { buildTree } from './tree.js'
import { parseSegment } from './parse.js'
import { decodeEntitiesOnce } from './entities.js'
import { newBudget } from './types.js'

const toks = (s, md = false) => tokenize(s, { md, budget: newBudget() })
const text = nodes => nodes.map(n => (n.type === 'text' ? n.value : n.type === 'notice' ? `<${n.value}>` : text(n.children || []))).join('')
const tree = (s, carry) => parseSegment(s, { budget: newBudget(), carry })

describe('tokenize', () => {
  it('splits text, tags and closing tags', () => {
    expect(toks('a<b>c</b>d').map(t => t.type)).toEqual(['text', 'open', 'text', 'close', 'text'])
  })

  it('keeps only allowlisted attributes and lower-cases names', () => {
    const [open] = toks('<A HREF="https://x.com" onclick="y" title=z>')
    expect(open).toMatchObject({ type: 'open', name: 'a', attrs: { href: 'https://x.com' } })
    expect(Object.keys(open.attrs)).toEqual(['href'])
  })

  it('a quoted > does not close the tag and a quote cannot add attributes', () => {
    const [img] = toks('<img alt="a>b" src=x>')
    expect(img.attrs).toEqual({ alt: 'a>b', src: 'x' })
    const [a] = toks('<a href="https://a.com" title=\'x" onmouseover="y\'>')
    expect(a.attrs).toEqual({ href: 'https://a.com' })
  })

  it('treats malformed tags as literal text', () => {
    expect(text(tree('x <b').children)).toBe('x <b')
    expect(text(tree('<a href="x').children)).toBe('<a href="x')
    expect(text(tree(`<${'a'.repeat(40)}>t`).children)).toContain('<aaaa')
    expect(text(tree('1 < 2 and <3').children)).toBe('1 < 2 and <3')
  })

  it('handles comments like the spec, with unterminated ones left visible', () => {
    expect(text(tree('<!-->visible').children)).toBe('visible')
    expect(text(tree('<!--->visible').children)).toBe('visible')
    expect(text(tree('<!-- a -- b -->x').children)).toBe('x')
    expect(text(tree('<!-- a --!>x').children)).toBe('x')
    expect(text(tree('<!-- unterminated').children)).toBe('<!-- unterminated')
  })

  it('drops bogus comments up to the first > and never expands entities', () => {
    expect(text(tree('<![CDATA[<script>x</script>]]>y').children)).not.toContain('script')
    const t = text(tree('<!DOCTYPE x [<!ENTITY a "boom">]>&a;').children)
    expect(t).not.toContain('boom')
    expect(t).toContain('&a;')
  })

  it('drops script/style/iframe/svg with content, one marker each', () => {
    const t = text(tree('<script>alert(1)</script><style>*{}</style><iframe src=x>t</iframe><svg><text>s</text></svg>').children)
    expect(t).toBe('<embedded content removed>'.repeat(4))
  })

  it('an unclosed script drops only to the end of its segment', () => {
    expect(text(tree('<script>alert(1)').children)).toBe('<embedded content removed>')
    expect(text(tree('after').children)).toBe('after')
  })

  it('finds raw-text closers case-insensitively', () => {
    expect(text(tree('<SCRIPT>x</ScRiPt>ok').children)).toBe('<embedded content removed>ok')
  })

  it('recognises code spans in md mode and leaves their tags literal', () => {
    const t = toks('a `<b>x</b>` c', true)
    expect(t.map(x => x.type)).toEqual(['text', 'code', 'text'])
    expect(t[1].value).toBe('<b>x</b>')
  })

  it('stops with a visible notice at the token limit', () => {
    const budget = newBudget()
    budget.tokens = 49999
    const t = tokenize('<b>x</b><i>y</i>', { budget })
    expect(t.at(-1)).toMatchObject({ type: 'notice' })
    expect(budget.stopped).toBe(true)
  })
})

describe('buildTree', () => {
  it('closes mis-nested tags and ignores stray closes', () => {
    const n = tree('<b>x<i>y</b>z</i></p>').children
    expect(text(n)).toBe('xyz')
    expect(n.filter(x => x.type === 'el')).toHaveLength(1)
  })

  it('treats unknown tags as transparent', () => {
    expect(text(tree('<foo>kept</foo><bar/>').children)).toBe('kept')
  })

  it('caps nesting depth, keeps text and says so', () => {
    const n = tree('<div><b>'.repeat(5000) + 'deep').children
    expect(text(n)).toContain('deep')
    expect(text(n)).toContain('<nesting too deep>')
  })

  it('carries open details and blockquote to the next segment', () => {
    const a = tree('<details><summary>S</summary>')
    expect(a.carryOut).toEqual(['details'])
    const b = tree('</details>after', a.carryOut)
    expect(b.carryOut).toEqual([])
    expect(b.children[0]).toMatchObject({ name: 'details', synthetic: true })
    const c = tree('middle', a.carryOut)
    expect(c.carryOut).toEqual(['details'])
  })

  it('auto-closes open elements that cannot be carried', () => {
    expect(tree('<div><b>x').carryOut).toEqual([])
  })

  it('applies implied end tags for p, li, td and tr', () => {
    const li = tree('<ul><li>a<li>b</ul>').children[0]
    expect(li.children.map(c => c.name)).toEqual(['li', 'li'])
    const tr = tree('<table><tr><td>a<td>b<tr><td>c</table>').children[0]
    expect(tr.children.map(c => c.name)).toEqual(['tr', 'tr'])
  })
})

describe('decodeEntitiesOnce', () => {
  it('decodes once and never twice', () => {
    expect(decodeEntitiesOnce('&amp;lt;b&amp;gt;')).toBe('&lt;b&gt;')
  })
  it('handles decimal, hex and named references', () => {
    expect(decodeEntitiesOnce('&#65;&#x42;&amp;&nbsp;&copy;')).toBe('AB& \u00a9')
  })
  it('replaces unusable numeric references with U+FFFD', () => {
    expect(decodeEntitiesOnce('&#9999999999;&#x110000;&#xD800;&#0;&#xFFFE;')).toBe('\ufffd'.repeat(5))
  })
  it('leaves unknown or unterminated references as text', () => {
    expect(decodeEntitiesOnce('&bogus; &amp &#;')).toBe('&bogus; &amp &#;')
  })
})

describe('buildTree contract', () => {
  it('is exported for the renderer', () => {
    expect(typeof buildTree).toBe('function')
  })
})
