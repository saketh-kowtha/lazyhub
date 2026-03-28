/**
 * claude-review.mjs
 * Posts a Claude code review as a PR review.
 * Env vars required: ANTHROPIC_API_KEY, GITHUB_TOKEN, PR_NUMBER, REPO
 */

const { ANTHROPIC_API_KEY, GITHUB_TOKEN, PR_NUMBER, REPO } = process.env

// ── 1. Fetch the PR diff ──────────────────────────────────────────────────────

const diffRes = await fetch(
  `https://api.github.com/repos/${REPO}/pulls/${PR_NUMBER}`,
  {
    headers: {
      Authorization: `Bearer ${GITHUB_TOKEN}`,
      Accept: 'application/vnd.github.v3.diff',
      'User-Agent': 'ghui-claude-review',
    },
  }
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

// Truncate very large diffs — Claude has a context limit
const MAX_DIFF_CHARS = 80_000
const truncated = diff.length > MAX_DIFF_CHARS
const diffContent = truncated
  ? diff.slice(0, MAX_DIFF_CHARS) + '\n\n[...diff truncated at 80 000 chars...]'
  : diff

// ── 2. Call Claude ────────────────────────────────────────────────────────────

const PROMPT = `You are a senior software engineer reviewing a pull request for **ghui** — a lazygit-style GitHub TUI (Node.js 20+, Ink 4, React 18, execa, gh CLI).

**Architecture rules to enforce:**
- All \`gh\` CLI calls must go through \`src/executor.js\` only — flag any gh calls elsewhere
- All color/hex values must go in \`src/theme.js\` — never inline
- Hooks → \`src/hooks/\`, components → \`src/components/\`, features → \`src/features/\`
- No GitHub Enterprise, no mouse support (by design — don't suggest adding them)

**Your review must include:**

### Summary
2–3 sentences on what this PR does.

### Issues
Concrete bugs, logic errors, broken edge cases. Always include \`file:line\` references. If none, write "None found."

### Suggestions
Important improvements only. Skip style nits. If none, write "None."

### Verdict
One of:
- ✅ **APPROVE** — ready to merge
- ⚠️ **COMMENT** — no blockers but worth discussing
- ❌ **REQUEST CHANGES** — must fix before merging

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
    max_tokens: 2048,
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

// ── 3. Parse verdict for GitHub review event ──────────────────────────────────

let event = 'COMMENT'
if (/✅.*APPROVE/i.test(reviewText))          event = 'APPROVE'
else if (/❌.*REQUEST CHANGES/i.test(reviewText)) event = 'REQUEST_CHANGES'

// ── 4. Post as a formal GitHub PR review ─────────────────────────────────────

const reviewRes = await fetch(
  `https://api.github.com/repos/${REPO}/pulls/${PR_NUMBER}/reviews`,
  {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${GITHUB_TOKEN}`,
      'Content-Type': 'application/json',
      'User-Agent': 'ghui-claude-review',
    },
    body: JSON.stringify({
      event,
      body: `## Claude Code Review\n\n${reviewText}\n\n---\n*Reviewed by Claude Sonnet 4.6 · [ghui](https://github.com/${REPO})*`,
    }),
  }
)

if (!reviewRes.ok) {
  const err = await reviewRes.text()
  console.error(`Failed to post review: ${reviewRes.status} — ${err}`)
  process.exit(1)
}

console.log(`✓ Claude review posted (verdict: ${event})`)
