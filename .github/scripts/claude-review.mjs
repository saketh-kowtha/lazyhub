/**
 * claude-review.mjs
 * Posts a Claude code review as a PR review.
 * Env vars required: ANTHROPIC_API_KEY, GITHUB_TOKEN, PR_NUMBER, REPO
 */

const { ANTHROPIC_API_KEY, GITHUB_TOKEN, PR_NUMBER, REPO } = process.env

const GH_HEADERS = {
  Authorization: `Bearer ${GITHUB_TOKEN}`,
  'User-Agent': 'lazyhub-claude-review',
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function ghFetch(path) {
  const res = await fetch(`https://api.github.com/repos/${REPO}${path}`, { headers: GH_HEADERS })
  if (!res.ok) return null
  return res.json()
}

/** Extract the Issues section text from a Claude review body. */
function extractIssues(body) {
  const m = body.match(/###\s*Issues\s*\n([\s\S]*?)(?=\n###\s|\n---\s|\*Reviewed by|$)/i)
  if (!m) return null
  const text = m[1].trim()
  // Skip if it's just "None found."
  if (/^none found\.?$/i.test(text)) return null
  return text.slice(0, 600) // cap per-PR to keep total context small
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

// ── 2. Build previous-issues context (current PR + recent merged PRs) ─────────

const knownIssues = [] // { pr, title, issues }

try {
  // 2a. All Claude reviews on the current PR
  const currentReviews = await ghFetch(`/pulls/${PR_NUMBER}/reviews`) || []
  for (const r of currentReviews) {
    if (!r.body?.includes('Claude Code Review') && !r.body?.includes('Claude Sonnet')) continue
    const issues = extractIssues(r.body)
    if (issues) knownIssues.push({ pr: `#${PR_NUMBER} (this PR)`, issues })
  }

  // 2b. Last 5 merged PRs into main — cross-PR memory
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
} catch { /* non-fatal — context is best-effort */ }

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

const PROMPT = `You are a senior software engineer reviewing a pull request for **lazyhub** — a lazygit-style GitHub TUI (Node.js 20+, Ink 4, React 18, execa, gh CLI).

**Architecture rules to enforce:**
- All \`gh\` CLI calls must go through \`src/executor.js\` only — flag any gh calls elsewhere
- All color/hex values must go in \`src/theme.js\` — never inline
- Hooks → \`src/hooks/\`, components → \`src/components/\`, features → \`src/features/\`
- No GitHub Enterprise, no mouse support (by design — don't suggest adding them)

**Known-safe patterns — do NOT flag these:**
- \`execa('gh', args)\` or \`execa(bin, argsArray)\` — array args are never shell-expanded. Not injectable.
- \`spawnSync(bin, argsArray)\` — same: array call, no shell involved. Not injectable.
- \`gh api --raw-field key=value\` or \`-F key=value\` — gh CLI handles these as typed arguments, not shell strings.
- \`useEffect\` cleanup \`return () => fn()\` re-running on dependency changes — correct React behavior, not a bug.
- Single-thread selection when multiple threads share a line — known UX limitation, not a bug.
- \`JSON.parse\` on \`gh\` CLI output — \`gh\` is a trusted local process, not a remote attacker.
- Hard-coded pagination limits (e.g. \`first: 100\`) — acceptable limitations, not bugs.

**Strict criteria for the Issues section:**
- Only include **confirmed bugs** with a clear, concrete reproduction path.
- Do NOT include: speculative edge cases, theoretical race conditions, design limitations, style preferences, or "could hypothetically fail" scenarios.
- Do NOT include issues already fixed within this diff.
- Do NOT repeat any issue from the previous reviews listed below.
- If a previous issue is visibly fixed in this diff, note it as "✓ resolved".
${previousContext}
**Your review must include:**

### Summary
2–3 sentences on what this PR does.

### Issues
Confirmed bugs only. Always include \`file:line\` references. If none, write "None found."

### Suggestions
Non-trivial improvements only (architectural, correctness, or notable UX). Skip style nits. If none, write "None."

### Verdict
One of:
- ✅ **APPROVE** — ready to merge
- ⚠️ **COMMENT** — no blockers but worth discussing
- ❌ **REQUEST CHANGES** — must fix before merging (only if confirmed bugs exist)

Be concise. No praise. No filler. Focus on what matters.

---

${diffContent}`

const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'x-api-key': ANTHROPIC_API_KEY,
    'anthropic-version': '2023-06-01',
  },
  body: JSON.stringify({
    model: 'claude-sonnet-4-6',
    max_tokens: 4096,
    messages: [{ role: 'user', content: PROMPT }],
  }),
})

if (!claudeRes.ok) {
  const err = await claudeRes.text()
  console.error(`Claude API error: ${claudeRes.status} — ${err}`)
  process.exit(1)
}

const claudeData = await claudeRes.json()
const reviewText = claudeData.content?.[0]?.text

if (!reviewText) {
  console.error('No review text returned from Claude.')
  process.exit(1)
}

// ── 4. Parse verdict for GitHub review event ──────────────────────────────────

let event = 'COMMENT'
if (/✅.*APPROVE/i.test(reviewText))              event = 'APPROVE'
else if (/❌.*REQUEST CHANGES/i.test(reviewText)) event = 'REQUEST_CHANGES'

// ── 5. Post as a formal GitHub PR review ─────────────────────────────────────

const reviewRes = await fetch(
  `https://api.github.com/repos/${REPO}/pulls/${PR_NUMBER}/reviews`,
  {
    method: 'POST',
    headers: { ...GH_HEADERS, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      event,
      body: `## Claude Code Review\n\n${reviewText}\n\n---\n*Reviewed by Claude Sonnet 4.6 · [lazyhub](https://github.com/${REPO})*`,
    }),
  }
)

if (!reviewRes.ok) {
  const err = await reviewRes.text()
  console.error(`Failed to post review: ${reviewRes.status} — ${err}`)
  process.exit(1)
}

console.log(`✓ Claude review posted (verdict: ${event}, prior issues fed: ${knownIssues.length})`)
