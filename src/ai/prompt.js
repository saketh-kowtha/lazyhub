/** prompt.js — Pure prompt-building helpers and system templates for AI. */
/**
 * src/ai/prompt.js — Pure prompt-building helpers.
 *
 * Extracted unchanged from src/ai.js. These are research-backed techniques
 * and must NOT be modified without updating the citations in src/ai.js.
 *
 * Research-backed techniques applied:
 *
 *  1. PR description in prompt: +72% F1 improvement (ContextCRBench, 2024)
 *  2. Inline line numbers embedded in diff lines: KBI 23.7% → 42.96%
 *     (Towards Practical Defect-Focused Automated Code Review, 2025)
 *  3. Diff pruning — strip pure-deletion hunks + keep ±3 context lines:
 *     "Left Flow" approach (same paper)
 */

// ── Constants ─────────────────────────────────────────────────────────────────

export const MAX_DIFF_CHARS = 16_000
export const CONTEXT_LINES  = 3
export const MAX_TOKENS     = 1024
export const DEFAULT_MODEL  = 'claude-haiku-4-5-20251001'

export const VALID_SEVERITIES = new Set(['bug', 'warning', 'suggestion'])

// ── System prompt ─────────────────────────────────────────────────────────────

export const SYSTEM_PROMPT = `You are a senior engineer reviewing a GitHub PR diff. Return ONLY valid JSON — no prose, no markdown fences.

Schema:
{
  "summary": "1-2 sentence overall assessment",
  "suggestions": [
    {
      "file": "path/to/file.js",
      "line": <integer from the line numbers shown in the diff, or null>,
      "severity": "bug" | "warning" | "suggestion",
      "comment": "concise actionable comment, max 150 chars"
    }
  ]
}

Severity:
- bug: runtime error, data loss, security issue, React hook violation
- warning: potential problem, incorrect pattern, missing error handling at real boundaries
- suggestion: performance, clarity, or architectural improvement

Rules:
- Only flag what is clearly wrong or risky. No style preferences, no speculative edge cases.
- Read the inline line numbers (e.g. "  42: + const x = ...") to set accurate "line" values.
- Skip if changes look correct — return empty suggestions with a positive summary.
- No duplicate suggestions. Maximum 6 suggestions total.`

// ── Diff pruning + inline line-number annotation ──────────────────────────────
//
// Two transformations applied before sending to the model:
//
// A) Pure-deletion hunks are dropped entirely — the model doesn't need to know
//    what was removed, only what was added/changed. Cuts tokens ~40-50%.
//
// B) Inline line numbers are prepended to each line in `+` hunks:
//      "42: + const result = compute()"
//    Research shows this format raises KBI from 23.7% to 42.96% and lets the
//    model produce accurate `line` values in its JSON output.

/**
 * Annotate a unified diff with inline line numbers and prune pure-deletion hunks.
 * @param {string} diffText - Raw unified diff text
 * @returns {string} Annotated diff
 */
export function annotateDiff(diffText) {
  if (!diffText) return ''

  const lines = diffText.split('\n')
  const out = []
  let i = 0

  while (i < lines.length) {
    const line = lines[i]

    // File header lines — always keep as-is
    if (line.startsWith('diff ') || line.startsWith('index ') ||
        line.startsWith('--- ') || line.startsWith('+++ ')) {
      out.push(line)
      i++
      continue
    }

    // Hunk header — scan the hunk body, then decide
    if (line.startsWith('@@')) {
      const hunkHeader = line
      // Extract new-file start line from "@@ -old +new,len @@"
      const m = line.match(/\+(\d+)/)
      let newLine = m ? parseInt(m[1], 10) - 1 : 0

      const hunkLines = []
      i++
      while (i < lines.length && !lines[i].startsWith('@@') && !lines[i].startsWith('diff ')) {
        hunkLines.push(lines[i])
        i++
      }

      // Skip hunks that only remove lines (no additions)
      const hasAdditions = hunkLines.some(l => l.startsWith('+'))
      if (!hasAdditions) continue

      // Track which indices to keep (±CONTEXT_LINES around each + line)
      const keepIdx = new Set()
      const lineNums = []  // new-file line number per hunkLine index

      for (const hl of hunkLines) {
        if (hl.startsWith('-')) {
          lineNums.push(null)  // removed line: no new-file number
        } else {
          newLine++
          lineNums.push(newLine)
        }
      }

      for (let j = 0; j < hunkLines.length; j++) {
        if (hunkLines[j].startsWith('+')) {
          for (let k = Math.max(0, j - CONTEXT_LINES); k <= Math.min(hunkLines.length - 1, j + CONTEXT_LINES); k++) {
            keepIdx.add(k)
          }
        }
      }

      out.push(hunkHeader)
      let lastKept = -1
      for (let j = 0; j < hunkLines.length; j++) {
        if (!keepIdx.has(j)) continue
        if (lastKept >= 0 && j > lastKept + 1) out.push('  ...')
        const hl = hunkLines[j]
        const ln = lineNums[j]
        if (ln != null) {
          // Inline line number: "42:  const x" or "42: + const x"
          out.push(`${String(ln).padStart(4)}: ${hl}`)
        } else {
          out.push(`    : ${hl}`)  // removed line — rare since we skip pure-deletion hunks
        }
        lastKept = j
      }
      continue
    }

    out.push(line)
    i++
  }

  return out.join('\n')
}

/**
 * Build the user message for a code review request.
 * @param {object} opts
 * @param {string} opts.diff      - Raw unified diff text
 * @param {string} opts.prTitle   - PR title for context
 * @param {string} opts.prBody    - PR description (+72% F1 improvement)
 * @returns {string} User message text
 */
export function buildUserPrompt({ diff, prTitle, prBody }) {
  const annotated = annotateDiff(diff || '')
  const truncated = annotated.slice(0, MAX_DIFF_CHARS)

  // PR description is the highest-value context (+72% F1 per research)
  // Put it BEFORE the diff so the model reads intent before code
  return [
    `PR Title: ${prTitle || '(untitled)'}`,
    prBody ? `PR Description:\n${prBody.slice(0, 500)}` : null,
    '',
    '--- Diff (line numbers shown inline as "NNNN: + code") ---',
    truncated || '(empty diff)',
  ].filter(s => s !== null).join('\n')
}
