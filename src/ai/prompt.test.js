/**
 * src/ai/prompt.test.js — Unit tests for diff annotation and prompt building.
 */

import { describe, it, expect } from 'vitest'
import { annotateDiff, buildUserPrompt, MAX_DIFF_CHARS, CONTEXT_LINES } from './prompt.js'

describe('constants', () => {
  it('MAX_DIFF_CHARS is 16000', () => {
    expect(MAX_DIFF_CHARS).toBe(16_000)
  })

  it('CONTEXT_LINES is 3', () => {
    expect(CONTEXT_LINES).toBe(3)
  })
})

describe('annotateDiff', () => {
  it('returns empty string for empty/null input', () => {
    expect(annotateDiff('')).toBe('')
    expect(annotateDiff(null)).toBe('')
    expect(annotateDiff(undefined)).toBe('')
  })

  it('keeps file header lines unchanged', () => {
    const diff = 'diff --git a/foo.js b/foo.js\nindex abc..def 100644\n--- a/foo.js\n+++ b/foo.js\n@@ -1 +1 @@\n-old\n+new'
    const out = annotateDiff(diff)
    expect(out).toContain('diff --git a/foo.js b/foo.js')
    expect(out).toContain('--- a/foo.js')
    expect(out).toContain('+++ b/foo.js')
  })

  it('annotates added lines with inline line numbers', () => {
    const diff = '--- a/foo.js\n+++ b/foo.js\n@@ -1,1 +1,2 @@\n context\n+added line'
    const out = annotateDiff(diff)
    // The +added line should have a line number prefix
    expect(out).toMatch(/\d+: \+added line/)
  })

  it('drops pure-deletion hunks (no + lines)', () => {
    const diff = '--- a/foo.js\n+++ b/foo.js\n@@ -1,2 +1,1 @@\n-removed line\n context'
    const out = annotateDiff(diff)
    // The hunk has no additions — should be skipped
    expect(out).not.toContain('-removed line')
    expect(out).not.toContain('context')
  })

  it('keeps hunks that have both additions and deletions', () => {
    const diff = '--- a/foo.js\n+++ b/foo.js\n@@ -1,2 +1,2 @@\n-old line\n+new line\n context'
    const out = annotateDiff(diff)
    expect(out).toContain('+new line')
  })

  it('adds context lines around additions (±CONTEXT_LINES)', () => {
    // Build a hunk with many lines; only 1 has + but context should include nearby lines
    const hunkLines = Array.from({ length: 10 }, (_, i) => ` line${i}`)
    hunkLines[5] = '+changed'
    const diff = `--- a/foo.js\n+++ b/foo.js\n@@ -1,10 +1,10 @@\n${hunkLines.join('\n')}`
    const out = annotateDiff(diff)
    // Should include the changed line
    expect(out).toContain('+changed')
    // Should include ±3 context around it
    expect(out).toContain('line2')  // 5-3 = line 2 (index 2)
    expect(out).toContain('line8')  // 5+3 = line 8 (index 8)
    // Should NOT include far-away lines
    expect(out).not.toContain('line0')  // index 0 is beyond 3 away
    expect(out).not.toContain('line9')  // index 9 is beyond 3 away
  })
})

describe('buildUserPrompt', () => {
  it('includes PR title', () => {
    const out = buildUserPrompt({ diff: '', prTitle: 'Fix crash', prBody: '' })
    expect(out).toContain('PR Title: Fix crash')
  })

  it('includes PR description when provided', () => {
    const out = buildUserPrompt({ diff: '', prTitle: 'T', prBody: 'Fixes the crash in prod' })
    expect(out).toContain('PR Description:')
    expect(out).toContain('Fixes the crash in prod')
  })

  it('omits PR description section when empty', () => {
    const out = buildUserPrompt({ diff: '', prTitle: 'T', prBody: '' })
    expect(out).not.toContain('PR Description:')
  })

  it('truncates diff at MAX_DIFF_CHARS', () => {
    const longDiff = 'x'.repeat(MAX_DIFF_CHARS + 1000)
    const out = buildUserPrompt({ diff: longDiff, prTitle: 'T', prBody: '' })
    expect(out).not.toContain('x'.repeat(MAX_DIFF_CHARS + 1))
  })

  it('falls back to (untitled) when prTitle is empty', () => {
    const out = buildUserPrompt({ diff: '', prTitle: '', prBody: '' })
    expect(out).toContain('(untitled)')
  })
})
