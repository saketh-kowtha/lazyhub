import * as readline from 'readline'
import {
  addPRComment,
  addPRLineComment,
  closeIssue,
  getIssue,
  getPR,
  getPRChecks,
  getPRDiff,
  listBranches,
  listIssues,
  listNotifications,
  listPRs,
  mergePR,
  reviewPR,
} from '../executor.js'

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
  lazyhub_query: 'query',
  lazyhub_watch_ci: 'get_checks',
}

const TOOLS = [
  ['lazyhub_pr_list', 'List pull requests'],
  ['lazyhub_pr_view', 'View a pull request'],
  ['lazyhub_pr_diff', 'Get a pull request diff'],
  ['lazyhub_pr_approve', 'Approve a pull request'],
  ['lazyhub_pr_merge', 'Merge a pull request'],
  ['lazyhub_pr_comment', 'Comment on a pull request'],
  ['lazyhub_pr_review_line', 'Create a line review comment'],
  ['lazyhub_issue_list', 'List issues'],
  ['lazyhub_issue_view', 'View an issue'],
  ['lazyhub_issue_comment', 'Comment on an issue'],
  ['lazyhub_query', 'Query lazyhub context'],
  ['lazyhub_watch_ci', 'Get CI status for a PR'],
  ['list_prs', 'List pull requests'],
  ['get_pr', 'View a pull request'],
  ['get_pr_diff', 'Get a pull request diff'],
  ['get_checks', 'Get CI checks'],
  ['list_issues', 'List issues'],
  ['get_issue', 'View an issue'],
  ['list_notifications', 'List notifications'],
  ['post_comment', 'Post a comment'],
  ['merge_pr', 'Merge a pull request'],
  ['close_issue', 'Close an issue'],
  ['list_branches', 'List branches'],
].map(([name, description]) => ({
  name,
  description,
  inputSchema: {
    type: 'object',
    properties: {
      repo: { type: 'string' },
      number: { type: 'number' },
      state: { type: 'string' },
      limit: { type: 'number' },
      body: { type: 'string' },
      strategy: { type: 'string' },
    },
  },
}))

const repo = () => process.env.GHUI_REPO || null

/**
 * Execute one MCP tool by name.
 *
 * @param {string} name
 * @param {object} args
 */
async function callTool(name, args = {}) {
  const canonical = TOOL_ALIASES[name] || name
  const r = args.repo || repo()
  switch (canonical) {
    case 'list_prs': return listPRs(r, { state: args.state || 'open', limit: args.limit || 30 })
    case 'get_pr': return getPR(r, args.number)
    case 'get_pr_diff': return getPRDiff(r, args.number)
    case 'get_checks': return getPRChecks(r, args.number)
    case 'approve_pr': return reviewPR(r, args.number, 'approve', args.body || '')
    case 'merge_pr': return mergePR(r, args.number, args.strategy || 'merge', args.message)
    case 'list_issues': return listIssues(r, { state: args.state || 'open', limit: args.limit || 30 })
    case 'get_issue': return getIssue(r, args.number)
    case 'list_notifications': return listNotifications()
    case 'post_comment': return addPRComment(r, args.number, args.body)
    case 'close_issue': return closeIssue(r, args.number)
    case 'list_branches': return listBranches(r)
    case 'review_line':
      return addPRLineComment(r, args.number, {
        body: args.body,
        path: args.file || args.path,
        line: args.line,
        side: args.side || 'RIGHT',
        commitId: args.commitId,
      })
    case 'query': return { answer: 'lazyhub_query is available; AI-backed answers are configured by provider in later phases.' }
    default: throw new Error(`Unknown tool: ${name}`)
  }
}

function respond(id, result) {
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n')
}

function respondError(id, code, message) {
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } }) + '\n')
}

async function handleRequest(msg) {
  const { id, method, params } = msg
  if (method === 'initialize') {
    respond(id, { protocolVersion: '2024-11-05', serverInfo: { name: 'lazyhub', version: '1.0.0' }, capabilities: { tools: {} } })
    return
  }
  if (method === 'tools/list') {
    respond(id, { tools: TOOLS })
    return
  }
  if (method === 'tools/call') {
    try {
      const result = await callTool(params?.name, params?.arguments || {})
      respond(id, { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] })
    } catch (err) {
      respond(id, { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true })
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

export { TOOLS, callTool }
