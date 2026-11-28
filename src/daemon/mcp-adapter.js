import * as readline from 'readline'
import { readFileSync } from 'node:fs'
import {
  getIssue,
  getPR,
  getPRChecks,
  getPRDiff,
  listBranches,
  listIssues,
  listNotifications,
  listPRs,
} from '../executor.js'
import { isRepoSlug, isPositiveId } from '../input-validation.js'
import { REVIEW_TOOLS, ReviewToolError, inputSchema as reviewInputSchema, reviewToolByName, runReviewTool } from '../review-tools/index.js'

const TOOL_ALIASES = {
  lazyhub_pr_list: 'list_prs',
  lazyhub_pr_view: 'get_pr',
  lazyhub_pr_diff: 'get_pr_diff',
  lazyhub_pr_approve: 'approve_pr',
  lazyhub_pr_merge: 'merge_pr',
  lazyhub_pr_comment: 'post_comment',
  lazyhub_pr_review_line: 'review_line',
  lazyhub_issue_list: 'list_issues',
  lazyhub_issue_view: 'get_issue',
  lazyhub_issue_comment: 'post_comment',
  lazyhub_watch_ci: 'get_checks',
}

const MUTATING_TOOLS = new Set([
  'approve_pr',
  'merge_pr',
  'post_comment',
  'close_issue',
  'review_line',
])

const MCP_MUTATIONS_DISABLED = 'MCP mutating tools are disabled until governed authorization is available'

// list_prs is read by agents: no PR bodies, and at most this many checks per PR
// (failing first; the full tally is always in checksSummary).
const MAX_CHECKS_PER_PR = 10

// package.json sits beside src/ in the checkout and beside dist/ when installed.
function packageVersion() {
  for (const rel of ['../../package.json', '../package.json']) {
    try {
      const pkg = JSON.parse(readFileSync(new URL(rel, import.meta.url), 'utf8'))
      if (pkg.name === 'lazyhub' && pkg.version) return pkg.version
    } catch { /* try the next location */ }
  }
  return 'unknown'
}
const STATES = { list_prs: ['open', 'closed', 'merged', 'all'], list_issues: ['open', 'closed', 'all'] }
// Resource each read tool operates on; a caller-declared resource_type must match.
const RESOURCE_TYPES = { list_prs: 'pr', get_pr: 'pr', get_pr_diff: 'pr', get_checks: 'pr', list_issues: 'issue', get_issue: 'issue' }
const NUMBERED_TOOLS = new Set(['get_pr', 'get_pr_diff', 'get_checks', 'get_issue'])

function fail(code, message) {
  return Object.assign(new Error(message), { code })
}

/**
 * Runtime-validate tool arguments. Fails closed with stable error codes.
 * Only fields validated here are ever read; client-supplied scope/identity
 * metadata is ignored and never confers authority.
 * @param {string} canonical
 * @param {object} args
 */
function validateArgs(canonical, args) {
  if (args === null || typeof args !== 'object' || Array.isArray(args)) {
    throw fail('MCP_INVALID_ARGUMENTS', 'Tool arguments must be an object')
  }
  const expected = RESOURCE_TYPES[canonical]
  if (args.resource_type !== undefined && args.resource_type !== expected) {
    throw fail('MCP_RESOURCE_MISMATCH', `Tool ${canonical} operates on ${expected || 'no'} resources, not ${JSON.stringify(args.resource_type)}`)
  }
  if (args.repo !== undefined && !isRepoSlug(args.repo)) {
    throw fail('MCP_INVALID_REPO', 'repo must be in owner/name form')
  }
  if (NUMBERED_TOOLS.has(canonical) && !isPositiveId(args.number)) {
    throw fail('MCP_INVALID_NUMBER', args.number === undefined
      ? `${canonical} requires a number (the PR or issue number, a positive integer)`
      : 'number must be a positive integer')
  }
  if (args.state !== undefined && !(STATES[canonical] || []).includes(args.state)) {
    throw fail('MCP_INVALID_STATE', `state is not valid for ${canonical}`)
  }
  if (args.limit !== undefined && !(Number.isInteger(args.limit) && args.limit >= 1 && args.limit <= 100)) {
    throw fail('MCP_INVALID_LIMIT', 'limit must be an integer between 1 and 100')
  }
}

const PROP = {
  repo: { type: 'string', description: 'Repository as owner/name. Optional: defaults to the repository lazyhub --mcp was started in, then the saved default.' },
  number: { type: 'integer', minimum: 1, description: 'Pull request or issue number, a positive integer (123 for #123).' },
  limit: { type: 'integer', minimum: 1, maximum: 100, description: 'Most rows to return, 1 to 100 (default 30).' },
  prState: { type: 'string', enum: STATES.list_prs, description: 'Which pull requests to list (default open).' },
  issueState: { type: 'string', enum: STATES.list_issues, description: 'Which issues to list (default open).' },
}
const schema = (properties, required = []) => ({ type: 'object', properties, ...(required.length ? { required } : {}) })
const RT = (tool) => ({ type: 'string', enum: [RESOURCE_TYPES[tool]], description: 'Optional guard naming the resource kind this tool reads; a mismatch is refused with MCP_RESOURCE_MISMATCH.' })
const SCHEMAS = {
  list_prs: schema({ resource_type: RT('list_prs'), repo: PROP.repo, state: PROP.prState, limit: PROP.limit }),
  get_pr: schema({ resource_type: RT('get_pr'), repo: PROP.repo, number: PROP.number }, ['number']),
  get_pr_diff: schema({ resource_type: RT('get_pr_diff'), repo: PROP.repo, number: PROP.number }, ['number']),
  get_checks: schema({ resource_type: RT('get_checks'), repo: PROP.repo, number: PROP.number }, ['number']),
  list_issues: schema({ resource_type: RT('list_issues'), repo: PROP.repo, state: PROP.issueState, limit: PROP.limit }),
  get_issue: schema({ resource_type: RT('get_issue'), repo: PROP.repo, number: PROP.number }, ['number']),
  list_notifications: schema({}),
  list_branches: schema({ repo: PROP.repo }),
}

// What an agent reads to pick a tool (#626): what comes back, how the output is bounded,
// and why it beats parsing raw `gh` output. An alias shares its canonical tool's text.
const DESCRIPTIONS = {
  list_prs: 'List pull requests as compact JSON rows (read-only). Prefer this over `gh pr list`: PR bodies are dropped, each row keeps at most 10 checks (failing first, then pending, then passing) and always carries checksSummary {failing, pending, passing, total}, so CI state costs a few tokens per PR and nothing is hidden. Filter with state, bound with limit (default 30, max 100).',
  get_pr: 'One pull request as JSON (read-only): title, state, author, body, labels, review requests and reviews, check rollup, head and base branch and SHA, changed files, size, mergeability and URL in one call, instead of several `gh pr view` calls. For review triage prefer pr_evidence, which is smaller and says what needs attention.',
  get_pr_diff: 'The unified diff of a pull request as plain text (read-only, same as `gh pr diff`). Large PRs give large output: call review_story or pr_evidence first to see which files matter.',
  get_checks: 'Every check run on the pull request head commit as JSON (read-only): name, status, conclusion, app, URL and timing, paged to the end; a cut-off list ends with an explicit "checks incomplete" row. To learn why a check failed, prefer why_ci_red.',
  list_issues: 'List issues as JSON rows (read-only). Filter with state (default open), bound with limit (default 30, max 100).',
  get_issue: 'One issue as JSON (read-only): title, state, author, body, labels, assignees, milestone, comments and URL in one call, instead of `gh issue view`.',
  list_notifications: "The signed-in account's unread GitHub notifications as JSON (read-only): repository, subject, reason and update time.",
  list_branches: "The repository's branches as JSON (read-only): name, protected flag and head commit SHA.",
}

const TOOLS = [
  ['lazyhub_pr_list', 'list_prs'],
  ['lazyhub_pr_view', 'get_pr'],
  ['lazyhub_pr_diff', 'get_pr_diff'],
  ['lazyhub_issue_list', 'list_issues'],
  ['lazyhub_issue_view', 'get_issue'],
  ['lazyhub_watch_ci', 'get_checks'],
  ['list_prs', 'list_prs'],
  ['get_pr', 'get_pr'],
  ['get_pr_diff', 'get_pr_diff'],
  ['get_checks', 'get_checks'],
  ['list_issues', 'list_issues'],
  ['get_issue', 'get_issue'],
  ['list_notifications', 'list_notifications'],
  ['list_branches', 'list_branches'],
].map(([name, canonical]) => ({ name, description: DESCRIPTIONS[canonical], inputSchema: SCHEMAS[canonical] }))
  // Review tools (#603): one shared, read-only core with the `--json` CLI (src/review-tools/).
  .concat(REVIEW_TOOLS.map(tool => ({ name: tool.name, description: tool.description, inputSchema: reviewInputSchema(tool) })))

const FAILING = new Set(['FAILURE', 'ERROR', 'TIMED_OUT', 'CANCELLED', 'ACTION_REQUIRED', 'STARTUP_FAILURE'])
const PASSING = new Set(['SUCCESS', 'NEUTRAL', 'SKIPPED'])
const checkRank = (c) => {
  const v = String(c?.conclusion || '').toUpperCase()
  if (FAILING.has(v)) return 0
  if (PASSING.has(v)) return 2
  return 1 // no conclusion yet: queued, in progress, pending
}

/**
 * Slim a PR list row for agents: drop the body, keep at most MAX_CHECKS_PER_PR
 * checks (failing first, then pending, then passing) and always report the
 * full tally in checksSummary, so nothing is truncated silently.
 * @param {any} pr
 */
function slimPR(pr) {
  const { body: _body, statusCheckRollup, ...rest } = pr
  if (!Array.isArray(statusCheckRollup)) return rest
  const counts = [0, 0, 0]
  for (const c of statusCheckRollup) counts[checkRank(c)] += 1
  const ordered = statusCheckRollup
    .map((c, i) => [c, i])
    .sort((x, y) => checkRank(x[0]) - checkRank(y[0]) || x[1] - y[1])
    .map(([c]) => c)
  return {
    ...rest,
    statusCheckRollup: ordered.slice(0, MAX_CHECKS_PER_PR),
    checksSummary: { failing: counts[0], pending: counts[1], passing: counts[2], total: statusCheckRollup.length },
  }
}

const repo = () => process.env.GHUI_REPO || null

/**
 * Run a review tool (#603) through the shared core; its error codes gain the MCP_ prefix.
 * @param {string} name
 * @param {object} args
 */
async function callReviewTool(name, args) {
  try {
    return await runReviewTool(name, args, { defaultRepo: repo() })
  } catch (err) {
    if (!(err instanceof ReviewToolError)) throw err
    const extra = [err.extra?.kind && `kind: ${err.extra.kind}`, err.extra?.fix && `fix: ${err.extra.fix}`].filter(Boolean).join('; ')
    throw fail(`MCP_${err.code}`, extra ? `${err.message} (${extra})` : err.message)
  }
}

/**
 * Execute one MCP tool by name.
 *
 * @param {string} name
 * @param {object} args
 */
async function callTool(name, args = {}) {
  if (typeof name !== 'string' || !name) throw fail('MCP_INVALID_TOOL', 'Tool name must be a non-empty string')
  const canonical = TOOL_ALIASES[name] || name
  if (MUTATING_TOOLS.has(canonical)) throw fail('MCP_MUTATIONS_DISABLED', MCP_MUTATIONS_DISABLED)
  if (reviewToolByName(canonical)) return callReviewTool(canonical, args)
  validateArgs(canonical, args)

  const r = args.repo || repo()
  if (SCHEMAS[canonical] && canonical !== 'list_notifications' && !r) {
    throw fail('MCP_INVALID_REPO', 'no repository resolved: pass repo as owner/name, or start lazyhub inside a clone')
  }
  switch (canonical) {
    case 'list_prs': return (await listPRs(r, { state: args.state || 'open', limit: args.limit || 30 })).map(slimPR)
    case 'get_pr': return getPR(r, args.number)
    case 'get_pr_diff': return getPRDiff(r, args.number)
    case 'get_checks': return getPRChecks(r, args.number)
    case 'list_issues': return listIssues(r, { state: args.state || 'open', limit: args.limit || 30 })
    case 'get_issue': return getIssue(r, args.number)
    case 'list_notifications': return listNotifications()
    case 'list_branches': return listBranches(r)
    default: throw fail('MCP_UNKNOWN_TOOL', `Unknown tool: ${name}`)
  }
}

function respond(id, result) {
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n')
}

function respondError(id, code, message) {
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } }) + '\n')
}

/**
 * Handle one JSON-RPC request and write its response to stdout.
 * @param {{id?: any, method?: string, params?: any}} msg
 */
async function handleRequest(msg) {
  const { id, method, params } = msg
  if (method === 'initialize') {
    respond(id, { protocolVersion: '2024-11-05', serverInfo: { name: 'lazyhub', version: packageVersion() }, capabilities: { tools: {} } })
    return
  }
  if (method === 'tools/list') {
    respond(id, { tools: TOOLS })
    return
  }
  if (method === 'tools/call') {
    try {
      const result = await callTool(params?.name, params?.arguments || {})
      respond(id, { content: [{ type: 'text', text: JSON.stringify(result) }] })
    } catch (err) {
      respond(id, { content: [{ type: 'text', text: `Error${err.code ? ` [${err.code}]` : ''}: ${err.message}` }], isError: true })
    }
    return
  }
  if (method === 'notifications/initialized') return
  respondError(id, -32601, `Method not found: ${method}`)
}

/**
 * Run the MCP server over stdio.
 */
export async function runMCPServer() {
  const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity })
  for await (const line of rl) {
    if (!line.trim()) continue
    try {
      await handleRequest(JSON.parse(line))
    } catch (err) {
      respondError(null, -32700, err.message)
    }
  }
}

export { MCP_MUTATIONS_DISABLED, MUTATING_TOOLS, TOOLS, TOOL_ALIASES, callTool, handleRequest }
