/**
 * auto-docs.mjs
 * Automatically updates ARCHITECTURE.md based on PR diff and description.
 * Env vars required: ANTHROPIC_API_KEY, GITHUB_TOKEN, PR_NUMBER, REPO, PR_TITLE, PR_BODY
 */

const { ANTHROPIC_API_KEY, GITHUB_TOKEN, PR_NUMBER, REPO, PR_TITLE, PR_BODY } = process.env
import { readFileSync, writeFileSync } from 'fs'

const GH_HEADERS = {
  Authorization: `Bearer ${GITHUB_TOKEN}`,
  'Accept': 'application/vnd.github.v3.diff',
}

// 1. Fetch PR Diff
const diffRes = await fetch(`https://api.github.com/repos/${REPO}/pulls/${PR_NUMBER}`, { headers: GH_HEADERS })
if (!diffRes.ok) process.exit(1)
const diff = await diffRes.text()

// 2. Read ARCHITECTURE.md
const archPath = 'ARCHITECTURE.md'
const currentArch = readFileSync(archPath, 'utf8')

// 3. Prompt AI to generate updates
const PROMPT = `You are a technical writer for **lazyhub**.
Update the **ARCHITECTURE.md** based on this Pull Request.

**PR Title:** ${PR_TITLE}
**PR Description:** ${PR_BODY}

**Current ARCHITECTURE.md Content (Last 100 lines):**
${currentArch.slice(-2000)}

**PR Diff:**
${diff.slice(0, 5000)}

**Task:**
1. If this is a bug fix (starts with "fix:"), generate a new entry for "§20. Complete bug fix log". 
   - Format: "### B-XX — [Title]\n- **Symptom:** ...\n- **Root cause:** ...\n- **Fix:** ..."
2. If this introduces a new architectural rule or tool (e.g. knip, jsdoc), update "§22. Key invariants" or "§23. Quality Control".
3. Return ONLY the new or modified sections. Do not return the whole file. If no update is needed, return "NO_UPDATE".

Return format:
SECTION: [Section Number]
CONTENT: [New Content to Append or Replace]
`

const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'x-api-key': ANTHROPIC_API_KEY,
    'anthropic-version': '2023-06-01',
  },
  body: JSON.stringify({
    model: 'claude-sonnet-4-6',
    max_tokens: 1024,
    messages: [{ role: 'user', content: PROMPT }],
  }),
})

if (!claudeRes.ok) process.exit(1)
const data = await claudeRes.json()
const update = data.content[0].text

if (update.includes('NO_UPDATE')) {
  console.log('No architectural updates needed.')
  process.exit(0)
}

// 4. Apply update (Simple append for bug fixes)
if (update.includes('SECTION: 20')) {
  const newBug = update.split('CONTENT:')[1].trim()
  const updatedArch = currentArch.replace('---', `---\n\n${newBug}\n\n---`) // This is a placeholder logic
  // In a real script, we'd use regex to find the right section
  // For now, let's just append to the end before the final section
  const lines = currentArch.split('\n')
  const lastSectionIndex = lines.findLastIndex(l => l.startsWith('## 23.'))
  if (lastSectionIndex !== -1) {
    lines.splice(lastSectionIndex - 1, 0, newBug + '\n')
    writeFileSync(archPath, lines.join('\n'))
    console.log('Updated ARCHITECTURE.md bug log.')
  }
}
