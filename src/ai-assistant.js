/**
 * src/ai-assistant.js — AI assistant brain
 *
 * Exposes a Claude tool-use loop that:
 *  - Executes read-only tools freely (up to MAX_TOOL_ROUNDS)
 *  - Never offers mutating tools to the model; a mutating call that still
 *    arrives gets a stable AI_MUTATIONS_DISABLED error (see executeMutatingTool)
 *  - Parses <<NAVIGATE:pane[:key=val]*>> markers for app navigation
 *
 * Model requests go through runAIChat() in src/ai/index.js (no transport here).
 */

import {
  listPRs, getPR, getPRDiff, getPRChecks, listIssues, getIssue,
  listBranches, listRuns, getRepoInfo, listNotifications, listPRComments,
} from './executor.js'
import { runAIChat } from './ai/index.js'

const DEFAULT_MODEL     = 'claude-sonnet-4-6'
const MAX_TOKENS        = 4096
const MAX_DIFF_CHARS    = 8000
const MAX_TOOL_ROUNDS   = 6

const MUTATING_TOOLS   = new Set(['merge_pr', 'close_pr', 'close_issue', 'add_pr_comment', 'add_labels', 'review_pr', 'rerun_run', 'cancel_run'])
const AI_MUTATIONS_DISABLED = 'AI assistant mutating tools are disabled until governed authorization is available'

// ─── Tool definitions ─────────────────────────────────────────────────────────

const TOOL_DEFINITIONS = [
  // ── Read-only ──
  {
    name: 'list_prs',
    description: 'List pull requests in the repository.',
    input_schema: {
      type: 'object',
      properties: {
        state:    { type: 'string', enum: ['open', 'closed', 'merged', 'all'] },
        limit:    { type: 'number', description: 'Max results (default 30)' },
        author:   { type: 'string', description: 'Filter by author login' },
        label:    { type: 'string', description: 'Filter by label name' },
        assignee: { type: 'string', description: 'Filter by assignee login' },
      },
    },
  },
  {
    name: 'get_pr',
    description: 'Get full details for a pull request: body, labels, reviewers, CI status, mergeable.',
    input_schema: {
      type: 'object',
      required: ['number'],
      properties: {
        number: { type: 'number', description: 'PR number' },
      },
    },
  },
  {
    name: 'get_pr_diff',
    description: 'Get the unified diff for a pull request (truncated to 8000 chars).',
    input_schema: {
      type: 'object',
      required: ['number'],
      properties: {
        number: { type: 'number', description: 'PR number' },
      },
    },
  },
  {
    name: 'get_pr_checks',
    description: 'Get CI check / status check results for a pull request.',
    input_schema: {
      type: 'object',
      required: ['number'],
      properties: {
        number: { type: 'number', description: 'PR number' },
      },
    },
  },
  {
    name: 'list_issues',
    description: 'List issues in the repository.',
    input_schema: {
      type: 'object',
      properties: {
        state:    { type: 'string', enum: ['open', 'closed', 'all'] },
        limit:    { type: 'number' },
        author:   { type: 'string' },
        label:    { type: 'string' },
        assignee: { type: 'string' },
      },
    },
  },
  {
    name: 'get_issue',
    description: 'Get full details for a specific issue including comments.',
    input_schema: {
      type: 'object',
      required: ['number'],
      properties: {
        number: { type: 'number', description: 'Issue number' },
      },
    },
  },
  {
    name: 'list_branches',
    description: 'List branches in the repository.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'list_runs',
    description: 'List recent GitHub Actions workflow runs.',
    input_schema: {
      type: 'object',
      properties: {
        branch: { type: 'string', description: 'Filter by branch name' },
        status: { type: 'string', description: 'Filter by status: completed, in_progress, queued, etc.' },
      },
    },
  },
  {
    name: 'get_repo_info',
    description: 'Get repository metadata: name, owner, default branch, allowed merge methods.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'list_notifications',
    description: 'List GitHub notifications (mentions, review requests, etc.).',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'list_pr_comments',
    description: 'List review comments (line-level threads) on a pull request.',
    input_schema: {
      type: 'object',
      required: ['number'],
      properties: {
        number: { type: 'number', description: 'PR number' },
      },
    },
  },
]

// ─── System prompt ────────────────────────────────────────────────────────────

/**
 * Build the system prompt for the AI assistant.
 * @param {object} [ctx]
 */
function buildSystemPrompt(ctx = {}) {
  const { repo, pane, selectedItem } = ctx
  const today = new Date().toISOString().split('T')[0]

  const lines = [
    `You are an AI assistant embedded in lazyhub, a GitHub TUI (terminal UI). Today is ${today}.`,
    'You help users understand and navigate their GitHub repositories.',
    '',
  ]

  if (repo)  lines.push(`Current repository: ${repo}`)
  if (pane)  lines.push(`Current pane: ${pane}`)
  if (selectedItem?.number) {
    const kind = pane === 'issues' ? 'issue' : 'PR'
    lines.push(`Selected ${kind}: #${selectedItem.number} "${selectedItem.title || ''}" by ${selectedItem.author?.login || '?'} [${selectedItem.state || '?'}]`)
  }

  lines.push(
    '',
    '## Rules',
    '- NEVER fabricate data — always call a tool to fetch real information.',
    '- You have read-only access. You cannot merge, close, comment, label, review, rerun or cancel anything. If asked to, explain that write actions are disabled in the assistant and point to the lazyhub keyboard shortcut instead.',
    '- For navigation: embed a marker <<NAVIGATE:pane>> or <<NAVIGATE:pane:number=42>> anywhere in your text. Valid panes: prs, issues, branches, actions, notifications.',
    '  Example: "Here is PR #42. <<NAVIGATE:prs:number=42>>"',
    '- Keep responses concise and terminal-friendly — avoid heavy markdown formatting.',
    '- When explaining how to do things in lazyhub, refer to the keyboard shortcuts (j/k navigate, Enter opens, d opens diff, m merges, etc.).',
    '- You may chain multiple read-only tool calls to fully answer a question.',
  )

  return lines.join('\n')
}

// ─── Status label for tool calls (shown in UI while thinking) ─────────────────

function toolLabel(name, input) {
  switch (name) {
    case 'list_prs':          return `listing ${input.state || 'open'} PRs${input.author ? ` by @${input.author}` : ''}…`
    case 'get_pr':            return `fetching PR #${input.number}…`
    case 'get_pr_diff':       return `loading diff for PR #${input.number}…`
    case 'get_pr_checks':     return `checking CI status for PR #${input.number}…`
    case 'list_issues':       return `listing ${input.state || 'open'} issues…`
    case 'get_issue':         return `fetching issue #${input.number}…`
    case 'list_branches':     return 'listing branches…'
    case 'list_runs':         return `listing workflow runs${input.branch ? ` on ${input.branch}` : ''}…`
    case 'get_repo_info':     return 'fetching repo info…'
    case 'list_notifications':return 'listing notifications…'
    case 'list_pr_comments':  return `loading comments for PR #${input.number}…`
    default:                  return `${name.replace(/_/g, ' ')}…`
  }
}

// ─── Read-only tool dispatch ──────────────────────────────────────────────────

async function callReadOnlyTool(toolName, toolInput, repo) {
  switch (toolName) {
    case 'list_prs':
      return listPRs(repo, {
        state:    toolInput.state    || 'open',
        limit:    toolInput.limit    || 30,
        author:   toolInput.author,
        label:    toolInput.label,
        assignee: toolInput.assignee,
      })
    case 'get_pr':       return getPR(repo, toolInput.number)
    case 'get_pr_diff': {
      const diff = await getPRDiff(repo, toolInput.number)
      return typeof diff === 'string' ? diff.slice(0, MAX_DIFF_CHARS) : diff
    }
    case 'get_pr_checks': return getPRChecks(repo, toolInput.number)
    case 'list_issues':
      return listIssues(repo, {
        state:    toolInput.state    || 'open',
        limit:    toolInput.limit    || 30,
        author:   toolInput.author,
        label:    toolInput.label,
        assignee: toolInput.assignee,
      })
    case 'get_issue':          return getIssue(repo, toolInput.number)
    case 'list_branches':      return listBranches(repo)
    case 'list_runs':          return listRuns(repo, { branch: toolInput.branch, status: toolInput.status })
    case 'get_repo_info':      return getRepoInfo(repo)
    case 'list_notifications': return listNotifications()
    case 'list_pr_comments':   return listPRComments(repo, toolInput.number)
    default:
      throw new Error(`Unknown read-only tool: ${toolName}`)
  }
}

/**
 * Route a model tool call: mutating names are denied, everything else is read-only.
 * @param {string} toolName
 * @param {object} toolInput
 * @param {string} repo
 */
function dispatchTool(toolName, toolInput, repo) {
  if (MUTATING_TOOLS.has(toolName)) return executeMutatingTool(toolName, toolInput, repo)
  return callReadOnlyTool(toolName, toolInput, repo)
}

// ─── Mutating tools: disabled ─────────────────────────────────────────────────

/**
 * Model-proposed GitHub writes are disabled for review Alpha, including
 * human-confirmed ones (B-64, supersedes B-50). Always rejects with a stable
 * code and never reaches the executor.
 * @param {string} _toolName
 * @param {object} _toolInput
 * @param {string} _repo
 */
export async function executeMutatingTool(_toolName, _toolInput, _repo) {
  throw Object.assign(new Error(AI_MUTATIONS_DISABLED), { code: 'AI_MUTATIONS_DISABLED' })
}

// ─── Navigation marker parser ─────────────────────────────────────────────────

function parseNavigate(text) {
  const m = text.match(/<<NAVIGATE:([^>]+)>>/)
  if (!m) return null
  const parts  = m[1].split(':')
  const result = { pane: parts[0] }
  for (let i = 1; i < parts.length; i++) {
    const eqIdx = parts[i].indexOf('=')
    if (eqIdx < 0) continue
    const k = parts[i].slice(0, eqIdx)
    const v = parts[i].slice(eqIdx + 1)
    if (k === 'number') result.itemNumber = parseInt(v, 10)
    else result[k] = v
  }
  return result
}

function findNavInText(text) {
  // scan all <<NAVIGATE:...>> markers, return first valid one
  let navData = null
  const re = /<<NAVIGATE:([^>]+)>>/g
  let m
  while ((m = re.exec(text)) !== null) {
    navData = parseNavigate(m[0])
    if (navData) break
  }
  return navData
}

// ─── Turn runner ──────────────────────────────────────────────────────────────

/**
 * @typedef {object} AssistantResult
 * @property {string} type
 * @property {string} text
 * @property {object} [navigate]
 * @property {Array} [messages]
 * @property {object} [usage]
 * @property {string} [error]
 */

/**
 * Run one user turn through the tool-use loop. Every model request goes
 * through `runAIChat()` (src/ai/index.js), which owns provider selection,
 * transport, timeouts and usage logging.
 *
 * @param {object} opts
 * @param {Array}  opts.messages     - Prior messages in provider-specific format
 * @param {string} opts.userMessage  - New user text
 * @param {string} opts.repo         - owner/repo
 * @param {object} opts.ctx          - { repo, pane, selectedItem }
 * @param {object} opts.aiConfig     - From config.ai
 * @param {Function} [opts.onStatus] - Called with a status string during tool execution
 * @param {AbortSignal} [opts.signal] - Cancels the in-flight model request
 * @returns {Promise<AssistantResult>}
 */
export async function runAssistantTurn({ messages, userMessage, repo, ctx, aiConfig, onStatus, signal }) {
  const provider = aiConfig?.provider || 'anthropic'
  const isAnthropic = !['openai', 'ollama', 'openai-compatible'].includes(provider)
  if (isAnthropic && !aiConfig?.anthropicApiKey) {
    return { type: 'error', text: 'No Anthropic API key set. Open Settings → AI Provider to configure.' }
  }

  const emit = onStatus || (() => {})
  const system = buildSystemPrompt(ctx)
  const apiMessages = [...messages, { role: 'user', content: userMessage }]
  const cfg = { ...aiConfig, model: aiConfig?.model || (isAnthropic ? DEFAULT_MODEL : undefined) }

  for (let round = 1; round <= MAX_TOOL_ROUNDS; round++) {
    emit(round > 1 ? `thinking (round ${round})…` : 'thinking…')

    let reply
    try {
      reply = await runAIChat({ aiConfig: cfg, system, messages: apiMessages, tools: TOOL_DEFINITIONS, maxTokens: MAX_TOKENS, signal })
    } catch (err) {
      if (err.name === 'AbortError') return { type: 'error', text: 'Request cancelled' }
      return { type: 'error', text: err.message }
    }

    apiMessages.push(reply.message)

    const [toolCall] = reply.toolCalls
    if (toolCall) {
      emit(toolLabel(toolCall.name, toolCall.input))

      let toolResult
      try { toolResult = await dispatchTool(toolCall.name, toolCall.input, repo) }
      catch (err) { toolResult = { error: err.message, code: err.code } }

      apiMessages.push(reply.toolResultMessage(toolCall.id, JSON.stringify(toolResult)))
      continue
    }

    const navigate = findNavInText(reply.text)
    if (navigate) return { type: 'navigate', text: reply.text, navigate, messages: apiMessages }
    return { type: 'answer', text: reply.text || '(no response)', messages: apiMessages }
  }

  return { type: 'error', text: 'Reached maximum tool-call rounds — please try a simpler question' }
}
