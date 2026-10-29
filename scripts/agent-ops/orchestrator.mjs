#!/usr/bin/env node
// Agent-ops orchestrator: moves lazyhub work through GitHub labels and starts the agent CLI for
// each step. It is deliberately not an AI; every decision is in ./lib.mjs. See docs/AGENT_OPS.md.
//
//   node scripts/agent-ops/orchestrator.mjs --dry-run      # show what the next tick would do
//   node scripts/agent-ops/orchestrator.mjs                # run one tick (launchd calls this)
//   node scripts/agent-ops/orchestrator.mjs --job digest   # run one scheduled/manual job now
//
// Agents never merge, tag or publish. GitHub enforces that through the bot account's permissions
// and branch protection; the deny list below is a second layer for Claude Code only.
import { execFile, spawn } from 'node:child_process'
import { appendFileSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { BRANCH_PREFIX, LABELS, isoDate, isoWeek, labelledByMaintainer, planTick, reviewRounds, taskLine, buildCommand, countsFor } from './lib.mjs'

const run = promisify(execFile)
const HERE = dirname(fileURLToPath(import.meta.url))
const REPO_PATH = resolve(HERE, '..', '..')

const CLAUDE_DENY = [
  'Bash(gh pr merge:*)', 'Bash(gh release:*)', 'Bash(gh repo edit:*)', 'Bash(gh secret:*)',
  'Bash(gh api -X DELETE:*)', 'Bash(gh auth:*)', 'Bash(git tag:*)', 'Bash(git push --force:*)',
  'Bash(git push -f:*)', 'Bash(git push origin main:*)', 'Bash(npm publish:*)', 'Bash(npm version:*)',
]

const MANUAL_JOBS = { 'release-prep': { name: 'release-prep', role: 'ops', prompt: 'release-prep.md' } }

const args = process.argv.slice(2)
const flag = name => args.includes(name)
const opt = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined }

const config = JSON.parse(readFileSync(opt('--config') || join(HERE, 'config.json'), 'utf8'))
const workRoot = config.workRoot.replace(/^~(?=\/)/, homedir())
const dryRun = flag('--dry-run')

const ghEnv = { ...process.env, ...(process.env.AGENT_OPS_GH_TOKEN ? { GH_TOKEN: process.env.AGENT_OPS_GH_TOKEN } : {}) }
const gh = async (...a) => (await run('gh', a, { env: ghEnv, maxBuffer: 16 * 1024 * 1024 })).stdout
const ghJson = async (...a) => JSON.parse(await gh(...a) || 'null')
const git = (...a) => run('git', ['-C', REPO_PATH, ...a])

function privateDir(path) {
  mkdirSync(path, { recursive: true, mode: 0o700 })
  return path
}

const statePath = () => join(workRoot, 'state.json')
const loadState = () => (existsSync(statePath()) ? JSON.parse(readFileSync(statePath(), 'utf8')) : {})
const saveState = state => writeFileSync(statePath(), JSON.stringify(state, null, 2), { mode: 0o600 })

function lock() {
  const path = join(workRoot, 'lock')
  if (existsSync(path)) {
    const pid = Number(readFileSync(path, 'utf8'))
    try { process.kill(pid, 0); return null } catch { /* stale lock from a dead run */ }
  }
  writeFileSync(path, String(process.pid), { mode: 0o600 })
  return () => rmSync(path, { force: true })
}

async function readBoard() {
  const [issues, prs] = await Promise.all([
    ghJson('issue', 'list', '-R', config.repo, '--state', 'open', '--label', LABELS.ready, '--json', 'number,labels', '--limit', '50'),
    ghJson('pr', 'list', '-R', config.repo, '--state', 'open', '--json', 'number,headRefName,labels', '--limit', '100'),
  ])
  const rounds = {}
  for (const pr of prs.filter(p => p.headRefName.startsWith(BRANCH_PREFIX))) {
    rounds[pr.number] = reviewRounds((await ghJson('pr', 'view', String(pr.number), '-R', config.repo, '--json', 'comments')).comments)
  }
  const trusted = new Set()
  for (const issue of issues) {
    const timeline = await ghJson('api', `repos/${config.repo}/issues/${issue.number}/timeline`, '--paginate', '--slurp')
    if (labelledByMaintainer(timeline.flat(), LABELS.ready, config.maintainers)) trusted.add(issue.number)
  }
  return { issues, prs, rounds, trusted }
}

const relabel = (kind, number, add, remove) => gh(kind, 'edit', String(number), '-R', config.repo,
  ...add.flatMap(l => ['--add-label', l]), ...remove.flatMap(l => ['--remove-label', l]))

const comment = (kind, number, body) => gh(kind, 'comment', String(number), '-R', config.repo, '--body', body)

async function prLabels(number) {
  return (await ghJson('pr', 'view', String(number), '-R', config.repo, '--json', 'labels')).labels.map(l => l.name)
}

async function agentPRFor(issue) {
  const prs = await ghJson('pr', 'list', '-R', config.repo, '--state', 'open', '--json', 'number,headRefName', '--limit', '100')
  return prs.find(p => p.headRefName.startsWith(`${BRANCH_PREFIX}${issue}-`))
}

function promptFor(job) {
  const file = job.kind === 'scheduled' ? job.prompt : `${job.role}.md`
  return `${readFileSync(join(HERE, 'prompts', 'common.md'), 'utf8')}\n\n${readFileSync(join(HERE, 'prompts', file), 'utf8')}\n\n${taskLine(job, config.repo)}\n`
}

/** Run one agent in a throwaway worktree of origin/main; resolves with its exit code. */
async function runAgent(job, logFile) {
  const role = config.roles[job.role]
  const tool = config.tools[role.tool]
  const wt = join(privateDir(join(workRoot, 'worktrees')), `${job.kind}-${job.number ?? job.name}-${Date.now()}`)
  const settings = join(workRoot, 'claude-settings.json')
  writeFileSync(settings, JSON.stringify({ permissions: { deny: CLAUDE_DENY } }), { mode: 0o600 })
  await git('fetch', '-q', 'origin')
  await git('worktree', 'add', '-q', '--detach', wt, 'origin/main')
  const argv = buildCommand(tool, { prompt: promptFor(job), cwd: wt, settings, model: role.model })
  const out = openSync(logFile, 'a', 0o600)
  try {
    return await new Promise((resolveCode) => {
      const child = spawn(argv[0], argv.slice(1), { cwd: wt, env: ghEnv, stdio: ['ignore', out, out] })
      const timer = setTimeout(() => child.kill('SIGTERM'), (config.timeoutMinutes[job.role] ?? 30) * 60_000)
      child.on('error', (err) => { appendFileSync(logFile, `\n[agent-ops] spawn failed: ${err.message}\n`); clearTimeout(timer); resolveCode(127) })
      child.on('close', (code) => { clearTimeout(timer); resolveCode(code ?? 1) })
    })
  } finally {
    await git('worktree', 'remove', '--force', wt).catch(() => {})
  }
}

/** Label transitions after each job. Anything unexpected parks the item as blocked for a human. */
async function settle(job, code, logName) {
  const note = `agent-ops: the ${job.role} stopped without finishing (exit ${code}). Local log: ${logName}. Parked for a maintainer.`
  if (job.kind === 'build') {
    const pr = await agentPRFor(job.number)
    if (pr) {
      await relabel('pr', pr.number, [LABELS.inReview], [])
      await relabel('issue', job.number, [LABELS.inReview], [LABELS.inProgress])
    } else {
      await relabel('issue', job.number, [LABELS.blocked], [LABELS.inProgress])
      await comment('issue', job.number, note)
    }
  } else if (job.kind === 'fix') {
    await relabel('pr', job.number, code === 0 ? [LABELS.inReview] : [LABELS.blocked], [LABELS.changesNeeded])
    if (code !== 0) await comment('pr', job.number, note)
  } else if (job.kind === 'review') {
    const labels = await prLabels(job.number)
    if (labels.includes(LABELS.readyToMerge) || labels.includes(LABELS.changesNeeded)) await relabel('pr', job.number, [], [LABELS.inReview])
    else { await relabel('pr', job.number, [LABELS.blocked], [LABELS.inReview]); await comment('pr', job.number, note) }
  }
}

async function execute(job, state, now) {
  if (job.kind === 'escalate') {
    await relabel('pr', job.number, [LABELS.blocked], [LABELS.inReview])
    await comment('pr', job.number, `agent-ops: ${config.maxReviewRounds} review rounds without agreement. Parked for a maintainer.`)
    return
  }
  if (job.kind === 'build') await relabel('issue', job.number, [LABELS.inProgress], [LABELS.ready])
  const logDir = privateDir(join(workRoot, 'logs', isoDate(now)))
  const logName = `${job.kind}-${job.number ?? job.name}-${now.getTime()}.log`
  const code = await runAgent(job, join(logDir, logName))
  await settle(job, code, logName)
  const counts = countsFor(state, isoDate(now))
  counts[job.role] = (counts[job.role] || 0) + 1
  state.counts = counts
  if (job.kind === 'scheduled') {
    const spec = config.scheduled.find(s => s.name === job.name)
    state.lastRun = { ...state.lastRun, [job.name]: spec?.every === 'week' ? isoWeek(now) : isoDate(now) }
  }
  saveState(state)
  console.log(`${job.kind} ${job.number ?? job.name}: exit ${code} (log ${logName})`)
}

async function main() {
  privateDir(workRoot)
  const unlock = dryRun ? () => {} : lock()
  if (!unlock) { console.log('agent-ops: another run is in progress'); return }
  try {
    const now = new Date()
    const state = loadState()
    let jobs
    const only = opt('--job')
    if (only) {
      const spec = MANUAL_JOBS[only] || config.scheduled.find(s => s.name === only)
      if (!spec) throw new Error(`unknown job: ${only}`)
      jobs = [{ kind: 'scheduled', name: spec.name, role: spec.role, prompt: spec.prompt }]
    } else {
      jobs = planTick(await readBoard(), config, state, now)
    }
    if (dryRun) {
      for (const job of jobs) {
        const tool = config.roles[job.role]?.tool
        console.log(`${job.kind.padEnd(9)} ${String(job.number ?? job.name).padEnd(12)} ${job.role}${tool ? ` via ${tool}` : ''}`)
      }
      if (!jobs.length) console.log('nothing to do')
      return
    }
    for (const job of jobs) await execute(job, state, now)
  } finally {
    unlock()
  }
}

main().catch((err) => { console.error(`agent-ops: ${err.message}`); process.exitCode = 1 })
