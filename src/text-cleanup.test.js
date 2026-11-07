/**
 * Text cleanup contract for GitHub-provided content: table rows, seeded
 * property tests, and size/linearity bounds. See src/utils-core.js.
 */
import { describe, it, expect } from 'vitest'
import * as core from './utils-core.js'
import * as utils from './utils.js'

const { sanitize, sanitizeBlock, sanitizeRaw, sanitizeLog, sanitizeCode, sanitizePath, stripAnsi, decodeHtmlEntities } = core

const ESC = '\u001b'
const J = JSON.stringify
const BEL = '\u0007'
const ST = `${ESC}\\`
const FFFD = '\ufffd'

describe('re-exports', () => {
  it('utils.js exposes the cleanup helpers', () => {
    for (const name of ['sanitize', 'sanitizeBlock', 'sanitizeRaw', 'sanitizeLog', 'sanitizeCode', 'sanitizePath', 'stripAnsi', 'decodeHtmlEntities']) {
      expect(typeof utils[name]).toBe('function')
    }
  })
})

describe('sanitize: escape strings and control characters', () => {
  /** @type {Array<[string, string, string]>} */
  const rows = [
    ['string escape ended by BEL', `a${ESC}]0;title${BEL}b`, 'ab'],
    ['string escape ended by ST', `a${ESC}]0;title${ST}b`, 'ab'],
    ['string escape with a long body', `a${ESC}]2;${'t'.repeat(300)}${BEL}b`, 'ab'],
    ['string escape around link text', `${ESC}]8;;https://example.invalid${BEL}click${ESC}]8;;${BEL}`, 'click'],
    ['8-bit string escape and terminator', 'a\u009d0;title\u009cb', 'ab'],
    ['device string escape', `a${ESC}Pplain-body${ST}b`, 'ab'],
    ['application string escape', `${ESC}_x${ST}`, ''],
    ['privacy string escape', `${ESC}^x${ST}`, ''],
    ['start-of-string escape', `${ESC}Xx${ST}`, ''],
    ['parameter escape with several values', `a${ESC}[1;31;4mb`, 'ab'],
    ['parameter escape with a private marker', `a${ESC}[?25hb`, 'ab'],
    ['parameter escape with an intermediate', `a${ESC}[2 qb`, 'ab'],
    ['8-bit parameter escape', 'a\u009b31mb', 'ab'],
    ['unterminated string escape keeps the body text', `a${ESC}]0;unterminated title`, 'a0;unterminated title'],
    ['trailing lone escape', `a${ESC}`, 'a'],
    ['reset', `${ESC}c`, ''],
    ['charset', `${ESC}(B`, ''],
    ['save cursor', `${ESC}7`, ''],
    ['bell, backspace, delete, nul', `a${BEL}b\bc\u007fd\u0000e`, 'abcde'],
    ['NEL is a line break', 'a\u0085b', 'a b'],
    ['other C1', 'a\u0090b', 'ab'],
    ['bidi override', 'user\u202etxt.exe', 'usertxt.exe'],
    ['bidi isolates', '\u2066x\u2069', 'x'],
    ['bidi mark', '\u200f', ''],
    ['arabic letter mark', '\u061c', ''],
    ['invisible format and tags', 'a\u200bb\ufeff\u00ad\u2060\u{E0041}', 'ab'],
    ['lone high surrogate', 'x\uD800y', `x${FFFD}y`],
    ['lone low surrogate', '\uDC00', FFFD],
    ['line form', 'a\r\nb\tc d', 'a b c d'],
  ]
  for (const [name, input, expected] of rows) {
    it(name, () => {
      expect(JSON.stringify(sanitize(input))).toBe(JSON.stringify(expected))
      expect(JSON.stringify(stripAnsi(sanitize(input)))).toBe(JSON.stringify(sanitize(input)))
    })
  }
})

describe('sanitize: numeric references', () => {
  /** @type {Array<[string, string, string]>} */
  const rows = [
    ['encoded escape sequence is removed', '&#27;[31mX', 'X'],
    ['encoded 8-bit sequence is removed', '&#155;31mX', 'X'],
    ['encoded bidi', '&#8238;X', 'X'],
    ['encoded bell', '&#7;', ''],
    ['single pass decode', '&amp;#27;', '&#27;'],
    ['hex references are literal text', '&#x1b;', '&#x1b;'],
    ['above the unicode range', '&#99999999999;', FFFD],
    ['one above the maximum', '&#1114112;', FFFD],
    ['very long digit string', `&#${'9'.repeat(400)};`, FFFD],
    ['surrogate', '&#55357;', FFFD],
    ['last surrogate', '&#57343;', FFFD],
    ['zero', '&#0;', FFFD],
    ['apostrophe', '&#39;', "'"],
    ['emoji', '&#128512;', '\u{1F600}'],
    ['markup characters', '&lt;b&gt;', '<b>'],
  ]
  for (const [name, input, expected] of rows) {
    it(name, () => {
      expect(() => sanitize(input)).not.toThrow()
      expect(JSON.stringify(sanitize(input))).toBe(JSON.stringify(expected))
    })
  }

  it('decodeHtmlEntities never throws on malformed references', () => {
    expect(J(decodeHtmlEntities('&#99999999999;'))).toBe(J(FFFD))
    expect(J(decodeHtmlEntities(`&#${'9'.repeat(400)};`))).toBe(J(FFFD))
    expect(J(decodeHtmlEntities('&#55357;'))).toBe(J(FFFD))
  })

  it('decodeHtmlEntities keeps accepting non-strings', () => {
    expect(J(decodeHtmlEntities(null))).toBe(J(''))
    expect(J(decodeHtmlEntities(42))).toBe(J('42'))
  })
})

describe('the other cleanup forms', () => {
  it('sanitizeBlock keeps line structure', () => {
    expect(J(sanitizeBlock('a\r\nb\rc d'))).toBe(J('a\nb\nc d'))
    expect(J(sanitizeBlock('a\u2028b\u2029c'))).toBe(J('a\nb\nc'))
    expect(J(sanitizeBlock(`a${ESC}[31m\nb&lt;`))).toBe(J('a\nb<'))
  })

  it('sanitizeRaw does not decode entities', () => {
    expect(J(sanitizeRaw(`&amp;${ESC}[31mx`))).toBe(J('&amp;x'))
    expect(J(sanitizeRaw('a\nb\tc'))).toBe(J('a b c'))
  })

  it('sanitizeLog expands tabs and keeps lines', () => {
    expect(J(sanitizeLog(`a\tb${ESC}[0m\r\nc`))).toBe(J('a   b\nc'))
    expect(J(sanitizeLog('&amp;'))).toBe(J('&amp;'))
  })

  it('sanitizeCode marks control characters instead of removing them', () => {
    const out = sanitizeCode(`x\u202ey${ESC}[31m\tz`)
    expect(out.startsWith('x<U+202E>y\u241b[31m')).toBe(true)
    expect(out.endsWith('z')).toBe(true)
    expect(out).not.toContain('\t')
    expect(out).not.toContain(ESC)
    expect(J(sanitizeCode('a\u007fb\u0085c\u0007'))).toBe(J('a\u2421b<U+0085>c\u2407'))
    expect(J(sanitizeCode('&amp; &#27;'))).toBe(J('&amp; &#27;'))
  })

  it('sanitizePath marks control characters', () => {
    expect(J(sanitizePath('src/\u202egnp.js'))).toBe(J('src/<U+202E>gnp.js'))
    expect(J(sanitizePath(`a${ESC}b`))).toBe(J('a\u241bb'))
    expect(J(sanitizePath('a\u{E0041}b'))).toBe(J('a<U+E0041>b'))
    expect(J(sanitizePath('src/app.js'))).toBe(J('src/app.js'))
  })

  it('stripAnsi keeps non-strings as they are', () => {
    expect(J(stripAnsi(42))).toBe(J(42))
    expect(J(stripAnsi(null))).toBe(J(null))
  })

  it('stripAnsi keeps newlines and tabs', () => {
    expect(J(stripAnsi(`a${ESC}[1mb\n\tc`))).toBe(J('ab\n\tc'))
  })

  it('keeps glyph glue and emoji untouched', () => {
    const family = '\u{1F468}\u200d\u{1F469}\u200d\u{1F467}'
    expect(J(sanitize(family))).toBe(J(family))
    expect(J(sanitize('\u2764\ufe0f \u{1F44D}\u{1F3FD}'))).toBe(J('\u2764\ufe0f \u{1F44D}\u{1F3FD}'))
  })

  it('never throws on odd input types', () => {
    for (const fn of [sanitize, sanitizeBlock, sanitizeRaw, sanitizeLog, sanitizeCode, sanitizePath]) {
      expect(J(fn(null))).toBe(J(''))
      expect(J(fn(undefined))).toBe(J(''))
      expect(J(fn(42))).toBe(J('42'))
      expect(J(fn({}))).toBe(J('[object Object]'))
    }
  })
})

// ── seeded property tests ────────────────────────────────────────────────────

/**
 * Small deterministic PRNG.
 * @param {number} seed
 */
function mulberry32(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const SEED = Number(process.env.LAZYHUB_FUZZ_SEED || 20261108)
const CASES = 5000

const FRAGMENTS = {
  ascii: () => 'abc xyz 0189 .,:;/\\-_()[]{}<>!?"\'#%*+=@^|~`$'.split(''),
  c0: () => Array.from({ length: 32 }, (_, i) => String.fromCharCode(i)),
  c1: () => Array.from({ length: 33 }, (_, i) => String.fromCharCode(0x7f + i)),
  esc: () => [`${ESC}[`, `${ESC}]`, `${ESC}P`, `${ESC}_`, `${ESC}^`, `${ESC}X`, ST, BEL, '\u009c', '\u009b', '\u009d', `${ESC}[31m`, `${ESC}]0;t${BEL}`, ESC, `${ESC}(`, `${ESC} `],
  entity: () => ['&#', '&amp;', '&lt;', '&#27;', '&#155;', '&#99999999999;', '&#55357;', '&#0;', ';', '1', '9', '&#x1b;', '&quot;'],
  format: () => ['\u202e', '\u202a', '\u2066', '\u2069', '\u200b', '\u200c', '\u200d', '\u200e', '\u200f', '\u061c', '\ufeff', '\u00ad', '\u2060', '\u3164', '\u{E0041}', '\u{1D173}', '\ufffe', '\uffff', '\u2028', '\u2029', '\u0085'],
  surrogate: () => ['\uD800', '\uDC00', '\uD83D', '\uDE00', '\u{1F600}'],
  other: () => ['\u{1F680}', '\u2705', '\u6f22', '\u5b57', '\u00e9', '\ufe0f', '\u{1F3FD}', '\t', '\r', '\n', '\r\n'],
}
const WEIGHTED = [
  ['ascii', 10], ['c0', 3], ['c1', 2], ['esc', 4], ['entity', 3], ['format', 3], ['surrogate', 2], ['other', 3],
].flatMap(([k, w]) => Array(w).fill(k))
const POOLS = Object.fromEntries(Object.entries(FRAGMENTS).map(([k, f]) => [k, f()]))

/** @param {() => number} rnd */
function genString(rnd) {
  const len = Math.floor(rnd() * 513)
  let out = ''
  while (out.length < len) {
    const pool = POOLS[WEIGHTED[Math.floor(rnd() * WEIGHTED.length)]]
    out += pool[Math.floor(rnd() * pool.length)]
  }
  return out.slice(0, len)
}

const FORBIDDEN = new RegExp('[\\u0000-\\u0008\\u000B-\\u001F\\u007F-\\u009F\\u061C\\u200B\\u200C\\u200E\\u200F\\u2028\\u2029\\u202A-\\u202E\\u2066-\\u2069\\uFEFF]', 'u')
const LINE_FORMS = { sanitize, sanitizeRaw, sanitizeCode, sanitizePath }
const ALL = { sanitize, sanitizeBlock, sanitizeRaw, sanitizeLog, sanitizeCode, sanitizePath, stripAnsi }
const IDEMPOTENT = { sanitizeRaw, sanitizeLog, sanitizeCode, sanitizePath, stripAnsi }

describe(`property tests (seed ${SEED}, ${CASES} cases per function)`, () => {
  for (const [name, fn] of Object.entries(ALL)) {
    it(`${name}: never throws, output is clean and well-formed`, () => {
      const rnd = mulberry32(SEED)
      for (let i = 0; i < CASES; i++) {
        const input = genString(rnd)
        const out = fn(input)
        expect(typeof out).toBe('string')
        if (FORBIDDEN.test(out) || !out.isWellFormed()) throw new Error(`${name} case ${i}: unclean output ${JSON.stringify(out)} for ${JSON.stringify(input)}`)
        if (name in LINE_FORMS && out.includes('\n')) throw new Error(`${name} case ${i}: newline in line form`)
        if (name !== 'stripAnsi' && name !== 'sanitizeBlock' && out.includes('\t')) throw new Error(`${name} case ${i}: tab in output`)
        if (name === 'sanitizeBlock' && out.includes('\t')) throw new Error('tab in block output')
      }
    })
  }

  for (const [name, fn] of Object.entries(IDEMPOTENT)) {
    it(`${name}: idempotent`, () => {
      const rnd = mulberry32(SEED + 1)
      for (let i = 0; i < CASES; i++) {
        const input = genString(rnd)
        const once = fn(input)
        if (fn(once) !== once) throw new Error(`${name} case ${i}: not idempotent for ${JSON.stringify(input)}`)
      }
    })
  }

  it('stripAnsi leaves sanitize output alone', () => {
    const rnd = mulberry32(SEED + 2)
    for (let i = 0; i < CASES; i++) {
      const out = sanitize(genString(rnd))
      if (stripAnsi(out) !== out) throw new Error(`case ${i}: ${JSON.stringify(out)}`)
    }
  })

  it('plain printable text comes back unchanged', () => {
    const rnd = mulberry32(SEED + 3)
    const plain = ['a', 'Z', '7', ' ', '.', '/', '-', '_', '(', ')', '\u6f22', '\u5b57', '\u{1F680}', '\u{1F600}', '\u00e9', '\u2705']
    for (let i = 0; i < CASES; i++) {
      let s = ''
      const len = Math.floor(rnd() * 200)
      for (let j = 0; j < len; j++) s += plain[Math.floor(rnd() * plain.length)]
      for (const [name, fn] of Object.entries(ALL)) {
        if (fn(s) !== s) throw new Error(`${name} changed plain text ${JSON.stringify(s)}`)
      }
    }
  })
})

// ── size and linearity bounds ────────────────────────────────────────────────

/** @param {() => unknown} fn */
function timeMs(fn) {
  const t0 = performance.now()
  fn()
  return performance.now() - t0
}
/**
 * @param {() => unknown} fn
 * @param {number} [n]
 */
function bestOf(fn, n = 3) {
  return Math.min(...Array.from({ length: n }, () => timeMs(fn)))
}
/**
 * @param {string} unit
 * @param {number} bytes
 */
function repeatTo(unit, bytes) {
  return unit.repeat(Math.ceil(bytes / unit.length)).slice(0, bytes)
}

describe('size bounds', () => {
  it('sanitizeLog handles a 10 MB log within one second', () => {
    const line = `build\tTest step\t2026-01-02T03:04:05.1234567Z ${ESC}[32mok${ESC}[0m  \ttimestamped message with some text and a tab\r\n`
    const log = repeatTo(line, 10 * 1024 * 1024)
    const ms = bestOf(() => sanitizeLog(log), 2)
    expect(ms).toBeLessThan(1000)
    const out = sanitizeLog(log)
    expect(out).not.toContain(ESC)
    expect(out).not.toContain('\t')
  })

  const ADVERSARIAL = {
    'unterminated string introducers': n => repeatTo('\u001b]', n),
    'long parameter lists': n => `\u001b[${repeatTo('1;', n)}`,
    'long numeric references': n => repeatTo(`&#${'9'.repeat(20)}`, n),
    'long device string body': n => `\u001bP${'a'.repeat(n)}`,
    'repeated bidi controls': n => '\u202e'.repeat(n),
    'repeated 8-bit string introducers': n => repeatTo('\u009da', n),
    'repeated escape and space': n => repeatTo('\u001b ', n),
  }
  for (const [name, make] of Object.entries(ADVERSARIAL)) {
    it(`scales linearly: ${name}`, () => {
      const small = make(1024 * 1024)
      const big = make(10 * 1024 * 1024)
      for (const [fname, fn] of Object.entries({ sanitizeLog, sanitize })) {
        const t1 = Math.max(bestOf(() => fn(small)), 20)
        const t10 = bestOf(() => fn(big), 2)
        expect(t10, `${fname} 10MB`).toBeLessThan(2000)
        // 10x the input: linear work is ~10x, quadratic would be ~100x; 30x leaves room for timer and load noise.
        expect(t10, `${fname} ratio`).toBeLessThanOrEqual(t1 * 30)
      }
    })
    it(`marking form scales linearly: ${name}`, () => {
      const small = make(100 * 1024)
      const big = make(1024 * 1024)
      const t1 = Math.max(bestOf(() => sanitizeCode(small)), 30)
      const t10 = bestOf(() => sanitizeCode(big), 2)
      expect(t10).toBeLessThanOrEqual(t1 * 30)
    })
  }

  it('sanitize on a 200 character title is cheap', () => {
    const title = repeatTo('Fix the thing in the module (#123) ', 200)
    sanitize(title)
    const iterations = 100000
    const t0 = performance.now()
    for (let i = 0; i < iterations; i++) sanitize(title)
    const avgUs = ((performance.now() - t0) * 1000) / iterations
    expect(avgUs).toBeLessThan(5)
  })
})
