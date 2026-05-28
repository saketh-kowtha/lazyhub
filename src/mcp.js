/**
 * src/mcp.js — MCP (Model Context Protocol) server mode
 *
 * Usage:  lazyhub --mcp
 *
 * Speaks MCP protocol over stdio (JSON-RPC 2.0).
 * AI assistants (Claude Code, GitHub Copilot, Cursor AI, etc.) can use this
 * to query and act on GitHub data without writing their own gh CLI wrappers.
 *
 * Tools exposed:
 *   list_prs            list open/closed/merged pull requests
 *   get_pr              get full PR details + comments
 *   list_issues         list open/closed issues
 *   get_issue           get full issue details + comments
 *   list_notifications  list GitHub notifications
 *   post_comment        post a comment on a PR or issue
 *   merge_pr            merge a pull request
 *   close_issue         close an issue
 *   list_branches       list repository branches
 *   get_pr_diff         get the unified diff for a PR
 *   get_checks          get CI check status for a PR
 */

import * as readline from 'readline'
import {
  listPRs, getPR, getPRDiff, listIssues, getIssue, listNotifications,
  addPRComment, mergePR, closeIssue, listBranches, getPRChecks,
} from './executor.js'

// ─── Tool definitions (MCP schema) ───────────────────────────────────────────

const TOOLS = [
  {
    name: 'list_prs',
    description: 'List pull requests in the repository.',
    inputSchema: {
      type: 'object',
      properties: {
        repo:  { type: 'string', description: 'owner/repo (omit to use current repo)' },
        state: { type: 'string', enum: ['open', 'closed', 'merged', 'all'], default: 'open' },
        limit: { type: 'number', default: 30 },
      },
    },
  },
  {
    name: 'get_pr',
    description: 'Get detailed information about a specific pull request including body and comments.',
    inputSchema: {
      type: 'object',
      required: ['number'],
      properties: {
        repo:   { type: 'string', description: 'owner/repo (omit to use current repo)' },
        number: { type: 'number', description: 'PR number' },
      },
    },
  },
  {
    name: 'get_pr_diff',
    description: 'Get the unified diff of a pull request.',
    inputSchema: {
      type: 'object',
      required: ['number'],
      properties: {
        repo:   { type: 'string' },
        number: { type: 'number', description: 'PR number' },
      },
    },
  },
  {
    name: 'get_checks',
    description: 'Get CI check / status check results for a pull request.',
    inputSchema: {
      type: 'object',
      required: ['number'],
      properties: {
        repo:   { type: 'string' },
        number: { type: 'number', description: 'PR number' },
      },
    },
  },
  {
    name: 'list_issues',
    description: 'List issues in the repository.',
    inputSchema: {
      type: 'object',
      properties: {
        repo:  { type: 'string' },
        state: { type: 'string', enum: ['open', 'closed', 'all'], default: 'open' },
        limit: { type: 'number', default: 30 },
      },
    },
  },
  {
    name: 'get_issue',
    description: 'Get detailed information about a specific issue including body and comments.',
    inputSchema: {
      type: 'object',
      required: ['number'],
      properties: {
        repo:   { type: 'string' },
        number: { type: 'number', description: 'Issue number' },
      },
    },
  },
  {
    name: 'list_notifications',
    description: 'List GitHub notifications (PRs, issues, releases, etc. that mention you).',
    inputSchema: {
      type: 'object',
      properties: {
        repo: { type: 'string', description: 'Filter to a specific repo (omit for all repos)' },
      },
    },
  },
  {
    name: 'post_comment',
    description: 'Post a comment on a pull request or issue.',
    inputSchema: {
      type: 'object',
      required: ['number', 'body'],
      properties: {
        repo:   { type: 'string' },
        number: { type: 'number', description: 'PR or issue number' },
        body:   { type: 'string', description: 'Comment text (Markdown supported)' },
      },
    },
  },
  {
    name: 'merge_pr',
    description: 'Merge a pull request.',
    inputSchema: {
      type: 'object',
      required: ['number'],
      properties: {
        repo:     { type: 'string' },
        number:   { type: 'number', description: 'PR number' },
        strategy: { type: 'string', enum: ['merge', 'squash', 'rebase'], default: 'merge' },
        message:  { type: 'string', description: 'Custom merge commit message (optional)' },
      },
    },
  },
  {
    name: 'close_issue',
    description: 'Close an issue.',
    inputSchema: {
      type: 'object',
      required: ['number'],
      properties: {
        repo:   { type: 'string' },
        number: { type: 'number', description: 'Issue number' },
      },
    },
  },
  {
    name: 'list_branches',
    description: 'List branches in the repository.',
    inputSchema: {
      type: 'object',
      properties: {
        repo:  { type: 'string' },
        limit: { type: 'number', default: 50 },
      },
    },
  },
]

// ─── Tool execution ──────────────────────────────────────────────────────────

const repo = () => process.env.GHUI_REPO || null

async function callTool(name, args) {
  const r = args.repo || repo()
  switch (name) {
    case 'list_prs':
      return listPRs(r, { state: args.state || 'open', limit: args.limit || 30 })

    case 'get_pr':
      return getPR(r, args.number)

    case 'get_pr_diff':
      return getPRDiff(r, args.number)

    case 'get_checks':
      return getPRChecks(r, args.number)

    case 'list_issues':
      return listIssues(r, { state: args.state || 'open', limit: args.limit || 30 })

    case 'get_issue':
      return getIssue(r, args.number)

    case 'list_notifications':
      return listNotifications()

    case 'post_comment':
      return addPRComment(r, args.number, args.body)

    case 'merge_pr':
      return mergePR(r, args.number, args.strategy || 'merge', args.message)

    case 'close_issue':
      return closeIssue(r, args.number)

    case 'list_branches':
      return listBranches(r, { limit: args.limit || 50 })

    default:
      throw new Error(`Unknown tool: ${name}`)
  }
}

// ─── JSON-RPC helpers ─────────────────────────────────────────────────────────

function respond(id, result) {
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n')
}

function respondError(id, code, message) {
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } }) + '\n')
}

async function handleRequest(msg) {
  const { id, method, params } = msg

  switch (method) {
    case 'initialize':
      respond(id, {
        protocolVersion: '2024-11-05',
        serverInfo: { name: 'lazyhub', version: '1.0.0' },
        capabilities: { tools: {} },
      })
      break

    case 'tools/list':
      respond(id, { tools: TOOLS })
      break

    case 'tools/call': {
      const toolName = params?.name
      const toolArgs = params?.arguments || {}
      const tool = TOOLS.find(t => t.name === toolName)
      if (!tool) {
        respondError(id, -32601, `Tool not found: ${toolName}`)
        return
      }
      try {
        const result = await callTool(toolName, toolArgs)
        respond(id, {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        })
      } catch (err) {
        respond(id, {
          content: [{ type: 'text', text: `Error: ${err.message}` }],
          isError: true,
        })
      }
      break
    }

    case 'notifications/initialized':
      // no-op: client ready ack
      break

    default:
      respondError(id, -32601, `Method not found: ${method}`)
  }
}

// ─── Entry point ─────────────────────────────────────────────────────────────

/**
 * Run lazyhub as an MCP server over stdio.
 * Blocks until stdin closes.
 */
export async function runMCPServer() {
  const rl = readline.createInterface({ input: process.stdin, terminal: false })

  rl.on('line', async (line) => {
    if (!line.trim()) return
    let msg
    try { msg = JSON.parse(line) } catch { return }
    try { await handleRequest(msg) } catch (err) {
      if (msg?.id != null) respondError(msg.id, -32603, err.message)
    }
  })

  return new Promise((resolve) => rl.once('close', resolve))
}
