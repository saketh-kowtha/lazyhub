// Pure decision logic for the agent-ops orchestrator (scripts/agent-ops/orchestrator.mjs).
// Everything here is side-effect free so it can be tested without gh, git or agent CLIs.
// See docs/AGENT_OPS.md for the label state machine this implements.

export const LABELS = {
  ready: 'agent:ready',
  inProgress: 'agent:in-progress',
  inReview: 'agent:in-review',
  changesNeeded: 'agent:changes-needed',
  readyToMerge: 'agent:ready-to-merge',
  blocked: 'agent:blocked',
  proposal: 'proposal',
  triage: 'triage',
}

/** Marker every reviewer comment carries, so review rounds can be counted. */
export const REVIEW_MARKER = '<!-- agent-ops:review -->'

/** Branch prefix agents must use; the orchestrator only touches PRs on these branches. */
export const BRANCH_PREFIX = 'agent/'

const hasLabel = (item, name) => (item.labels || []).some(l => (l.name ?? l) === name)

/**
 * True when the most recent `labeled` event for `label` was made by a maintainer.
 * Labels are the trust boundary: an item counts only if a maintainer applied the label.
 *
 * @param {Array<{event: string, label?: {name: string}, actor?: {login: string}}>} timeline
 * @param {string} label
 * @param {string[]} maintainers
 */
export function labelledByMaintainer(timeline, label, maintainers) {
  const events = (timeline || []).filter(e => e.event === 'labeled' && e.label?.name === label)
  const last = events[events.length - 1]
  return !!last && maintainers.includes(last.actor?.login)
}

/** Open issues a maintainer marked ready that no agent is already working on. */
export function buildable(issues) {
  return issues.filter(i => hasLabel(i, LABELS.ready) && !hasLabel(i, LABELS.inProgress) && !hasLabel(i, LABELS.blocked))
}

/** Open agent PRs waiting for the given state label. */
export function agentPRs(prs, label) {
  return prs.filter(p => p.headRefName?.startsWith(BRANCH_PREFIX) && hasLabel(p, label) && !hasLabel(p, LABELS.blocked))
}

/** Number of completed review rounds on a PR, from reviewer comments. */
export function reviewRounds(comments) {
  return (comments || []).filter(c => (c.body || '').includes(REVIEW_MARKER)).length
}

/** Per-day job counters; resets when the date changes. */
export function countsFor(state, today) {
  return state.counts?.date === today ? state.counts : { date: today }
}

/** Whether a scheduled job is due: daily jobs once per date, weekly jobs once per ISO week. */
export function isDue(job, state, now) {
  const last = state.lastRun?.[job.name]
  if (job.every === 'day') return last !== isoDate(now)
  if (job.every === 'week') return last !== isoWeek(now) && now.getDay() === (job.weekday ?? 1)
  return false
}

export const isoDate = d => d.toISOString().slice(0, 10)

export function isoWeek(d) {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()))
  const day = t.getUTCDay() || 7
  t.setUTCDate(t.getUTCDate() + 4 - day)
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1))
  const week = Math.ceil(((t - yearStart) / 86400000 + 1) / 7)
  return `${t.getUTCFullYear()}-W${String(week).padStart(2, '0')}`
}

/**
 * Pick this tick's jobs in priority order: finish work before starting more.
 * review (unblocks merges) > fix (answers review) > build (new work) > scheduled jobs.
 * Respects the per-tick limit and each role's daily cap.
 *
 * @param {{issues: any[], prs: any[], rounds: Record<number, number>, trusted: Set<number>}} board
 * @param {any} config
 * @param {any} state
 * @param {Date} now
 */
export function planTick(board, config, state, now) {
  const counts = { ...countsFor(state, isoDate(now)) }
  const jobs = []
  const add = (job) => {
    const role = job.role
    if (jobs.length >= config.maxJobsPerTick) return
    if ((counts[role] || 0) >= (config.dailyCap[role] ?? 0)) return
    counts[role] = (counts[role] || 0) + 1
    jobs.push(job)
  }
  for (const pr of agentPRs(board.prs, LABELS.inReview)) {
    if ((board.rounds[pr.number] || 0) >= config.maxReviewRounds) jobs.push({ kind: 'escalate', number: pr.number, role: 'none' })
    else add({ kind: 'review', number: pr.number, role: 'reviewer' })
  }
  for (const pr of agentPRs(board.prs, LABELS.changesNeeded)) add({ kind: 'fix', number: pr.number, role: 'builder' })
  for (const issue of buildable(board.issues)) {
    if (board.trusted.has(issue.number)) add({ kind: 'build', number: issue.number, role: 'builder' })
  }
  for (const job of config.scheduled) {
    if (isDue(job, state, now)) add({ kind: 'scheduled', name: job.name, role: job.role, prompt: job.prompt })
  }
  return jobs
}

/**
 * Build the argv for a role's tool. `{prompt}`, `{cwd}`, `{settings}` and `{model}` are
 * substituted; an argument that is exactly `{model}` is dropped with its flag when no model is set.
 *
 * @param {{cmd: string[]}} tool
 * @param {{prompt: string, cwd: string, settings?: string, model?: string}} vars
 * @returns {string[]}
 */
export function buildCommand(tool, vars) {
  const out = []
  for (const arg of tool.cmd) {
    if (arg === '{model}' && !vars.model) { out.pop(); continue }
    out.push(arg.replace(/\{(prompt|cwd|settings|model)\}/g, (_, k) => vars[k] ?? ''))
  }
  return out
}

/** The task line appended to a role prompt. Only numbers and names, never issue text. */
export function taskLine(job, repo) {
  if (job.kind === 'build') return `Task: implement issue #${job.number} in ${repo}.`
  if (job.kind === 'fix') return `Task: address the review on PR #${job.number} in ${repo}.`
  if (job.kind === 'review') return `Task: review PR #${job.number} in ${repo}.`
  return `Task: run the scheduled "${job.name}" job for ${repo}.`
}
