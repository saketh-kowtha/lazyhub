/**
 * claude-security.mjs
 * Posts a Claude security audit as a PR comment.
 * Env vars required: ANTHROPIC_API_KEY, GITHUB_TOKEN, PR_NUMBER, REPO
 */

const { ANTHROPIC_API_KEY, GITHUB_TOKEN, PR_NUMBER, REPO } = process.env

const GH_HEADERS = {
  Authorization: `Bearer ${GITHUB_TOKEN}`,
  'User-Agent': 'lazyhub-claude-security',
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
  console.log('Empty diff — nothing to audit.')
  process.exit(0)
}

const MAX_DIFF_CHARS = 80_000
const truncated = diff.length > MAX_DIFF_CHARS
const diffContent = truncated
  ? diff.slice(0, MAX_DIFF_CHARS) + '\n\n[...diff truncated at 80 000 chars...]'
  : diff

// ── 2. Fetch previous Claude security comments (for deduplication) ────────────

let previousAuditContext = ''
try {
  const commentsRes = await fetch(
    `https://api.github.com/repos/${REPO}/issues/${PR_NUMBER}/comments`,
    { headers: GH_HEADERS }
  )
  if (commentsRes.ok) {
    const comments = await commentsRes.json()
    const priorAudits = comments
      .filter(c => c.body?.includes('Claude Security Audit'))
      .slice(-2)
    if (priorAudits.length > 0) {
      const summaries = priorAudits.map(c => c.body.slice(0, 1500)).join('\n\n---\n\n')
      previousAuditContext = `\n\n**Previous security audits on this PR (already raised — do NOT repeat):**\n\n${summaries}\n\n---\n\n`
    }
  }
} catch { /* non-fatal */ }

// ── 3. Call Claude ────────────────────────────────────────────────────────────

const PROMPT = `You are a security engineer auditing a pull request for **lazyhub** — a local CLI tool that wraps the GitHub CLI (\`gh\`).

**Deployment context:** lazyhub runs locally on a developer's machine as themselves. There is no web-facing server, no remote user input, and no multi-tenant surface. The \`gh\` CLI is a trusted local binary. The threat model is: malicious data from the GitHub API, malicious \`$EDITOR\` environment variable, or supply chain attacks.

**Architecture facts that eliminate entire vulnerability classes — do NOT flag these:**
- \`execa('gh', argsArray)\` — Node.js \`execa\` with an array does NOT spawn a shell. Arguments are passed directly to the process. There is NO shell injection possible through array-based execa calls, regardless of argument content.
- \`spawnSync(bin, argsArray)\` — same: no shell, no expansion. Array args to spawnSync are not injectable.
- \`gh api --raw-field key=value\` or \`gh api -F key=value\` — the \`gh\` CLI receives these as positional arguments, not shell strings. The value cannot escape into shell commands.
- \`JSON.parse\` on \`gh\` CLI output — \`gh\` is a trusted local binary signed by GitHub. Treating its JSON output as an adversarial source is out of scope for this threat model.
- \`Object spread { ...obj }\` where \`obj\` came from \`JSON.parse\` — V8 (Node 20+) does NOT prototype-pollute from \`__proto__\` JSON keys. They become inert own properties. Not a real vulnerability in Node 20+.
- Simple character-class regexes like \`[0-9;]*\` or \`[a-zA-Z]\` — these cannot cause catastrophic backtracking (ReDoS). Only flag ReDoS on patterns with nested quantifiers or overlapping alternation.
- Hardcoded pagination limits (e.g. \`first: 100\` in GraphQL) — these are data completeness issues, not security vulnerabilities.

**Real threat model for this codebase:**
- \`$EDITOR\` / \`$VISUAL\` env var used to spawn a process — could be set to a malicious binary. Check that it's validated.
- User-controlled strings interpolated into **GraphQL query strings** (not variables) — string interpolation inside a template literal query body (e.g. "query { field(arg: \\"" + userInput + "\\") }") is injectable.
- Path traversal in temp file creation — if the temp file path includes user-controlled content outside \`tmpdir()\`.
- Token/credential leakage in logs, UI, or error messages.
- Dependency vulnerabilities in newly added \`npm\` packages.

**Output format — for each real finding:**
\`\`\`
[SEVERITY] file:line — Title
Description: what the issue is and how it could be exploited
Fix: concrete recommendation
\`\`\`

Severity levels: CRITICAL | HIGH | MEDIUM | LOW | INFO

**If no real issues are found**, output exactly:
\`✅ No security issues found in this diff.\`

Be precise. No false positives. Every finding must be an actual exploitable vulnerability given the deployment context above.
${previousAuditContext}
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
    max_tokens: 3072,
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

// ── 4. Determine if there are blockers ───────────────────────────────────────

const hasCritical = /\[CRITICAL\]/i.test(auditText)
const hasHigh     = /\[HIGH\]/i.test(auditText)
const isClean     = /no security issues found/i.test(auditText)

// ── 5. Post as PR comment ─────────────────────────────────────────────────────

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
  `*Audited by Claude Sonnet 4.6 · [lazyhub](https://github.com/${REPO})*`,
].join('\n')

const commentRes = await fetch(
  `https://api.github.com/repos/${REPO}/issues/${PR_NUMBER}/comments`,
  {
    method: 'POST',
    headers: { ...GH_HEADERS, 'Content-Type': 'application/json' },
    body: JSON.stringify({ body: commentBody }),
  }
)

if (!commentRes.ok) {
  const err = await commentRes.text()
  console.error(`Failed to post comment: ${commentRes.status} — ${err}`)
  process.exit(1)
}

console.log(`✓ Security audit posted (clean: ${isClean}, critical: ${hasCritical}, high: ${hasHigh})`)

// Exit non-zero only for CRITICAL findings — HIGH findings are informational
if (hasCritical) {
  console.error('Failing CI due to CRITICAL security findings.')
  process.exit(1)
}
