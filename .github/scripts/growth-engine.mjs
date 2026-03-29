/**
 * growth-engine.mjs
 * Gemini-powered technical marketing and documentation generator.
 * Analyzes the entire codebase to create stunning, engaging guides and site content.
 * Env vars required: GEMINI_API_KEY, REPO
 */

import { GoogleGenerativeAI } from "@google/generative-ai"
import { readFileSync, writeFileSync, readdirSync, statSync } from 'fs'
import { join } from 'path'

const { GEMINI_API_KEY, REPO } = process.env
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY)
const model = genAI.getGenerativeModel({ model: "gemini-1.5-pro" })

// 1. Collect codebase context (Gemini's 2M context window handles this!)
function getFiles(dir, allFiles = []) {
  const files = readdirSync(dir)
  for (const file of files) {
    if (file === 'node_modules' || file === '.git' || file === 'dist') continue
    const name = join(dir, file)
    if (statSync(name).isDirectory()) getFiles(name, allFiles)
    else if (name.endsWith('.js') || name.endsWith('.jsx') || name.endsWith('.md')) allFiles.push(name)
  }
  return allFiles
}

const allFilePaths = getFiles('.')
let codebaseContext = ''
for (const path of allFilePaths) {
  const content = readFileSync(path, 'utf8')
  codebaseContext += `\n--- FILE: ${path} ---\n${content}\n`
}

// 2. The "Stunning Marketing" Prompt
const PROMPT = `You are a world-class Product Marketing Engineer and Technical Writer.
Your goal is to make the **lazyhub** repository look like a top-tier open-source project (like lazygit or turbo).

**CONTEXT:**
${codebaseContext.slice(0, 500000)} // Cap for safety, but Gemini can handle more

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

async function run() {
  const result = await model.generateContent(PROMPT)
  const response = await result.response
  const text = response.text()

  const readme = text.split('FILE: README.md')[1]?.split('FILE: docs/index.html')[0]?.trim()
  const index = text.split('FILE: docs/index.html')[1]?.trim()

  if (readme) {
    writeFileSync('README.md', readme)
    console.log('✓ Stunning README.md generated.')
  }
  if (index) {
    writeFileSync('docs/index.html', index)
    console.log('✓ Stunning docs/index.html generated.')
  }
}

run().catch(console.error)
