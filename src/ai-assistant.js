/**
 * src/ai-assistant.js — AI assistant brain
 *
 * Exposes a Claude tool-use loop that:
 *  - Executes read-only tools freely (up to MAX_TOOL_ROUNDS)
 *  - Never offers mutating tools to the model; a mutating call that still
 *    arrives gets a stable AI_MUTATIONS_DISABLED error (see executeMutatingTool)
 *  - Parses <<NAVIGATE:pane[:key=val]*>> markers for app navigation
 *
 * Direct fetch pattern (same as ai.js). No SDK dependency.
 */

import {
  listPRs, getPR, getPRDiff, getPRChecks, listIssues, getIssue,
  listBranches, listRuns, getRepoInfo, listNotifications, listPRComments,
} from './executor.js'

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages'
const ANTHROPIC_VERSION = '2023-06-01'

function fetchErrorMessage(err, baseUrl) {
  const cause = err.cause
  const code  = cause?.code || cause?.errno || ''
  if (code === 'ECONNREFUSED' || code === 'ECONNRESET') {
    if (baseUrl && !baseUrl.includes('anthropic.com') && !baseUrl.includes('openai.com')) {
      return `Connection refused to ${baseUrl} — is your local server running?`
    }
    return 'Connection refused — check your network or provider URL in Settings'
  }
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') {
    return 'DNS lookup failed — check your internet connection'
  }
  if (code === 'ETIMEDOUT' || code === 'ECONNABORTED') {
    return 'Connection timed out — provider may be unreachable'
  }
  // Surface the underlying message if available, otherwise fall back to err.message
  return cause?.message || err.message
}
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

// ─── OpenAI tool definitions (converted from Anthropic input_schema format) ───

const OPENAI_TOOL_DEFINITIONS = TOOL_DEFINITIONS.map(d => ({
  type: 'function',
  function: {
    name:        d.name,
    description: d.description,
    parameters:  d.input_schema,
  },
}))

// ─── Anthropic adapter ────────────────────────────────────────────────────────

async function runAnthropicTurn({ messages, userMessage, repo, ctx, aiConfig, onStatus }) {
  const apiKey = aiConfig?.anthropicApiKey
  if (!apiKey) {
    return { type: 'error', text: 'No Anthropic API key set. Open Settings → AI Provider to configure.' }
  }

  const emit = onStatus || (() => {})
  const model  = aiConfig?.model || DEFAULT_MODEL
  const system = buildSystemPrompt(ctx)
  const apiMessages = [...messages, { role: 'user', content: userMessage }]
  let rounds = 0

  while (rounds < MAX_TOOL_ROUNDS) {
    rounds++
    emit(rounds > 1 ? `thinking (round ${rounds})…` : 'thinking…')

    let response
    try {
      response = await fetch(ANTHROPIC_API_URL, {
        method: 'POST',
        headers: {
          'x-api-key':         apiKey,
          'anthropic-version': ANTHROPIC_VERSION,
          'content-type':      'application/json',
        },
        body: JSON.stringify({
          model,
          max_tokens: MAX_TOKENS,
          system,
          tools:    TOOL_DEFINITIONS,
          messages: apiMessages,
        }),
      })
    } catch (err) {
      return { type: 'error', text: `Network error: ${fetchErrorMessage(err, ANTHROPIC_API_URL)}` }
    }

    if (!response.ok) {
      const status = response.status
      if (status === 401) return { type: 'error', text: 'Invalid Anthropic API key' }
      if (status === 429) return { type: 'error', text: 'Rate limit exceeded — try again shortly' }
      if (status >= 500) return { type: 'error', text: 'Anthropic service error — try again' }
      return { type: 'error', text: `API error ${status}` }
    }

    let body
    try { body = await response.json() } catch {
      return { type: 'error', text: 'Could not parse API response' }
    }

    apiMessages.push({ role: 'assistant', content: body.content })

    const textBlocks   = (body.content || []).filter(b => b.type === 'text')
    const toolUseBlock = (body.content || []).find(b => b.type === 'tool_use')
    const textContent  = textBlocks.map(b => b.text).join('\n').trim()

    if (toolUseBlock) {
      emit(toolLabel(toolUseBlock.name, toolUseBlock.input))

      let toolResult
      try { toolResult = await dispatchTool(toolUseBlock.name, toolUseBlock.input, repo) }
      catch (err) { toolResult = { error: err.message, code: err.code } }

      apiMessages.push({
        role:    'user',
        content: [{ type: 'tool_result', tool_use_id: toolUseBlock.id, content: JSON.stringify(toolResult) }],
      })
      continue
    }

    let navData = null
    for (const b of textBlocks) {
      navData = findNavInText(b.text)
      if (navData) break
    }

    if (navData) return { type: 'navigate', text: textContent, navigate: navData, messages: apiMessages }
    return { type: 'answer', text: textContent || '(no response)', messages: apiMessages }
  }

  return { type: 'error', text: 'Reached maximum tool-call rounds — please try a simpler question' }
}

// ─── OpenAI-compatible adapter ────────────────────────────────────────────────

async function runOpenAITurn({ messages, userMessage, repo, ctx, aiConfig, onStatus }) {
  const apiKey  = aiConfig?.openaiApiKey
  const baseUrl = (aiConfig?.openaiBaseUrl || 'https://api.openai.com/v1').replace(/\/$/, '')
  const model   = aiConfig?.model || 'gpt-4o'

  const emit = onStatus || (() => {})

  // Key is optional — local endpoints (Ollama, vLLM, etc.) don't need one.
  // If the server rejects the request with 401 we surface the error then.

  const system = buildSystemPrompt(ctx)

  // OpenAI keeps system prompt as first message (not in history)
  // History messages are user/assistant/tool turns only
  const apiMessages = [
    { role: 'system', content: system },
    ...messages,
    { role: 'user', content: userMessage },
  ]
  let rounds = 0

  while (rounds < MAX_TOOL_ROUNDS) {
    rounds++
    emit(rounds > 1 ? `thinking (round ${rounds})…` : 'thinking…')

    let response
    try {
      const headers = { 'content-type': 'application/json' }
      if (apiKey) headers['authorization'] = `Bearer ${apiKey}`

      response = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model,
          max_tokens:  MAX_TOKENS,
          tools:       OPENAI_TOOL_DEFINITIONS,
          tool_choice: 'auto',
          messages:    apiMessages,
        }),
      })
    } catch (err) {
      return { type: 'error', text: `Network error: ${fetchErrorMessage(err, baseUrl)}` }
    }

    if (!response.ok) {
      const status = response.status
      if (status === 401) return { type: 'error', text: 'Invalid API key' }
      if (status === 429) return { type: 'error', text: 'Rate limit exceeded — try again shortly' }
      if (status >= 500) return { type: 'error', text: 'Provider service error — try again' }
      // Surface provider error details (model not found, etc.)
      let detail = ''
      try { const b = await response.json(); detail = b?.error?.message || '' } catch { /* ignore */ }
      return { type: 'error', text: `API error ${status}${detail ? `: ${detail}` : ''}` }
    }

    let body
    try { body = await response.json() } catch {
      return { type: 'error', text: 'Could not parse API response' }
    }

    const msg        = body?.choices?.[0]?.message
    const textContent = (msg?.content || '').trim()
    const toolCalls  = msg?.tool_calls || []

    // Append assistant turn to history (without the system message prefix)
    apiMessages.push(msg)

    if (toolCalls.length > 0) {
      const tc = toolCalls[0]
      const toolName = tc.function.name
      let toolInput
      try { toolInput = JSON.parse(tc.function.arguments) } catch { toolInput = {} }

      emit(toolLabel(toolName, toolInput))

      let toolResult
      try { toolResult = await dispatchTool(toolName, toolInput, repo) }
      catch (err) { toolResult = { error: err.message, code: err.code } }

      apiMessages.push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify(toolResult) })
      continue
    }

    const navData = findNavInText(textContent)
    // Strip system message from returned history
    const history = apiMessages.filter(m => m.role !== 'system')

    if (navData) return { type: 'navigate', text: textContent, navigate: navData, messages: history }
    return { type: 'answer', text: textContent || '(no response)', messages: history }
  }

  return { type: 'error', text: 'Reached maximum tool-call rounds — please try a simpler question' }
}

// ─── Public turn runner — dispatches by provider ─────────────────────────────

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
 * Run one user turn through the tool-use loop.
 *
 * @param {object} opts
 * @param {Array}  opts.messages     - Prior messages in provider-specific format
 * @param {string} opts.userMessage  - New user text
 * @param {string} opts.repo         - owner/repo
 * @param {object} opts.ctx          - { repo, pane, selectedItem }
 * @param {object} opts.aiConfig     - From config.ai
 * @param {Function} [opts.onStatus] - Called with a status string during tool execution
 * @returns {Promise<AssistantResult>}
 */
export async function runAssistantTurn({ messages, userMessage, repo, ctx, aiConfig, onStatus }) {
  const provider = aiConfig?.provider || 'anthropic'
  if (provider === 'openai' || provider === 'ollama' || provider === 'openai-compatible') {
    // For ollama: use openai-compatible adapter with its baseUrl; no key needed
    const cfg = provider === 'ollama'
      ? {
          ...aiConfig,
          provider:      'openai',
          openaiBaseUrl: aiConfig?.openaiBaseUrl || 'http://localhost:11434/v1',
          model:         aiConfig?.model         || 'llama3',
        }
      : provider === 'openai-compatible'
        ? {
            ...aiConfig,
            provider:      'openai',
            openaiApiKey:  (aiConfig?.openai_compatible || aiConfig?.openaiCompatible)?.api_key,
            openaiBaseUrl: (aiConfig?.openai_compatible || aiConfig?.openaiCompatible)?.base_url,
            model:         (aiConfig?.openai_compatible || aiConfig?.openaiCompatible)?.model,
          }
      : aiConfig
    return runOpenAITurn({ messages, userMessage, repo, ctx, aiConfig: cfg, onStatus })
  }
  return runAnthropicTurn({ messages, userMessage, repo, ctx, aiConfig, onStatus })
}
