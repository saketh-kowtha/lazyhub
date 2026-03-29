/**
 * growth-engine.mjs
 * Gemini-powered content generator for README.md and docs/index.html.
 * Design is FIXED in this script — Gemini only generates structured content (JSON).
 * This ensures consistent UI across every run with only the text varying.
 *
 * USES: Gemini 3 Flash (March 2026 Frontier)
 * Env vars required: GEMINI_API_KEY, REPO
 */

import { GoogleGenerativeAI } from "@google/generative-ai"
import { readFileSync, writeFileSync, readdirSync, statSync } from 'fs'
import { join } from 'path'

const { GEMINI_API_KEY, REPO } = process.env

// ─── Codebase scanner ─────────────────────────────────────────────────────────

function getFiles(dir, allFiles = []) {
  try {
    for (const file of readdirSync(dir)) {
      if (['node_modules', '.git', 'dist', '.claude'].includes(file)) continue
      const name = join(dir, file)
      if (statSync(name).isDirectory()) {
        getFiles(name, allFiles)
      } else if (/\.(js|jsx|md)$/.test(name)) {
        allFiles.push(name)
      }
    }
  } catch (err) {
    console.error(`Warning: Failed to read ${dir}: ${err.message}`)
  }
  return allFiles
}

// ─── Fixed HTML template ───────────────────────────────────────────────────────
// Design is locked here — Gemini only provides the text content injected below.

function buildHtml(c) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${c.title} — ${c.tagline}</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    :root {
      --bg:       #0d1117;
      --surface:  #161b22;
      --border:   #30363d;
      --accent:   #58a6ff;
      --green:    #3fb950;
      --text:     #e6edf3;
      --muted:    #8b949e;
      --font:     'Segoe UI', system-ui, -apple-system, sans-serif;
      --mono:     'Cascadia Code', 'Fira Code', monospace;
    }
    body { background: var(--bg); color: var(--text); font-family: var(--font); line-height: 1.6; }
    a { color: var(--accent); text-decoration: none; }
    a:hover { text-decoration: underline; }

    /* Nav */
    nav { display: flex; align-items: center; justify-content: space-between;
          padding: 1rem 2rem; border-bottom: 1px solid var(--border);
          position: sticky; top: 0; background: var(--bg); z-index: 10; }
    .nav-logo { font-weight: 700; font-size: 1.1rem; color: var(--text); }
    .nav-links { display: flex; gap: 1.5rem; font-size: 0.9rem; color: var(--muted); }
    .nav-links a { color: var(--muted); }
    .nav-links a:hover { color: var(--text); text-decoration: none; }

    /* Hero */
    .hero { text-align: center; padding: 5rem 2rem 4rem; max-width: 800px; margin: 0 auto; }
    .hero-badge { display: inline-block; background: var(--surface); border: 1px solid var(--border);
                  border-radius: 20px; padding: 0.3rem 0.9rem; font-size: 0.8rem;
                  color: var(--muted); margin-bottom: 1.5rem; }
    .hero h1 { font-size: clamp(2.2rem, 5vw, 3.5rem); font-weight: 800; line-height: 1.15;
               margin-bottom: 1.2rem; letter-spacing: -0.02em; }
    .hero h1 span { color: var(--accent); }
    .hero p { font-size: 1.15rem; color: var(--muted); max-width: 600px;
              margin: 0 auto 2rem; }
    .cta-group { display: flex; gap: 1rem; justify-content: center; flex-wrap: wrap; }
    .btn { padding: 0.7rem 1.5rem; border-radius: 8px; font-size: 0.95rem;
           font-weight: 600; cursor: pointer; border: none; transition: opacity .15s; }
    .btn:hover { opacity: 0.85; text-decoration: none; }
    .btn-primary { background: var(--accent); color: #000; }
    .btn-secondary { background: var(--surface); color: var(--text);
                     border: 1px solid var(--border); }
    .install-block { margin: 2.5rem auto 0; max-width: 420px; background: var(--surface);
                     border: 1px solid var(--border); border-radius: 10px;
                     padding: 0.9rem 1.2rem; text-align: left; }
    .install-block code { font-family: var(--mono); font-size: 0.9rem; color: var(--green); }
    .install-label { font-size: 0.7rem; color: var(--muted); margin-bottom: 0.3rem; }

    /* Features */
    section { max-width: 1000px; margin: 0 auto; padding: 4rem 2rem; }
    section h2 { font-size: 1.8rem; font-weight: 700; margin-bottom: 0.5rem; }
    section .sub { color: var(--muted); margin-bottom: 2.5rem; }
    .features-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 1.2rem; }
    .feature-card { background: var(--surface); border: 1px solid var(--border);
                    border-radius: 10px; padding: 1.4rem; }
    .feature-icon { font-size: 1.5rem; margin-bottom: 0.7rem; }
    .feature-card h3 { font-size: 1rem; font-weight: 600; margin-bottom: 0.4rem; }
    .feature-card p { font-size: 0.9rem; color: var(--muted); }

    /* Keybindings */
    .keys-section { background: var(--surface); border-top: 1px solid var(--border);
                    border-bottom: 1px solid var(--border); }
    .keys-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 0.7rem; }
    .key-row { display: flex; align-items: center; gap: 0.7rem; }
    kbd { background: var(--bg); border: 1px solid var(--border); border-radius: 5px;
          padding: 0.2rem 0.5rem; font-family: var(--mono); font-size: 0.8rem;
          color: var(--accent); white-space: nowrap; }
    .key-desc { font-size: 0.88rem; color: var(--muted); }

    /* Install */
    .install-section { text-align: center; }
    .install-steps { display: flex; flex-direction: column; gap: 0.8rem;
                     max-width: 480px; margin: 2rem auto 0; }
    .step { display: flex; align-items: center; gap: 1rem; background: var(--surface);
            border: 1px solid var(--border); border-radius: 8px; padding: 0.8rem 1.1rem; text-align: left; }
    .step-num { background: var(--accent); color: #000; border-radius: 50%;
                width: 24px; height: 24px; display: flex; align-items: center;
                justify-content: center; font-size: 0.75rem; font-weight: 700; flex-shrink: 0; }
    .step code { font-family: var(--mono); font-size: 0.85rem; color: var(--green); }
    .step span { font-size: 0.85rem; color: var(--muted); }

    /* Footer */
    footer { text-align: center; padding: 2.5rem; border-top: 1px solid var(--border);
             font-size: 0.85rem; color: var(--muted); }
    footer a { color: var(--muted); }

    @media (max-width: 600px) {
      .hero h1 { font-size: 2rem; }
      .nav-links { display: none; }
    }
  </style>
</head>
<body>

<nav>
  <span class="nav-logo">⚡ ${c.title}</span>
  <div class="nav-links">
    <a href="#features">Features</a>
    <a href="#keybindings">Keybindings</a>
    <a href="#install">Install</a>
    <a href="https://github.com/${REPO}" target="_blank">GitHub</a>
  </div>
</nav>

<div class="hero">
  <div class="hero-badge">Open Source · MIT License</div>
  <h1>${c.hero_headline.replace(/lazyhub/gi, '<span>lazyhub</span>')}</h1>
  <p>${c.hero_tagline}</p>
  <div class="cta-group">
    <a class="btn btn-primary" href="#install">Get Started</a>
    <a class="btn btn-secondary" href="https://github.com/${REPO}" target="_blank">View on GitHub</a>
  </div>
  <div class="install-block">
    <div class="install-label">QUICK INSTALL</div>
    <code>${c.install_command}</code>
  </div>
</div>

<section id="features">
  <h2>${c.features_heading}</h2>
  <p class="sub">${c.features_sub}</p>
  <div class="features-grid">
    ${c.features.map(f => `
    <div class="feature-card">
      <div class="feature-icon">${f.icon}</div>
      <h3>${f.title}</h3>
      <p>${f.description}</p>
    </div>`).join('')}
  </div>
</section>

<section id="keybindings" class="keys-section">
  <h2>${c.keybindings_heading}</h2>
  <p class="sub">${c.keybindings_sub}</p>
  <div class="keys-grid">
    ${c.keybindings.map(k => `
    <div class="key-row">
      <kbd>${k.key}</kbd>
      <span class="key-desc">${k.action}</span>
    </div>`).join('')}
  </div>
</section>

<section id="install" class="install-section">
  <h2>${c.install_heading}</h2>
  <p class="sub">${c.install_sub}</p>
  <div class="install-steps">
    ${c.install_steps.map((s, i) => `
    <div class="step">
      <div class="step-num">${i + 1}</div>
      ${s.code ? `<code>${s.code}</code>` : `<span>${s.text}</span>`}
    </div>`).join('')}
  </div>
</section>

<footer>
  Built with ❤️ — <a href="https://github.com/${REPO}" target="_blank">github.com/${REPO}</a>
</footer>

</body>
</html>`
}

// ─── Fixed README template ─────────────────────────────────────────────────────

function buildReadme(c) {
  const repoUrl = `https://github.com/${REPO}`
  return `# ⚡ lazyhub

> ${c.tagline}

[![npm version](https://img.shields.io/npm/v/lazyhub?color=3fb950&label=npm)](https://www.npmjs.com/package/lazyhub)
[![license](https://img.shields.io/github/license/saketh-kowtha/lazyhub?color=58a6ff)](${repoUrl}/blob/main/LICENSE)
[![stars](https://img.shields.io/github/stars/saketh-kowtha/lazyhub?color=f0c040)](${repoUrl}/stargazers)

${c.why_section}

## ✨ Features

${c.features.map(f => `- **${f.title}** — ${f.description}`).join('\n')}

## 🚀 Installation

\`\`\`bash
npm install -g lazyhub
\`\`\`

Or via Homebrew:

\`\`\`bash
brew install saketh-kowtha/tap/lazyhub
\`\`\`

## 🎯 Usage

\`\`\`bash
lazyhub
\`\`\`

## ⌨️ Keybindings

| Key | Action |
|-----|--------|
${c.keybindings.map(k => `| \`${k.key}\` | ${k.action} |`).join('\n')}

## 🏗️ Architecture

\`\`\`mermaid
graph LR
  UI[React/Ink UI] --> Hook[useGh Hook]
  Hook --> Executor[executor.js]
  Executor --> GH[gh CLI]
  GH --> API[GitHub API]
\`\`\`

## 📄 License

MIT © [saketh-kowtha](https://github.com/saketh-kowtha)
`
}

// ─── Main ──────────────────────────────────────────────────────────────────────

async function run() {
  if (!GEMINI_API_KEY) {
    console.error('Error: GEMINI_API_KEY is not set.')
    process.exit(1)
  }

  const genAI = new GoogleGenerativeAI(GEMINI_API_KEY)
  const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" })

  // Collect codebase context
  console.log('Collecting codebase context...')
  let codebaseContext = ''
  for (const path of getFiles('.')) {
    try {
      codebaseContext += `\n--- ${path} ---\n${readFileSync(path, 'utf8')}\n`
    } catch {}
  }

  // Ask Gemini ONLY for structured content — no design decisions
  const PROMPT = `You are a technical writer for **lazyhub** — a lazygit-style GitHub TUI built with React/Ink.

Analyze this codebase and return ONLY a JSON object (no markdown, no explanation) with this exact schema:

{
  "title": "lazyhub",
  "tagline": "one-line tagline",
  "hero_headline": "punchy 6-10 word headline for the landing page hero",
  "hero_tagline": "1-2 sentence expanded description for hero",
  "install_command": "npm install -g lazyhub",
  "features_heading": "short heading for features section",
  "features_sub": "one line subtitle for features section",
  "features": [
    { "icon": "emoji", "title": "feature name", "description": "1 sentence description" }
  ],
  "keybindings_heading": "short heading for keybindings section",
  "keybindings_sub": "one line subtitle",
  "keybindings": [
    { "key": "key or combo", "action": "what it does" }
  ],
  "install_heading": "short heading for install section",
  "install_sub": "one line subtitle",
  "install_steps": [
    { "code": "npm install -g lazyhub" },
    { "code": "lazyhub" },
    { "text": "Navigate with arrow keys and j/k" }
  ],
  "why_section": "2-3 paragraph markdown explaining why lazyhub exists and who it's for",
  "readme_features_heading": "Features"
}

Include 6-8 features and 10-14 keybindings based on what you find in the source code.
Base keybindings on actual key handlers found in the code.

CODEBASE:
${codebaseContext.slice(0, 600000)}`

  console.log('Generating content with Gemini...')
  const result = await model.generateContent(PROMPT)
  const text = result.response.text().trim()

  // Parse JSON — strip markdown fences if present
  let content
  try {
    const jsonStr = text.replace(/^```json\s*/i, '').replace(/```\s*$/, '').trim()
    content = JSON.parse(jsonStr)
  } catch (err) {
    console.error('Failed to parse Gemini JSON response:', err.message)
    console.error('Raw response:', text.slice(0, 500))
    process.exit(1)
  }

  // Inject into fixed templates and write
  writeFileSync('README.md', buildReadme(content))
  console.log('✓ README.md updated.')

  writeFileSync('docs/index.html', buildHtml(content))
  console.log('✓ docs/index.html updated.')
}

run().catch(err => {
  console.error('Growth Engine Fatal Error:', err)
  process.exit(1)
})
