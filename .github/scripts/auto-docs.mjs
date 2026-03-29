/**
 * auto-docs.mjs
 * Automatically updates ARCHITECTURE.md based on PR diff and description.
 * USES: Gemini 1.5 Flash (Budget King for routine doc updates)
 * Env vars required: GEMINI_API_KEY, GITHUB_TOKEN, PR_NUMBER, REPO, PR_TITLE, PR_BODY
 */

import { GoogleGenerativeAI } from "@google/generative-ai"
import { readFileSync, writeFileSync } from 'fs'

const { GEMINI_API_KEY, GITHUB_TOKEN, PR_NUMBER, REPO, PR_TITLE, PR_BODY } = process.env
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY)
const model = genAI.getGenerativeModel({ model: "gemini-3-flash-preview" }) // March 2026 Efficiency King

const GH_HEADERS = {
  Authorization: `Bearer ${GITHUB_TOKEN}`,
  'Accept': 'application/vnd.github.v3.diff',
}

async function run() {
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

**Current ARCHITECTURE.md (End portion):**
${currentArch.slice(-3000)}

**PR Diff:**
${diff.slice(0, 8000)}

**Task:**
1. If this is a bug fix (starts with "fix:"), generate a new entry for "§20. Complete bug fix log". 
2. If this introduces a new architectural rule, update "§22. Key invariants" or "§23. Quality Control".
3. Return ONLY the markdown section to be inserted. If no update is needed, return "NO_UPDATE".

Return format:
SECTION: [Section Number]
CONTENT: [Markdown Content]
`

  const result = await model.generateContent(PROMPT)
  const update = result.response.text()

  if (update.includes('NO_UPDATE')) {
    console.log('No architectural updates needed.')
    process.exit(0)
  }

  // 4. Apply update
  if (update.includes('SECTION: 20')) {
    const newBug = update.split('CONTENT:')[1].trim()
    const lines = currentArch.split('\n')
    const lastSectionIndex = lines.findLastIndex(l => l.startsWith('## 23.'))
    if (lastSectionIndex !== -1) {
      lines.splice(lastSectionIndex - 1, 0, newBug + '\n')
      writeFileSync(archPath, lines.join('\n'))
      console.log('✓ ARCHITECTURE.md bug log updated with Gemini Flash.')
    }
  }
}

run().catch(console.error)
