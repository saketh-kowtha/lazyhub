/**
 * growth-engine.mjs
 * Gemini-powered technical marketing and documentation generator.
 * Analyzes the entire codebase to create stunning, engaging guides and site content.
 * USES: Gemini 3 Flash (March 2026 Frontier)
 * Env vars required: GEMINI_API_KEY, REPO
 */

import { GoogleGenerativeAI } from "@google/generative-ai"
import { readFileSync, writeFileSync, readdirSync, statSync } from 'fs'
import { join } from 'path'

const { GEMINI_API_KEY, REPO } = process.env

/**
 * Recursively collects all relevant files from the repository.
 * @param {string} dir - Directory to search.
 * @param {string[]} allFiles - Accumulator for file paths.
 * @returns {string[]} List of file paths.
 */
function getFiles(dir, allFiles = []) {
  try {
    const files = readdirSync(dir)
    for (const file of files) {
      if (['node_modules', '.git', 'dist', '.claude'].includes(file)) continue
      const name = join(dir, file)
      if (statSync(name).isDirectory()) {
        getFiles(name, allFiles)
      } else if (name.endsWith('.js') || name.endsWith('.jsx') || name.endsWith('.md')) {
        allFiles.push(name)
      }
    }
  } catch (err) {
    console.error(`Warning: Failed to read directory ${dir}: ${err.message}`)
  }
  return allFiles
}

/**
 * Main execution loop for the Growth Engine.
 */
async function run() {
  if (!GEMINI_API_KEY) {
    console.error('Error: GEMINI_API_KEY is not set.')
    process.exit(1)
  }

  const genAI = new GoogleGenerativeAI(GEMINI_API_KEY)
  const model = genAI.getGenerativeModel({ model: "gemini-3-flash-preview" })

  // 1. Collect codebase context inside the async loop
  console.log('Collecting codebase context...')
  const allFilePaths = getFiles('.')
  let codebaseContext = ''
  
  for (const path of allFilePaths) {
    try {
      const content = readFileSync(path, 'utf8')
      codebaseContext += `\n--- FILE: ${path} ---\n${content}\n`
    } catch (err) {
      console.error(`Warning: Could not read file ${path}: ${err.message}`)
    }
  }

  // 2. The "Stunning Marketing" Prompt
  // codebaseContext is sliced outside the template literal to avoid injection
  const truncatedContext = codebaseContext.slice(0, 800000) 
  
  const PROMPT = `You are a world-class Product Marketing Engineer and Technical Writer.
Your goal is to make the **lazyhub** repository look like a top-tier open-source project (like lazygit or turbo).

**CONTEXT:**
${truncatedContext}

**TASK:**
1. Generate a **STUNNING README.md** that sells the project. 
   - Use high-impact emojis, clear sections, and a "Why lazyhub?" section.
   - Include a **Mermaid.js** diagram showing the architecture (UI -> Hook -> Executor -> gh CLI).
   - Use shields.io badges for the tech stack.
   - Highlight "Power User" features.
2. Generate a **Landing Page (docs/index.html)** using modern Vanilla CSS. 
   - It must look "dark mode," sleek, and professional.
   - Use a "hero" section with a call to action.
   - Feature a "Keybindings" grid.

Return ONLY the content of the two files in this format:
FILE: README.md
[Content]
FILE: docs/index.html
[Content]
`

  console.log('Generating stunning docs with Gemini 3 Flash...')
  const result = await model.generateContent(PROMPT)
  const response = await result.response
  const text = response.text()

  // 3. Parse and save
  const readmeMatch = text.split('FILE: README.md')[1]?.split('FILE: docs/index.html')[0]
  const indexMatch = text.split('FILE: docs/index.html')[1]

  if (readmeMatch) {
    writeFileSync('README.md', readmeMatch.trim())
    console.log('✓ Stunning README.md generated.')
  } else {
    console.error('Failed to parse README.md from AI response.')
  }

  if (indexMatch) {
    writeFileSync('docs/index.html', indexMatch.trim())
    console.log('✓ Stunning docs/index.html generated.')
  } else {
    console.error('Failed to parse docs/index.html from AI response.')
  }
}

run().catch(err => {
  console.error('Growth Engine Fatal Error:', err)
  process.exit(1)
})
