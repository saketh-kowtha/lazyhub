#!/usr/bin/env node
// Create or update the agent-ops labels (idempotent): node scripts/agent-ops/labels.mjs [--dry-run]
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { LABELS } from './lib.mjs'

const config = JSON.parse(readFileSync(new URL('./config.json', import.meta.url), 'utf8'))
const DEFS = {
  [LABELS.ready]: ['0e8a16', 'Maintainer-approved for an agent to pick up'],
  [LABELS.inProgress]: ['fbca04', 'An agent is working on this'],
  [LABELS.inReview]: ['1d76db', 'Agent PR waiting for the reviewer agent'],
  [LABELS.changesNeeded]: ['d93f0b', 'Reviewer asked the builder for changes'],
  [LABELS.readyToMerge]: ['5319e7', 'Reviewed and green; maintainer merges'],
  [LABELS.blocked]: ['b60205', 'Agent stopped; needs a maintainer'],
  [LABELS.proposal]: ['c5def5', 'Suggested work; maintainer decides'],
  [LABELS.triage]: ['ededed', 'Needs maintainer triage'],
}

for (const [name, [color, description]] of Object.entries(DEFS)) {
  const argv = ['label', 'create', name, '-R', config.repo, '--color', color, '--description', description, '--force']
  if (process.argv.includes('--dry-run')) console.log(`gh ${argv.join(' ')}`)
  else { execFileSync('gh', argv, { stdio: 'inherit' }); console.log(`ok ${name}`) }
}
