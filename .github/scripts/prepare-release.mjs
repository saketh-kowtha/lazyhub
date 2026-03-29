#!/usr/bin/env node
/**
 * .github/scripts/prepare-release.mjs
 */

import { readFileSync, writeFileSync, existsSync, appendFileSync } from 'fs'
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
  const outputFile = process.env.GITHUB_OUTPUT
  if (outputFile) {
    appendFileSync(outputFile, `${name}=${value}\n`)
    console.log(`Setting output: ${name}=${value}`)
  } else {
    console.log(`\nOutput: ${name}=${value}`)
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
  // Explicit override from workflow_dispatch input
  if (process.env.BUMP_TYPE) return process.env.BUMP_TYPE

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

// ─── Build conventional changelog ─────────────────────────────

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

// ─── AI-enhanced notes ────────────────────────────────────

async function buildAiNotes() {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return null

  console.log('Generating release notes with Claude...')
  const commitSummary = commits.slice(0, 30).map(c => `- ${c.subject} (${c.hash})`).join('\n')
  const repoUrl = `https://github.com/${repo}`

  const prompt = `You are writing release notes for lazyhub v${newVersion} — a lazygit-style GitHub TUI.
PR merged: #${prNumber} — "${prTitle}"
Bump type: ${bump}
Commits:
${commitSummary}
Write release notes in GitHub Markdown. Highlight the most important user-facing changes.`

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
    if (!res.ok) return null
    const data = await res.json()
    const body = data.content?.[0]?.text || ''
    return `## v${newVersion}\n\n${body}`
  } catch {
    return null
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

const aiNotes = await buildAiNotes()
const releaseNotes = aiNotes || buildConventionalNotes()

// Write notes to temp file
writeFileSync('/tmp/release-notes.md', releaseNotes)

// Update package.json
pkg.version = newVersion
writeFileSync(join(ROOT, 'package.json'), JSON.stringify(pkg, null, 2) + '\n')

// Update CHANGELOG.md
const changelogPath = join(ROOT, 'CHANGELOG.md')
const existingChangelog = existsSync(changelogPath) ? readFileSync(changelogPath, 'utf8') : '# Changelog\n\n'
const header = '# Changelog\n\n'
const rest = existingChangelog.replace(/^# Changelog\s*\n+/, '')
writeFileSync(changelogPath, `${header}${releaseNotes}\n\n---\n\n${rest}`)

// Update README version badge
const readmePath = join(ROOT, 'README.md')
if (existsSync(readmePath)) {
  let readme = readFileSync(readmePath, 'utf8')
  readme = readme.replace(/img\.shields\.io\/npm\/v\/lazyhub[^)]+/g, `img.shields.io/npm/v/lazyhub?color=3fb950&label=npm`)
  readme = readme.replace(/lazyhub@\d+\.\d+\.\d+/g, `lazyhub@${newVersion}`)
  writeFileSync(readmePath, readme)
}

// Set GITHUB_OUTPUT
setOutput('version', newVersion)

console.log(`\n✓ Release v${newVersion} prepared (${bump} bump)`)
