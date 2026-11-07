/**
 * LazyHub VS Code Extension
 *
 * Provides deep integration between VS Code / Cursor and a running lazyhub instance:
 *
 *  - Open lazyhub in the integrated terminal (Ctrl+G H / Cmd+G H)
 *  - Open lazyhub focused on the PR for the current branch (Ctrl+G P / Cmd+G P)
 *  - Status bar item: shows current PR number + CI state from lazyhub IPC
 *  - Load PR review comments as VS Code diagnostics (Problems panel + inline squiggles)
 *  - Git blame → PR: open the PR that introduced the line under the cursor
 *
 * IPC: communicates with lazyhub via the Unix socket at ~/.lazyhub-socket
 * (written by lazyhub on startup when ipc.enabled is true in config).
 */

// @ts-check
const vscode = require('vscode')
const net    = require('net')
const fs     = require('fs')
const path   = require('path')
const os     = require('os')
const { execFile } = require('child_process')

const SOCKET_POINTER = path.join(os.homedir(), '.lazyhub-socket')
const DIAG_SOURCE    = 'lazyhub'

/** @type {vscode.StatusBarItem} */
let statusBar

/** @type {vscode.DiagnosticCollection} */
let diagCollection

/** @type {vscode.Terminal | undefined} */
let terminal

// ─── IPC ─────────────────────────────────────────────────────────────────────

function getSocketPath() {
  try {
    if (fs.existsSync(SOCKET_POINTER)) {
      return fs.readFileSync(SOCKET_POINTER, 'utf8').trim()
    }
  } catch { /* ignore */ }
  return null
}

/**
 * Send a request to a running lazyhub IPC server.
 * @param {object} msg
 * @returns {Promise<object|null>}
 */
function sendIPC(msg) {
  return new Promise((resolve) => {
    const sockPath = getSocketPath()
    if (!sockPath || !fs.existsSync(sockPath)) { resolve(null); return }

    const socket = net.createConnection(sockPath)
    const id  = Math.random().toString(36).slice(2)
    let   buf = ''

    socket.once('connect', () => {
      let auth
      try { auth = fs.readFileSync(`${sockPath}.token`, 'utf8').trim() } catch { /* no session token: the server will refuse */ }
      socket.write(JSON.stringify({ id, v: 1, auth, ...msg }) + '\n')
    })

    socket.on('data', (chunk) => {
      buf += chunk.toString()
      for (const line of buf.split('\n')) {
        try {
          const parsed = JSON.parse(line.trim())
          if (parsed.id === id) { socket.destroy(); resolve(parsed); return }
        } catch { /* partial line */ }
      }
    })

    socket.once('error',   () => resolve(null))
    socket.once('timeout', () => { socket.destroy(); resolve(null) })
    socket.setTimeout(3000)
  })
}

// ─── Terminal helpers ─────────────────────────────────────────────────────────

function getOrCreateTerminal(cfg) {
  if (cfg.get('reuseTerminal') && terminal && !terminal.exitStatus) {
    return terminal
  }
  terminal = vscode.window.createTerminal({
    name: cfg.get('terminalName') || 'lazyhub',
    env:  { GHUI_REPO: getRepoSlug() || '' },
  })
  return terminal
}

function getRepoSlug() {
  const folders = vscode.workspace.workspaceFolders
  if (!folders?.length) return null
  try {
    const remote = require('child_process')
      .execFileSync('git', ['remote', 'get-url', 'origin'], { cwd: folders[0].uri.fsPath })
      .toString().trim()
    const m = remote.match(/github\.com[/:]([^/\s]+\/[^/\s.]+?)(?:\.git)?$/)
    return m ? m[1] : null
  } catch {
    return null
  }
}

// ─── Commands ─────────────────────────────────────────────────────────────────

function cmdOpen(cfg) {
  const t = getOrCreateTerminal(cfg)
  t.sendText('lazyhub', true)
  t.show()
}

function cmdOpenPR(cfg) {
  const t = getOrCreateTerminal(cfg)
  t.show()
  // lazyhub auto-selects the PR for the current branch on startup
  t.sendText('lazyhub', true)
}

async function cmdShowDiagnostics() {
  const resp = await sendIPC({ type: 'state' })
  if (!resp?.state?.prNumber) {
    vscode.window.showInformationMessage('LazyHub: no PR open in lazyhub (or lazyhub is not running)')
    return
  }
  const { repo, prNumber } = resp.state
  if (!repo) return

  execFile('gh', [
    'api', `repos/${repo}/pulls/${prNumber}/comments`,
    '--jq', '[.[] | {path: .path, line: .line, body: .body, user: .user.login}]',
  ], (err, stdout) => {
    if (err || !stdout) return
    let comments
    try { comments = JSON.parse(stdout) } catch { return }
    if (!Array.isArray(comments)) return

    diagCollection.clear()

    /** @type {Map<string, vscode.Diagnostic[]>} */
    const byFile = new Map()

    for (const c of comments) {
      if (!c.path || !c.line) continue
      if (!byFile.has(c.path)) byFile.set(c.path, [])
      const range = new vscode.Range(
        new vscode.Position((c.line || 1) - 1, 0),
        new vscode.Position((c.line || 1) - 1, 9999)
      )
      const diag = new vscode.Diagnostic(
        range,
        `[${c.user || 'reviewer'}] ${c.body || ''}`,
        vscode.DiagnosticSeverity.Information
      )
      diag.source = DIAG_SOURCE
      byFile.get(c.path).push(diag)
    }

    // Map relative file paths to workspace URIs
    const folders = vscode.workspace.workspaceFolders || []
    for (const [relPath, diags] of byFile) {
      for (const folder of folders) {
        const uri = vscode.Uri.joinPath(folder.uri, relPath)
        diagCollection.set(uri, diags)
      }
    }

    vscode.window.showInformationMessage(
      `LazyHub: loaded ${comments.length} review comment${comments.length === 1 ? '' : 's'} as diagnostics`
    )
  })
}

async function cmdShowState() {
  const resp = await sendIPC({ type: 'state' })
  if (!resp?.state) {
    vscode.window.showWarningMessage('LazyHub: not running or IPC unavailable')
    return
  }
  const s = resp.state
  const parts = [
    `repo: ${s.repo || '—'}`,
    `pane: ${s.pane || '—'}`,
    `view: ${s.view || '—'}`,
    s.prNumber    ? `PR: #${s.prNumber}`       : null,
    s.issueNumber ? `issue: #${s.issueNumber}` : null,
  ].filter(Boolean)
  vscode.window.showInformationMessage('LazyHub state — ' + parts.join('  |  '))
}

async function cmdBlamePR() {
  const editor = vscode.window.activeTextEditor
  if (!editor) return
  const line = editor.selection.active.line + 1  // 1-based
  const file  = editor.document.uri.fsPath

  const folders = vscode.workspace.workspaceFolders
  const cwd = folders?.[0]?.uri.fsPath

  execFile('git', ['blame', '-L', `${line},${line}`, '--porcelain', file],
    { cwd },
    (err, stdout) => {
      if (err || !stdout) return
      const sha = stdout.split('\n')[0].split(' ')[0]
      if (!sha || /^0+$/.test(sha)) {
        vscode.window.showInformationMessage('LazyHub: uncommitted line, no PR')
        return
      }
      const repo = getRepoSlug()
      if (!repo) return

      execFile('gh', ['pr', 'list', '--search', sha, '--json', 'number', '--jq', '.[0].number'],
        (err2, out) => {
          const prNum = parseInt((out || '').trim(), 10)
          if (!prNum) {
            vscode.window.showInformationMessage(`LazyHub: no PR found for ${sha.slice(0, 8)}`)
            return
          }
          // Tell lazyhub to navigate to this PR, then bring the terminal forward
          sendIPC({ type: 'navigate', prNumber: prNum }).then(() => {
            if (terminal && !terminal.exitStatus) terminal.show()
          })
        }
      )
    }
  )
}

// ─── Status bar ───────────────────────────────────────────────────────────────

async function updateStatusBar(cfg) {
  if (!cfg.get('showStatusBar')) { statusBar.hide(); return }

  const resp = await sendIPC({ type: 'state' })
  if (!resp?.state) {
    statusBar.text = '$(github) lazyhub'
    statusBar.tooltip = 'LazyHub: not running. Run "LazyHub: Open" to start.'
    statusBar.show()
    return
  }

  const { prNumber, pane, view } = resp.state
  if (prNumber) {
    statusBar.text = `$(git-pull-request) PR #${prNumber}`
    statusBar.tooltip = `LazyHub: viewing PR #${prNumber}  |  ${pane}/${view}`
  } else {
    statusBar.text = `$(github) lazyhub · ${pane || '—'}`
    statusBar.tooltip = `LazyHub: pane=${pane} view=${view}`
  }
  statusBar.show()
}

// ─── Extension lifecycle ──────────────────────────────────────────────────────

/**
 * @param {vscode.ExtensionContext} context
 */
function activate(context) {
  const cfg = vscode.workspace.getConfiguration('lazyhub')

  // Diagnostic collection
  diagCollection = vscode.languages.createDiagnosticCollection(DIAG_SOURCE)
  context.subscriptions.push(diagCollection)

  // Status bar
  statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 10)
  statusBar.command = 'lazyhub.open'
  context.subscriptions.push(statusBar)
  updateStatusBar(cfg)

  // Poll IPC for status bar updates every 5 seconds
  const poller = setInterval(() => updateStatusBar(cfg), 5000)
  context.subscriptions.push({ dispose: () => clearInterval(poller) })

  // Commands
  context.subscriptions.push(
    vscode.commands.registerCommand('lazyhub.open',            () => cmdOpen(cfg)),
    vscode.commands.registerCommand('lazyhub.openPR',          () => cmdOpenPR(cfg)),
    vscode.commands.registerCommand('lazyhub.showDiagnostics', () => cmdShowDiagnostics()),
    vscode.commands.registerCommand('lazyhub.showState',       () => cmdShowState()),
    vscode.commands.registerCommand('lazyhub.blamePR',         () => cmdBlamePR()),
  )

  // Auto-load diagnostics when a text file is opened, if configured
  if (cfg.get('autoLoadDiagnostics')) {
    context.subscriptions.push(
      vscode.workspace.onDidOpenTextDocument(() => cmdShowDiagnostics())
    )
  }
}

function deactivate() {
  diagCollection?.clear()
  statusBar?.dispose()
}

module.exports = { activate, deactivate }
