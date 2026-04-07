/**
 * auto-docs.mjs
 * Automatically updates ARCHITECTURE.md based on PR diff and description.
 * USES: Gemini 3 Flash (March 2026 Frontier)
 * Env vars required: GEMINI_API_KEY, GITHUB_TOKEN, PR_NUMBER, REPO, PR_TITLE, PR_BODY
 */

import { GoogleGenerativeAI } from "@google/generative-ai"
import { readFileSync, writeFileSync } from 'fs'

const { GEMINI_API_KEY, GITHUB_TOKEN, PR_NUMBER, REPO, PR_TITLE, PR_BODY } = process.env

/**
 * Main execution logic.
 */
async function run() {
  // 1. Validation
  if (!GEMINI_API_KEY || !GITHUB_TOKEN || !PR_NUMBER || !REPO) {
    console.error('Error: Missing required environment variables.')
    process.exit(1)
  }

  const genAI = new GoogleGenerativeAI(GEMINI_API_KEY)
  const model = genAI.getGenerativeModel({ model: "gemini-3-flash-preview" })

  const GH_HEADERS = {
    Authorization: `Bearer ${GITHUB_TOKEN}`,
    'Accept': 'application/vnd.github.v3.diff',
    'User-Agent': 'lazyhub-auto-docs',
  }

  // 2. Fetch PR Diff
  console.log(`Fetching diff for PR #${PR_NUMBER}...`)
  const diffRes = await fetch(`https://api.github.com/repos/${REPO}/pulls/${PR_NUMBER}`, { headers: GH_HEADERS })
  if (!diffRes.ok) {
    const err = await diffRes.text()
    throw new Error(`Failed to fetch PR diff: ${diffRes.status} - ${err}`)
  }
  const diff = await diffRes.text()

  // 3. Read ARCHITECTURE.md
  const archPath = 'ARCHITECTURE.md'
  const currentArch = readFileSync(archPath, 'utf8')

  // 4. Prompt AI to generate updates
  const PROMPT = `You are a technical writer for **lazyhub**.
Update the **ARCHITECTURE.md** based on this Pull Request.

**PR Title:** ${PR_TITLE || '(untitled)'}
**PR Description:** ${PR_BODY || '(no description)'}

**Current ARCHITECTURE.md (End portion):**
${currentArch.slice(-3000)}

**PR Diff:**
${diff.slice(0, 10000)}

**Task:**
1. If this is a bug fix (starts with "fix:"), generate a new entry for "§21. Complete bug fix log".
2. If this introduces a new architectural rule, update "§6. Quality Control" or "§5. Development Invariants".
3. Return ONLY the markdown section to be inserted. If no update is needed, return "NO_UPDATE".

Return format:
SECTION: [Section Number]
CONTENT: [Markdown Content]
`

  console.log('Generating documentation update with Gemini 3 Flash...')
  const result = await model.generateContent(PROMPT)
  const update = result.response.text()

  if (update.includes('NO_UPDATE')) {
    console.log('No architectural updates needed.')
    return
  }

  // 5. Apply update
  if (update.includes('SECTION: 21')) {
    const parts = update.split('CONTENT:')
    if (parts.length < 2) throw new Error('AI response format was invalid (missing CONTENT).')

    const newBug = parts[1].trim()
    writeFileSync(archPath, currentArch.trimEnd() + '\n\n' + newBug + '\n')
    console.log('✓ ARCHITECTURE.md bug log updated.')
  }
}

run().catch(err => {
  console.error('Auto-Docs Fatal Error:', err)
  process.exit(1)
})
