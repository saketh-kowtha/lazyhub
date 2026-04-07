/**
 * claude-review.mjs
 * Posts a Claude code review as a PR review with inline line comments + fix suggestions.
 * Env vars required: ANTHROPIC_API_KEY, GITHUB_TOKEN, PR_NUMBER, REPO
 */

const { ANTHROPIC_API_KEY, GITHUB_TOKEN, PR_NUMBER, REPO } = process.env

const GH_HEADERS = {
  Authorization: `Bearer ${GITHUB_TOKEN}`,
  'Content-Type': 'application/json',
  'User-Agent': 'lazyhub-claude-review',
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function ghFetch(path, opts = {}) {
  const res = await fetch(`https://api.github.com/repos/${REPO}${path}`, {
    headers: GH_HEADERS,
    ...opts,
  })
  if (!res.ok) return null
  return res.json()
}

/** Extract Issues section text from a prior Claude review body (for context dedup). */
function extractIssues(body) {
  const m = body.match(/###\s*Issues\s*\n([\s\S]*?)(?=\n###\s|\n---\s|\*Reviewed by|$)/i)
  if (!m) return null
  const text = m[1].trim()
  if (/^none found\.?$/i.test(text)) return null
  return text.slice(0, 600)
}

/**
 * Parse a unified diff and return a Map<filePath, Set<newLineNumber>> of all
 * lines present in the RIGHT (new) side of the diff. Used to validate that
 * Claude's inline comments target real changed lines.
 */
function parseDiffChangedLines(diffText) {
  const files = new Map()
  let currentFile = null
  let currentNewLine = 0

  for (const raw of diffText.split('\n')) {
    // New file header
    const fileMatch = raw.match(/^\+\+\+ b\/(.+)$/)
    if (fileMatch) {
      currentFile = fileMatch[1]
      if (!files.has(currentFile)) files.set(currentFile, new Set())
      continue
    }
    // Hunk header: @@ -old,len +new,len @@
    const hunkMatch = raw.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/)
    if (hunkMatch) {
      currentNewLine = parseInt(hunkMatch[1], 10) - 1
      continue
    }
    if (!currentFile) continue
    if (raw.startsWith('+++') || raw.startsWith('---') || raw.startsWith('\\')) continue

    if (raw.startsWith('+')) {
      currentNewLine++
      files.get(currentFile).add(currentNewLine)
    } else if (raw.startsWith('-')) {
      // removed line — no new line number
    } else {
      // context line
      currentNewLine++
    }
  }
  return files
}

// ── 1. Fetch the PR diff ──────────────────────────────────────────────────────

const diffRes = await fetch(
  `https://api.github.com/repos/${REPO}/pulls/${PR_NUMBER}`,
  { headers: { ...GH_HEADERS, Accept: 'application/vnd.github.v3.diff' } }
)

if (!diffRes.ok) {
  console.error(`Failed to fetch PR diff: ${diffRes.status} ${diffRes.statusText}`)
  process.exit(1)
}

const diff = await diffRes.text()

if (!diff.trim()) {
  console.log('Empty diff — nothing to review.')
  process.exit(0)
}

const MAX_DIFF_CHARS = 80_000
const truncated = diff.length > MAX_DIFF_CHARS
const diffContent = truncated
  ? diff.slice(0, MAX_DIFF_CHARS) + '\n\n[...diff truncated at 80 000 chars...]'
  : diff

// Build changed-line index for validating inline comments
const changedLines = parseDiffChangedLines(diffContent)

// ── 2. Build previous-issues context ─────────────────────────────────────────

const knownIssues = []

try {
  const currentReviews = await ghFetch(`/pulls/${PR_NUMBER}/reviews`) || []
  for (const r of currentReviews) {
    if (!r.body?.includes('Claude Code Review') && !r.body?.includes('Claude Sonnet')) continue
    const issues = extractIssues(r.body)
    if (issues) knownIssues.push({ pr: `#${PR_NUMBER} (this PR)`, issues })
  }

  const merged = await ghFetch(`/pulls?state=closed&base=main&sort=updated&direction=desc&per_page=8`) || []
  const recentMerged = merged
    .filter(p => p.merged_at && String(p.number) !== String(PR_NUMBER))
    .slice(0, 5)

  for (const pr of recentMerged) {
    const reviews = await ghFetch(`/pulls/${pr.number}/reviews`) || []
    for (const r of reviews) {
      if (!r.body?.includes('Claude Code Review') && !r.body?.includes('Claude Sonnet')) continue
      const issues = extractIssues(r.body)
      if (issues) knownIssues.push({ pr: `#${pr.number} "${pr.title}"`, issues })
    }
  }
} catch { /* non-fatal */ }

let previousContext = ''
if (knownIssues.length > 0) {
  const lines = knownIssues.map(e => `**PR ${e.pr}:**\n${e.issues}`).join('\n\n')
  previousContext = `
**Issues raised in previous Claude reviews — do NOT repeat any of these; if this diff fixes one, note it as resolved:**

${lines}

---
`
}

// ── 3. Call Claude ────────────────────────────────────────────────────────────

const PROMPT = `You are a senior software engineer doing a thorough, production-quality code review for **lazyhub** — a lazygit-style GitHub TUI (Node.js 22, Ink 4, React 18, execa, gh CLI).

**Architecture rules to enforce:**
- All \`gh\` CLI calls must go through \`src/executor.js\` only — flag any gh calls elsewhere
- All color/hex values must go in \`src/theme.js\` — never inline
- Hooks → \`src/hooks/\`, components → \`src/components/\`, features → \`src/features/\`

**Known-safe patterns — do NOT flag these:**
- \`execa('gh', args)\` or \`execa(bin, argsArray)\` — array args are never shell-expanded
- \`spawnSync(bin, argsArray)\` — same: array call, no shell involved
- \`gh api --raw-field key=value\` or \`-F key=value\` — gh CLI handles these as typed arguments
- \`useEffect\` cleanup \`return () => fn()\` re-running on dependency changes — correct React behavior
- \`JSON.parse\` on \`gh\` CLI output — trusted local process
- Hard-coded pagination limits (e.g. \`first: 100\`)

**Strict criteria for bugs:**
- Only confirmed bugs with a clear reproduction path
- Do NOT include speculative edge cases, style preferences, or design limitations
- Do NOT repeat issues from previous reviews below
${previousContext}
---

**PR DIFF:**
${diffContent}

---

**Instructions:**
Analyse the diff carefully. Be thorough — check for logic errors, missing error handling at real boundaries, incorrect state management, React hook violations, and security issues.

Return your response in EXACTLY this structure (do not deviate):

---START_REVIEW---
### Summary
2–3 sentences on what this PR does and its overall quality.

### Issues
List each confirmed bug as:
**[CRITICAL/MAJOR/MINOR] \`file.js:line\`** — clear description of the bug and why it breaks.
> **Fix:** Specific code change or approach to fix it.

If none, write "None found."

### Suggestions
Non-trivial improvements only (architecture, correctness, performance, notable UX). For each:
**\`file.js:line\`** — what to improve and why.
> **Suggestion:** Specific change.

If none, write "None."

### Verdict
One of:
- ✅ **APPROVE** — ready to merge
- ⚠️ **COMMENT** — no blockers but worth discussing
- ❌ **REQUEST CHANGES** — confirmed bugs must be fixed before merging
---END_REVIEW---

---START_INLINE_COMMENTS---
Provide a JSON array of inline review comments for the most important issues and suggestions.
Each entry targets a specific line in the diff. Only include lines that are present in the diff (added or context lines).
For fixes, use GitHub suggestion blocks so the author can apply them with one click.

Format (valid JSON array, or [] if no inline comments):
[
  {
    "path": "src/example.js",
    "line": 42,
    "side": "RIGHT",
    "body": "Brief issue description.\\n\\n\`\`\`suggestion\\nfixed line of code here\\n\`\`\`"
  }
]

Rules:
- \`path\`: exact file path as shown in the diff (no leading slash)
- \`line\`: the line number in the NEW version of the file
- \`side\`: always "RIGHT" (new version)
- \`body\`: clear explanation + suggestion block with the corrected code
- Only comment on lines that actually exist in this diff
- Maximum 8 inline comments — prioritise the most impactful ones
---END_INLINE_COMMENTS---`

const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'x-api-key': ANTHROPIC_API_KEY,
    'anthropic-version': '2023-06-01',
  },
  body: JSON.stringify({
    model: 'claude-sonnet-4-6',
    max_tokens: 8192,
    messages: [{ role: 'user', content: PROMPT }],
  }),
})

if (!claudeRes.ok) {
  const err = await claudeRes.text()
  console.error(`Claude API error: ${claudeRes.status} — ${err}`)
  process.exit(1)
}

const claudeData = await claudeRes.json()
const rawResponse = claudeData.content?.[0]?.text

if (!rawResponse) {
  console.error('No review text returned from Claude.')
  process.exit(1)
}

// ── 4. Parse Claude's structured response ─────────────────────────────────────

const reviewMatch = rawResponse.match(/---START_REVIEW---([\s\S]*?)---END_REVIEW---/)
const commentsMatch = rawResponse.match(/---START_INLINE_COMMENTS---([\s\S]*?)---END_INLINE_COMMENTS---/)

const reviewText = reviewMatch ? reviewMatch[1].trim() : rawResponse
let inlineComments = []

if (commentsMatch) {
  try {
    const jsonText = commentsMatch[1].trim()
    const parsed = JSON.parse(jsonText)
    if (Array.isArray(parsed)) {
      // Validate each comment: only keep those targeting lines actually in the diff
      inlineComments = parsed.filter(c => {
        if (!c.path || !c.line || !c.body) return false
        const fileLines = changedLines.get(c.path)
        if (!fileLines) {
          console.warn(`Skipping inline comment: "${c.path}" not found in diff`)
          return false
        }
        if (!fileLines.has(Number(c.line))) {
          console.warn(`Skipping inline comment: ${c.path}:${c.line} not in diff changed lines`)
          return false
        }
        return true
      }).slice(0, 8)
    }
  } catch (e) {
    console.warn(`Failed to parse inline comments JSON: ${e.message}`)
  }
}

console.log(`Parsed review: ${reviewText.length} chars, ${inlineComments.length} inline comments`)

// ── 5. Parse verdict ──────────────────────────────────────────────────────────

let event = 'COMMENT'
if (/✅.*APPROVE/i.test(reviewText))              event = 'APPROVE'
else if (/❌.*REQUEST CHANGES/i.test(reviewText)) event = 'REQUEST_CHANGES'

// ── 6. Post as a formal GitHub PR review with inline comments ─────────────────

const reviewBody = `## Claude Code Review\n\n${reviewText}\n\n---\n*Reviewed by Claude Sonnet 4.6 · [lazyhub](https://github.com/${REPO})*`

const reviewPayload = {
  event,
  body: reviewBody,
}

if (inlineComments.length > 0) {
  reviewPayload.comments = inlineComments.map(c => ({
    path: c.path,
    line: Number(c.line),
    side: c.side || 'RIGHT',
    body: c.body,
  }))
}

const reviewRes = await fetch(
  `https://api.github.com/repos/${REPO}/pulls/${PR_NUMBER}/reviews`,
  {
    method: 'POST',
    headers: GH_HEADERS,
    body: JSON.stringify(reviewPayload),
  }
)

if (!reviewRes.ok) {
  const err = await reviewRes.text()
  // If inline comments caused the failure, retry without them
  if (inlineComments.length > 0) {
    console.warn(`Review with inline comments failed (${reviewRes.status}), retrying without them...`)
    const fallbackRes = await fetch(
      `https://api.github.com/repos/${REPO}/pulls/${PR_NUMBER}/reviews`,
      {
        method: 'POST',
        headers: GH_HEADERS,
        body: JSON.stringify({ event, body: reviewBody }),
      }
    )
    if (!fallbackRes.ok) {
      const fallbackErr = await fallbackRes.text()
      console.error(`Failed to post review: ${fallbackRes.status} — ${fallbackErr}`)
      process.exit(1)
    }
    console.log(`✓ Claude review posted without inline comments (verdict: ${event})`)
    process.exit(0)
  }
  console.error(`Failed to post review: ${reviewRes.status} — ${err}`)
  process.exit(1)
}

console.log(`✓ Claude review posted (verdict: ${event}, inline comments: ${inlineComments.length}, prior issues fed: ${knownIssues.length})`)
