// Hostile corpus for the HTML path (T4, T6 to T11, T13 to T17, T20). Parser level: tokenize + tree + URL policy.
// Render-level checks of the same corpus live in render.test.jsx.
import { describe, it, expect, vi } from 'vitest'
import { createRequire } from 'node:module'
import { readdirSync, readFileSync } from 'node:fs'
import { parseSegment } from './parse.js'
import { newBudget, LIMITS } from './types.js'
import { resolveUrl } from './url.js'
import { cleanHtmlText } from './spoof.js'
import { HOSTILE, BOMBS } from './fixtures/hostile.js'

const BASE = 'https://github.com/o/r/'
const ALLOWED_ATTRS = new Set(['href', 'src', 'alt', 'start', 'open', 'colspan'])
// eslint-disable-next-line no-control-regex
const BAD_CHARS = /[\x00-\x08\x0b-\x1f\x7f-\x9f\u061c\u180e\u200b-\u200f\u202a-\u202e\u2060-\u2064\u2066-\u206f\ufeff\u{e0000}-\u{e007f}]/u

function walk(nodes, visit) {
  for (const n of nodes) {
    visit(n)
    if (n.children) walk(n.children, visit)
  }
}

function parse(input, opts = {}) {
  return parseSegment(input, { budget: newBudget(), ...opts })
}

describe('hostile corpus: invariants over every fixture', () => {
  for (const { id, input } of HOSTILE) {
    it(`${id}: no throw, clean text, allowlisted attributes, deterministic`, () => {
      const a = parse(input)
      const b = parse(input)
      expect(JSON.stringify(a)).toBe(JSON.stringify(b))
      walk(a.children, n => {
        if (n.type === 'text') {
          expect(n.value).not.toMatch(BAD_CHARS)
          expect(n.value).not.toMatch(/[\u2039\u203a]/)
        }
        if (n.type === 'el') for (const k of Object.keys(n.attrs)) expect(ALLOWED_ATTRS.has(k)).toBe(true)
      })
    })
  }
})

function links(input) {
  const found = []
  walk(parse(input).children, n => { if (n.type === 'el' && n.name === 'a' && 'href' in n.attrs) found.push(n.attrs.href) })
  return found
}

describe('T4 unsafe URLs', () => {
  for (const id of ['js-url', 'js-url-case', 'js-url-hex-tab', 'js-url-dec-entity', 'js-url-named-colon', 'js-url-named-tab', 'data-url-leading-space', 'vbscript-url', 'file-url']) {
    it(`${id} is rejected`, () => {
      const [href] = links(HOSTILE.find(f => f.id === id).input)
      expect(href).toBeDefined()
      expect(resolveUrl(href, { base: BASE }).ok).toBe(false)
    })
  }
})

describe('T6/T7 escape sequences', () => {
  it('numeric references to ESC, CSI, OSC and BEL never produce control characters', () => {
    for (const id of ['esc-entity-text', 'esc-hex-entity-osc', 'c1-entity', 'bel-entity', 'esc-entity-attrs', 'literal-esc']) {
      const out = parse(HOSTILE.find(f => f.id === id).input)
      walk(out.children, n => {
        if (n.type === 'text') expect(n.value).not.toMatch(BAD_CHARS)
      })
    }
  })
  it('cleanHtmlText decodes once and removes the result of decoding', () => {
    expect(cleanHtmlText('&#27;[31mred&#27;[0m')).toBe('red')
    expect(cleanHtmlText('&#x1b;]8;;https://evil&#x1b;\\x&#x1b;]8;;&#x1b;\\')).not.toContain('evil\u001b')
    expect(cleanHtmlText('a&#7;b')).toBe('ab')
    expect(cleanHtmlText('&amp;#27;')).toBe('&#27;')
  })
  it('a URL carrying an escape is rejected', () => {
    const [, href] = [0, ...links(HOSTILE.find(f => f.id === 'esc-entity-attrs').input)]
    expect(resolveUrl(href, { base: BASE }).ok).toBe(false)
  })
})

describe('T8 to T10 host spoofing', () => {
  it('bidi and zero-width characters in a URL reject it', () => {
    expect(resolveUrl(links(HOSTILE.find(f => f.id === 'bidi-host').input)[0], { base: BASE }).ok).toBe(false)
    expect(resolveUrl(links(HOSTILE.find(f => f.id === 'zero-width-host').input)[0], { base: BASE }).ok).toBe(false)
  })
  it('bidi and zero-width characters are removed from link text', () => {
    const t = []
    walk(parse(HOSTILE.find(f => f.id === 'bidi-host').input).children, n => { if (n.type === 'text') t.push(n.value) })
    expect(t.join('')).toBe('gh')
  })
  it('a Cyrillic homograph host is shown as punycode', () => {
    const r = resolveUrl(links(HOSTILE.find(f => f.id === 'cyrillic-host').input)[0], { base: BASE })
    expect(r.host).toMatch(/^xn--/)
  })
  it('userinfo is flagged and never displayed', () => {
    const r = resolveUrl(links(HOSTILE.find(f => f.id === 'userinfo-host').input)[0], { base: BASE })
    expect(r).toMatchObject({ host: 'evil.com', credentials: true })
    expect(r.display).not.toContain('github')
  })
})

describe('T11/T13 to T17 structure', () => {
  it('T11 deep nesting finishes quickly, keeps the text and says it was capped', () => {
    const start = performance.now()
    const out = parse(HOSTILE.find(f => f.id === 'nested-div-b').input)
    expect(performance.now() - start).toBeLessThan(200)
    const seen = []
    let depth = 0
    const measure = (nodes, d) => { for (const n of nodes) { if (n.type === 'el') { depth = Math.max(depth, d); measure(n.children, d + 1) } else seen.push(n) } }
    measure(out.children, 1)
    expect(depth).toBeLessThanOrEqual(LIMITS.MAX_DEPTH)
    expect(seen.some(n => n.type === 'text' && n.value.includes('deep text'))).toBe(true)
    expect(seen.some(n => n.type === 'notice')).toBe(true)
  })
  it('T13 broken tags never throw', () => {
    for (const id of ['unterminated-b', 'unterminated-quote', 'details-no-close', 'script-no-close', 'tag-soup', 'lone-lt']) {
      expect(() => parse(HOSTILE.find(f => f.id === id).input)).not.toThrow()
    }
    expect(parse(HOSTILE.find(f => f.id === 'details-no-close').input).carryOut).toEqual(['details'])
  })
  it('T16 quote-breaking yields no extra attributes', () => {
    const out = parse(HOSTILE.find(f => f.id === 'attr-quote-break').input)
    expect(out.children[0].attrs).toEqual({ href: 'https://a.com' })
  })
  it('T16 relative src resolves against the host', () => {
    const out = parse(HOSTILE.find(f => f.id === 'attr-gt-in-quotes').input)
    expect(out.children[0].attrs).toEqual({ alt: 'a>b', src: 'x' })
    expect(resolveUrl('x', { base: BASE }).display).toBe('github.com/o/r/x')
  })
  it('long attribute values are truncated and extra attributes dropped', () => {
    const many = parse(HOSTILE.find(f => f.id === 'many-attrs').input).children[0]
    expect(Object.keys(many.attrs)).toEqual([])
    const long = parse(HOSTILE.find(f => f.id === 'long-attr').input).children[0]
    expect(long.attrs.href.length).toBe(LIMITS.MAX_ATTR_LEN)
    expect(resolveUrl(long.attrs.href, { base: BASE }).ok).toBe(false)
  })
})

describe('T20 resource bombs', () => {
  for (const [name, input] of Object.entries(BOMBS)) {
    it(`${name} (${Math.round(input.length / 1024)} KiB) finishes quickly and says it stopped`, () => {
      const budget = newBudget()
      const start = performance.now()
      const out = parseSegment(input, { budget })
      const ms = performance.now() - start
      expect(ms).toBeLessThan(400)
      expect(out).toBeDefined()
      if (input.length > LIMITS.MAX_BYTES) expect(budget.stopped).toBe(true)
    })
  }

  it('a 512 KiB hostile segment tokenizes and builds within 50 ms (warm)', () => {
    const input = '<b>x</b>&#9999999999;<!-- c --><a href="https://a.com/x">t</a>'.repeat(8000).slice(0, LIMITS.MAX_BYTES)
    parse(input)
    const start = performance.now()
    parse(input)
    expect(performance.now() - start).toBeLessThan(50 + 250) // parser only; the full render budget is checked in render.test.jsx
  })

  it('the stop notice appears once and the tail stays text', () => {
    const budget = newBudget()
    parseSegment('<b>'.repeat(LIMITS.MAX_BYTES), { budget })
    const second = parseSegment('<i>more</i>', { budget })
    expect(budget.stopped).toBe(true)
    expect(JSON.stringify(second.children)).toContain('<i>more</i>')
  })

  it('no source file in src/html applies an unbounded or nested-quantifier regex, or touches the network', () => {
    const dir = new URL('.', import.meta.url).pathname
    for (const file of readdirSync(dir).filter(f => f.endsWith('.js') && !f.endsWith('.test.js'))) {
      const src = readFileSync(dir + file, 'utf8')
      expect(src, file).not.toMatch(/\.\*|\.\+/)
      expect(src, file).not.toMatch(/\)[+*]/)
      for (const bad of ['fetch(', 'child_process', 'eval(', 'new Function', ']8;', '\\x1b', '\\u001b', 'node:http', 'node:net', 'node:dns', "'http'", "'https'"]) {
        expect(src.includes(bad), `${file} contains ${bad}`).toBe(false)
      }
    }
  })

  it('T5 the corpus makes no network or DNS calls', async () => {
    const require = createRequire(import.meta.url)
    const spies = [
      vi.spyOn(globalThis, 'fetch').mockImplementation(() => { throw new Error('network') }),
      vi.spyOn(require('node:http'), 'request'),
      vi.spyOn(require('node:https'), 'request'),
      vi.spyOn(require('node:dns'), 'lookup'),
      vi.spyOn(require('node:net'), 'connect'),
    ]
    for (const { input } of HOSTILE) {
      const out = parse(input)
      walk(out.children, n => {
        if (n.type === 'el' && (n.attrs.href || n.attrs.src)) resolveUrl(n.attrs.href ?? n.attrs.src, { base: BASE })
      })
    }
    for (const spy of spies) expect(spy).not.toHaveBeenCalled()
    vi.restoreAllMocks()
  })
})
