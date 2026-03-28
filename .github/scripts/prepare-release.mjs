#!/usr/bin/env node
/**
 * .github/scripts/prepare-release.mjs
 *
 * Determines semver bump, writes release notes, bumps package.json,
 * updates CHANGELOG.md and README.md badge, updates docs version.
 *
 * Works WITH or WITHOUT an ANTHROPIC_API_KEY:
 *   - With key  → Claude Sonnet 4.6 generates polished release notes
 *   - Without   → conventional-commits-style notes generated from git log
 *
 * Outputs to GITHUB_OUTPUT:
 *   version=<new semver>
 */

import { readFileSync, writeFileSync, existsSync } from 'fs'
import { execSync } from 'child_process'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..', '..')

// ─── Helpers ──────────────────────────────────────────────────────────────────

function run(cmd, opts = {}) {
  return execSync(cmd, { cwd: ROOT, encoding: 'utf8', ...opts }).trim()
}

function setOutput(name, value) {
  const ghOutput = process.env.GITHUB_OUTPUT
  if (ghOutput) {
    const { appendFileSync } = await import('fs').catch(() => ({ appendFileSync: () => {} }))
    // sync version
    execSync(`echo "${name}=${value}" >> $GITHUB_OUTPUT`, { shell: true })
  } else {
    console.log(`::set-output name=${name}::${value}`)
  }
}

// ─── Determine bump type ───────────────────────────────────────────────────────

const labelsRaw  = process.env.PR_LABELS  || '[]'
const prTitle    = process.env.PR_TITLE   || ''
const prBody     = process.env.PR_BODY    || ''
const prNumber   = process.env.PR_NUMBER  || ''
const repo       = process.env.REPO       || ''

let labels = []
try { labels = JSON.parse(labelsRaw) } catch {}

function determineBump() {
  // Label-based (highest priority)
  if (labels.some(l => /^(breaking|major|semver:major)$/i.test(l))) return 'major'
  if (labels.some(l => /^(feature|minor|semver:minor|enhancement)$/i.test(l))) return 'minor'
  if (labels.some(l => /^(fix|patch|semver:patch|bug)$/i.test(l))) return 'patch'

  // Title prefix (conventional commits)
  if (/^(feat|feature)(\(.+\))?!:/i.test(prTitle) || /BREAKING CHANGE/i.test(prBody)) return 'major'
  if (/^(feat|feature)(\(.+\))?:/i.test(prTitle)) return 'minor'
  if (/^(fix|perf|refactor|docs|chore|ci|test)(\(.+\))?:/i.test(prTitle)) return 'patch'

  // Default to patch
  return 'patch'
}

// ─── Bump version ─────────────────────────────────────────────────────────────

const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
const current = pkg.version || '0.1.0'
const [maj, min, pat] = current.split('.').map(Number)
const bump = determineBump()

let newVersion
if (bump === 'major') newVersion = `${maj + 1}.0.0`
else if (bump === 'minor') newVersion = `${maj}.${min + 1}.0`
else newVersion = `${maj}.${min}.${pat + 1}`

console.log(`Bump: ${current} → ${newVersion} (${bump})`)

// ─── Gather commits since last tag ────────────────────────────────────────────

let lastTag = ''
try { lastTag = run('git describe --tags --abbrev=0 2>/dev/null || echo ""') } catch {}

const logRange = lastTag ? `${lastTag}..HEAD` : 'HEAD'
const rawLog = run(`git log ${logRange} --pretty=format:"%s|||%h|||%an" --no-merges`)

const commits = rawLog
  .split('\n')
  .filter(Boolean)
  .map(line => {
    const [subject, hash, author] = line.split('|||')
    return { subject, hash, author }
  })

// ─── Group commits by type ────────────────────────────────────────────────────

const groups = {
  feat:     [],
  fix:      [],
  perf:     [],
  docs:     [],
  refactor: [],
  chore:    [],
  other:    [],
}

for (const c of commits) {
  const m = c.subject.match(/^(\w+)(\(.+\))?:\s*(.+)/)
  if (m) {
    const type = m[1].toLowerCase()
    const scope = m[2] ? m[2].replace(/[()]/g, '') : ''
    const desc = m[3]
    const entry = scope ? `**${scope}**: ${desc}` : desc
    const key = groups[type] ? type : 'other'
    groups[key].push({ entry, hash: c.hash })
  } else {
    groups.other.push({ entry: c.subject, hash: c.hash })
  }
}

// ─── Build conventional changelog (no AI needed) ─────────────────────────────

function buildConventionalNotes() {
  const repoUrl = `https://github.com/${repo}`
  const lines = [`## v${newVersion}\n`]

  const sections = [
    { key: 'feat',     heading: '### Features' },
    { key: 'fix',      heading: '### Bug Fixes' },
    { key: 'perf',     heading: '### Performance' },
    { key: 'refactor', heading: '### Refactoring' },
    { key: 'docs',     heading: '### Documentation' },
    { key: 'chore',    heading: '### Chores' },
    { key: 'other',    heading: '### Other Changes' },
  ]

  for (const { key, heading } of sections) {
    if (groups[key].length === 0) continue
    lines.push(heading)
    for (const { entry, hash } of groups[key]) {
      lines.push(`- ${entry} ([${hash}](${repoUrl}/commit/${hash}))`)
    }
    lines.push('')
  }

  if (prNumber) {
    lines.push(`_Merged via [PR #${prNumber}](${repoUrl}/pull/${prNumber})_`)
  }

  return lines.join('\n')
}

// ─── Build AI-enhanced notes (with Claude) ────────────────────────────────────

async function buildAiNotes() {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return null

  console.log('Generating release notes with Claude...')

  const commitSummary = commits.slice(0, 30).map(c => `- ${c.subject} (${c.hash})`).join('\n')
  const repoUrl = `https://github.com/${repo}`

  const prompt = `You are writing release notes for ghui v${newVersion} — a lazygit-style GitHub TUI.

PR merged: #${prNumber} — "${prTitle}"
Bump type: ${bump}
${prBody ? `\nPR description:\n${prBody}\n` : ''}
Commits in this release:
${commitSummary}

Write release notes in GitHub Markdown. Include:
1. A 1-2 sentence summary of what changed (exciting, user-focused tone)
2. Sections: "### What's new", "### Bug fixes" (if any), "### Under the hood" (optional, for chores/refactors)
3. Each item as a bullet: "- **scope**: description"
4. At the end: "Full changelog: ${repoUrl}/compare/${lastTag || 'v0.1.0'}...v${newVersion}"

Keep it concise and developer-friendly. No marketing fluff. Start directly with the summary paragraph, no h1/h2 header (that's added separately).`

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 1024,
        messages: [{ role: 'user', content: prompt }],
      }),
    })

    if (!res.ok) {
      console.warn(`Claude API returned ${res.status}, falling back to conventional notes`)
      return null
    }

    const data = await res.json()
    const body = data.content?.[0]?.text || ''
    return `## v${newVersion}\n\n${body}`
  } catch (err) {
    console.warn('Claude API error:', err.message, '— falling back to conventional notes')
    return null
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

const aiNotes = await buildAiNotes()
const releaseNotes = aiNotes || buildConventionalNotes()

console.log('\n--- Release Notes ---')
console.log(releaseNotes)
console.log('---------------------\n')

// Write notes to temp file for the workflow step
writeFileSync('/tmp/release-notes.md', releaseNotes)

// ─── Update package.json ──────────────────────────────────────────────────────

pkg.version = newVersion
writeFileSync(join(ROOT, 'package.json'), JSON.stringify(pkg, null, 2) + '\n')
console.log(`✓ package.json → ${newVersion}`)

// ─── Update CHANGELOG.md ──────────────────────────────────────────────────────

const changelogPath = join(ROOT, 'CHANGELOG.md')
const existingChangelog = existsSync(changelogPath)
  ? readFileSync(changelogPath, 'utf8')
  : '# Changelog\n\n'

const header = existingChangelog.startsWith('# Changelog')
  ? '# Changelog\n\n'
  : '# Changelog\n\n'
const rest = existingChangelog.replace(/^# Changelog\s*\n+/, '')

const newChangelog = `${header}${releaseNotes}\n\n---\n\n${rest}`
writeFileSync(changelogPath, newChangelog)
console.log('✓ CHANGELOG.md updated')

// ─── Update README.md version badge ──────────────────────────────────────────

const readmePath = join(ROOT, 'README.md')
if (existsSync(readmePath)) {
  let readme = readFileSync(readmePath, 'utf8')
  // Update npm version badge
  readme = readme.replace(
    /img\.shields\.io\/npm\/v\/ghui[^)]+/g,
    `img.shields.io/npm/v/ghui?color=3fb950&label=npm`
  )
  // Update any explicit version mention in the install section
  readme = readme.replace(
    /ghui@\d+\.\d+\.\d+/g,
    `ghui@${newVersion}`
  )
  writeFileSync(readmePath, readme)
  console.log('✓ README.md badge updated')
}

// ─── Update docs version references ──────────────────────────────────────────

const docsFiles = ['docs/index.html', 'docs/guide.html', 'docs/keybindings.html', 'docs/config.html']
for (const docFile of docsFiles) {
  const docPath = join(ROOT, docFile)
  if (!existsSync(docPath)) continue
  let content = readFileSync(docPath, 'utf8')
  // Replace version strings like "v0.1.0" or "ghui@0.1.0"
  content = content.replace(/ghui@\d+\.\d+\.\d+/g, `ghui@${newVersion}`)
  content = content.replace(/data-version="[\d.]+"/, `data-version="${newVersion}"`)
  writeFileSync(docPath, content)
  console.log(`✓ ${docFile} version updated`)
}

// ─── Set GitHub Actions output ────────────────────────────────────────────────

const outputFile = process.env.GITHUB_OUTPUT
if (outputFile) {
  const { appendFileSync } = await import('fs')
  appendFileSync(outputFile, `version=${newVersion}\n`)
} else {
  console.log(`\nOutput: version=${newVersion}`)
}

console.log(`\n✓ Release v${newVersion} prepared (${bump} bump)`)
