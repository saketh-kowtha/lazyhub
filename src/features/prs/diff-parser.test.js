/**
 * diff-parser.test.js — regression tests for the diff parsing pipeline.
 *
 * Covers Bug: "HTML entities still rendered raw in diff content"
 * Root cause: parseDiff stored raw line text without calling decodeHtmlEntities(),
 * so &#39; / &quot; / &#NNN; appeared verbatim in the rendered terminal output.
 */

import { describe, it, expect } from 'vitest'
import { parseDiff, flattenFiles } from './diff-parser.js'

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Build a minimal unified-diff fixture with the given code line as a + line.
 *
 * Note: the `--- a/file` header line begins with `-` so parseDiff (faithfully)
 * treats it as a del row. We omit it here to keep fixtures unambiguous; in
 * production the `--- ` line is harmless noise rendered as a dim deleted row.
 */
function makeDiff(codeLine) {
  return [
    'diff --git a/src/foo.js b/src/foo.js',
    '+++ b/src/foo.js',
    '@@ -1,3 +1,3 @@',
    ` context before`,
    `+${codeLine}`,
    ` context after`,
  ].join('\n')
}

// ── Bug: HTML entities in diff content ───────────────────────────────────────

describe('parseDiff — HTML entity decoding', () => {
  it('decodes &#39; (apostrophe) in added lines', () => {
    const files = parseDiff(makeDiff("const x = &#39;hello&#39;"))
    const addLine = files[0].lines.find(l => l.type === 'add')
    expect(addLine.text).toBe("const x = 'hello'")
    expect(addLine.text).not.toContain('&#39;')
  })

  it('decodes &quot; (double-quote) in added lines', () => {
    const files = parseDiff(makeDiff('className=&quot;foo&quot;'))
    const addLine = files[0].lines.find(l => l.type === 'add')
    expect(addLine.text).toBe('className="foo"')
    expect(addLine.text).not.toContain('&quot;')
  })

  it('decodes &#NNN; numeric entities in added lines', () => {
    // &#8216; = Unicode left single quotation mark U+2018
    const files = parseDiff(makeDiff('let s = &#8216;fancy&#8217;'))
    const addLine = files[0].lines.find(l => l.type === 'add')
    expect(addLine.text).toBe('let s = ‘fancy’')
    expect(addLine.text).not.toContain('&#8216;')
    expect(addLine.text).not.toContain('&#8217;')
  })

  it('decodes &amp; &lt; &gt; in deleted lines', () => {
    const diff = [
      'diff --git a/src/bar.jsx b/src/bar.jsx',
      '+++ b/src/bar.jsx',
      '@@ -1,1 +1,1 @@',
      '-if (a &lt; b &amp;&amp; c &gt; d) {}',
    ].join('\n')
    const files = parseDiff(diff)
    const delLine = files[0].lines.find(l => l.type === 'del')
    expect(delLine.text).toBe('if (a < b && c > d) {}')
  })

  it('decodes HTML entities in context lines', () => {
    const diff = [
      'diff --git a/README.md b/README.md',
      '+++ b/README.md',
      '@@ -1,1 +1,1 @@',
      ' it&#39;s a &quot;context&quot; line',
    ].join('\n')
    const files = parseDiff(diff)
    const ctxLine = files[0].lines.find(l => l.type === 'ctx')
    expect(ctxLine.text).toBe("it's a \"context\" line")
  })

  it('preserves plain text without entities unchanged', () => {
    const code = "const fn = (x) => x + 1"
    const files = parseDiff(makeDiff(code))
    const addLine = files[0].lines.find(l => l.type === 'add')
    expect(addLine.text).toBe(code)
  })
})

// ── Baseline parsing correctness ─────────────────────────────────────────────

describe('parseDiff — line type assignment', () => {
  // Note: `--- a/file` lines start with `-` so they parse as del rows.
  // We omit them in this fixture to keep the type-sequence assertions clean.
  const SAMPLE_DIFF = [
    'diff --git a/src/app.js b/src/app.js',
    '+++ b/src/app.js',
    '@@ -10,3 +10,3 @@',
    ' unchanged line',
    '-removed line',
    '+added line',
  ].join('\n')

  it('produces correct types for each line kind', () => {
    const files = parseDiff(SAMPLE_DIFF)
    expect(files).toHaveLength(1)
    const types = files[0].lines.map(l => l.type)
    expect(types).toEqual(['hunk', 'ctx', 'del', 'add'])
  })

  it('assigns correct oldLine / newLine values', () => {
    const files = parseDiff(SAMPLE_DIFF)
    const lines = files[0].lines
    // ctx: both present, starting at 10
    const ctx = lines.find(l => l.type === 'ctx')
    expect(ctx.oldLine).toBe(10)
    expect(ctx.newLine).toBe(10)
    // del: oldLine present, newLine null
    const del = lines.find(l => l.type === 'del')
    expect(del.oldLine).toBe(11)
    expect(del.newLine).toBeNull()
    // add: oldLine null, newLine present
    const add = lines.find(l => l.type === 'add')
    expect(add.oldLine).toBeNull()
    expect(add.newLine).toBe(11)
  })
})

// ── flattenFiles ─────────────────────────────────────────────────────────────

describe('flattenFiles', () => {
  it('prepends a file-header row for each file', () => {
    const files = parseDiff([
      'diff --git a/a.js b/a.js',
      '+++ b/a.js',
      '@@ -1,1 +1,1 @@',
      '+line',
    ].join('\n'))
    const rows = flattenFiles(files)
    expect(rows[0].type).toBe('file-header')
    expect(rows[0].filename).toBe('a.js')
  })

  it('assigns filename to every row', () => {
    const files = parseDiff([
      'diff --git a/a.js b/a.js',
      '+++ b/a.js',
      '@@ -1,1 +1,1 @@',
      '+line',
    ].join('\n'))
    const rows = flattenFiles(files)
    for (const row of rows) {
      expect(row.filename).toBe('a.js')
    }
  })
})
