/**
 * claude-security.mjs
 * Posts a Claude security audit as a PR comment.
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
      'User-Agent': 'ghui-claude-security',
    },
  }
)

if (!diffRes.ok) {
  console.error(`Failed to fetch PR diff: ${diffRes.status} ${diffRes.statusText}`)
  process.exit(1)
}

const diff = await diffRes.text()

if (!diff.trim()) {
  console.log('Empty diff — nothing to audit.')
  process.exit(0)
}

const MAX_DIFF_CHARS = 80_000
const truncated = diff.length > MAX_DIFF_CHARS
const diffContent = truncated
  ? diff.slice(0, MAX_DIFF_CHARS) + '\n\n[...diff truncated at 80 000 chars...]'
  : diff

// ── 2. Call Claude ────────────────────────────────────────────────────────────

const PROMPT = `You are a security engineer auditing a pull request for **ghui** — a CLI tool that wraps the GitHub CLI (\`gh\`).

**Threat model for this codebase:**
- **Command injection** — \`executor.js\` builds args arrays for \`execa('gh', args)\`. Any unsanitized user input or external data reaching those args is critical.
- **Token/credential leakage** — GITHUB_TOKEN, PATs, or auth tokens must never appear in logs, UI output, or error messages.
- **Prototype pollution** — JSON output from \`gh\` CLI is parsed with \`JSON.parse\`. Malicious API responses could pollute prototypes.
- **Path traversal** — any file operations using user-controlled paths.
- **ReDoS** — regex applied to potentially large or adversarial strings (PR titles, branch names, issue bodies).
- **Dependency vulnerabilities** — newly added \`npm\` packages with known CVEs.
- **Insecure defaults** — permissions granted wider than needed, auth checks missing.

**For each finding, output exactly:**
\`\`\`
[SEVERITY] file:line — Title
Description: what the issue is and how it could be exploited
Fix: concrete recommendation
\`\`\`

Severity levels: CRITICAL | HIGH | MEDIUM | LOW | INFO

**If no issues are found**, output exactly:
\`✅ No security issues found in this diff.\`

Be precise. No false positives. Do not flag things that are not actual security risks.

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
const auditText = claudeData.content?.[0]?.text

if (!auditText) {
  console.error('No audit text returned from Claude.')
  process.exit(1)
}

// ── 3. Determine if there are blockers ───────────────────────────────────────

const hasCritical = /\[CRITICAL\]/i.test(auditText)
const hasHigh     = /\[HIGH\]/i.test(auditText)
const isClean     = /no security issues found/i.test(auditText)

// ── 4. Post as PR comment ─────────────────────────────────────────────────────

const badge = isClean
  ? '🛡️ **Clean**'
  : hasCritical
    ? '🚨 **Critical issues found**'
    : hasHigh
      ? '⚠️ **High-severity issues found**'
      : 'ℹ️ **Low/medium findings**'

const commentBody = [
  `## Claude Security Audit ${badge}`,
  '',
  auditText,
  '',
  '---',
  `*Audited by Claude Sonnet 4.6 · [ghui](https://github.com/${REPO})*`,
].join('\n')

const commentRes = await fetch(
  `https://api.github.com/repos/${REPO}/issues/${PR_NUMBER}/comments`,
  {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${GITHUB_TOKEN}`,
      'Content-Type': 'application/json',
      'User-Agent': 'ghui-claude-security',
    },
    body: JSON.stringify({ body: commentBody }),
  }
)

if (!commentRes.ok) {
  const err = await commentRes.text()
  console.error(`Failed to post comment: ${commentRes.status} — ${err}`)
  process.exit(1)
}

console.log(`✓ Security audit posted (clean: ${isClean}, critical: ${hasCritical}, high: ${hasHigh})`)

// Exit non-zero if critical findings — this will fail the check
if (hasCritical) {
  console.error('Failing CI due to CRITICAL security findings.')
  process.exit(1)
}
