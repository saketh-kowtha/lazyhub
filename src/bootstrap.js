/**
 * bootstrap.js — runs BEFORE any Ink UI is rendered.
 * Steps:
 *   1. Detect gh CLI
 *   2. Detect gh auth status
 *   3. Detect repo context
 *   4. Hand off to renderApp()
 */

import { execa } from 'execa'
import { loadSavedRepo, saveDefaultRepo, writeDefaultConfig } from './config.js'
import { runGh } from './executor/core.js'
import readline from 'readline'

// ─── Step 1: detect gh ────────────────────────────────────────────────────────

/**
 *
 */
export async function detectGh() {
  try {
    await runGh(['--version'], { json: false })
    return true
  } catch {
    return false
  }
}

/**
 *
 * @param platform
 */
export function printInstallInstructions(platform) {
  console.error('\n  ✗ gh (GitHub CLI) is not installed.\n')

  if (platform === 'darwin') {
    console.error('  Install it with Homebrew:')
    console.error('    brew install gh\n')
  } else if (platform === 'linux') {
    console.error('  Install on Ubuntu/Debian:')
    console.error('    curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \\')
    console.error('      | sudo dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg')
    console.error('    echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \\')
    console.error('      | sudo tee /etc/apt/sources.list.d/github-cli.list > /dev/null')
    console.error('    sudo apt update && sudo apt install gh')
    console.error('')
    console.error('  Install on Fedora/RHEL:')
    console.error('    sudo dnf install gh\n')
  } else if (platform === 'win32') {
    console.error('  Install on Windows (choose one):')
    console.error('    winget install --id GitHub.cli')
    console.error('    scoop install gh\n')
  } else {
    console.error('  Install instructions: https://cli.github.com\n')
  }
}

// ─── Step 2: detect auth ──────────────────────────────────────────────────────

/**
 * Split a git remote URL into { host, path, ssh }. Handles https (optional
 * user and port), `ssh://[user@]host[:port]/path`, and scp-like
 * `[user@]host:path`. Ports are dropped: they belong to the git transport, not
 * to the API host gh authenticates against. Returns null for other forms.
 *
 * @param {string} url
 * @returns {{host: string, path: string, ssh: boolean}|null}
 */
export function parseRemoteUrl(url) {
  let m = url.match(/^https?:\/\/(?:[^@/]+@)?([^/:]+)(?::\d+)?\/(.+)$/i)
  if (m) return { host: m[1], path: m[2], ssh: false }
  m = url.match(/^ssh:\/\/(?:[^@/]+@)?([^/:]+)(?::\d+)?\/(.+)$/i)
  if (m) return { host: m[1], path: m[2], ssh: true }
  m = url.match(/^(?:[^@/\s]+@)?([^/:\s]+):(?!\/\/)(.+)$/)
  if (m) return { host: m[1], path: m[2], ssh: true }
  return null
}

/**
 * Resolve an SSH host (possibly a ~/.ssh/config alias) to the real hostname
 * with `ssh -G`. Returns null when ssh is missing or yields no hostname.
 *
 * @param {string} alias
 */
async function resolveSshHostname(alias) {
  try {
    const result = await execa('ssh', ['-G', alias], { reject: false, timeout: 3000 })
    const m = (result.stdout || '').match(/^hostname\s+(\S+)/m)
    return m ? m[1] : null
  } catch {
    return null
  }
}

/**
 * The host named by `origin`, with SSH aliases resolved. `resolved` is false
 * when an SSH host could not be resolved and may be an alias, not a real host.
 *
 * @returns {Promise<{host: string, resolved: boolean}|null>}
 */
async function resolveRemoteHost() {
  try {
    const result = await execa('git', ['remote', 'get-url', 'origin'], { reject: false })
    if (result.exitCode !== 0) return null
    const parsed = parseRemoteUrl(result.stdout.trim())
    if (!parsed) return null
    if (!parsed.ssh) return { host: parsed.host, resolved: true }
    const real = await resolveSshHostname(parsed.host)
    // GitHub's SSH-over-443 endpoint is not an API host.
    const host = (real || parsed.host).replace(/^ssh\.github\.com$/i, 'github.com')
    return { host, resolved: !!real }
  } catch {
    return null
  }
}

/**
 * The hostname of the `origin` remote (SSH aliases resolved), or null when not
 * in a git repo, no origin is set, or the URL can't be parsed.
 */
export async function detectHostFromRemote() {
  return (await resolveRemoteHost())?.host ?? null
}

/**
 * Check that the user is authenticated with `gh` for the target hostname
 * (GH_HOST if set, otherwise github.com).
 *
 * Uses `gh auth token` rather than `gh auth status`: the former exits 0 iff
 * there is a valid token for the host, while `gh auth status` can exit
 * non-zero when a secondary host has issues — falsely marking GHE users as
 * unauthenticated when they're perfectly logged in.
 */
export async function checkAuth() {
  const args = process.env.GH_HOST
    ? ['auth', 'token', '--hostname', process.env.GH_HOST]
    : ['auth', 'token']
  try {
    // runGh throws on non-zero exit and returns null on empty output.
    return !!(await runGh(args, { json: false }))
  } catch {
    return false
  }
}

/**
 * Parse `gh auth status` output to find any host the user is logged into.
 * Prefers a host marked as the active account; otherwise returns the first
 * logged-in host found. Returns null if nothing is logged in.
 *
 * Why: `gh auth token` without `--hostname` only checks github.com. When a
 * user is GHE-only logged in and runs lazyhub outside a git repo (so the
 * remote-based GH_HOST auto-detect can't fire), the default check misses
 * their existing login and prompts a bogus re-login.
 */
export async function listAuthenticatedHosts() {
  try {
    // gh reports on stderr (and exits non-zero when any host has issues); combine
    // keeps both, and a GhError still carries the output in .stderr.
    let text
    try {
      text = await runGh(['auth', 'status'], { json: false, combine: true })
    } catch (err) {
      text = err.stderr
    }
    const hosts = []
    let active = null
    for (const block of (text || '').split(/\n\s*\n/)) {
      const loginMatch = block.match(/Logged in to (\S+)/)
      if (!loginMatch) continue
      hosts.push(loginMatch[1])
      if (!active && /Active account:\s*true/.test(block)) active = loginMatch[1]
    }
    return { hosts, active: active || hosts[0] || null }
  } catch {
    return { hosts: [], active: null }
  }
}

/**
 * The active (else first) logged-in host, or null.
 */
export async function detectAuthenticatedHost() {
  return (await listAuthenticatedHosts()).active
}

/**
 * Choose the GH_HOST for this run from the git remote and gh's logins. The
 * remote's host is only used when gh is logged in to it; an SSH alias or a
 * separate SSH hostname must never become GH_HOST on its own.
 *
 * @returns {Promise<{host: string|null, note?: string, error?: string}>}
 */
export async function selectGhHost() {
  const remote = await resolveRemoteHost()
  if (!remote || remote.host.toLowerCase() === 'github.com') return { host: null }
  const { hosts } = await listAuthenticatedHosts()
  if (hosts.some(h => h.toLowerCase() === remote.host.toLowerCase())) return { host: remote.host }
  const others = hosts.filter(h => h.toLowerCase() !== 'github.com')
  if (others.length === 1) {
    return { host: others[0], note: `Remote host ${remote.host} is not a gh login; using ${others[0]}.` }
  }
  // Nothing logged in and the host is a real one: let the login flow offer it.
  if (hosts.length === 0 && remote.resolved) return { host: remote.host }
  return {
    host: null,
    error: [
      `  ✗ The git remote points at ${remote.host}, but gh is not logged in to it.`,
      `    gh is logged in to: ${hosts.length ? hosts.join(', ') : '(nothing)'}`,
      `    If ${remote.host} is your GitHub Enterprise host, run: gh auth login --hostname ${remote.host}`,
      '    If it is an SSH alias or a different SSH hostname, set the API host: export GH_HOST=<host>',
    ].join('\n'),
  }
}

/**
 *
 */
export function hasBrowser() {
  if (process.platform === 'darwin') return true
  if (process.platform === 'win32') return true
  if (process.env.DISPLAY || process.env.WAYLAND_DISPLAY) return true
  return false
}

/**
 *
 * @param rl
 */
async function readPATFromStdin(rl) {
  return new Promise((resolve) => {
    if (!rl) {
      rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
      })
    }
    process.stdout.write('  Paste a GitHub PAT with repo + read:org scopes: ')
    // Suppress echoing
    const orig = rl.output
    rl.output = { write: () => {} }
    rl.question('', (answer) => {
      rl.output = orig
      rl.close()
      process.stdout.write('\n')
      resolve(answer.trim())
    })
  })
}

/**
 *
 */
export async function getLoggedInUser() {
  try {
    return await runGh(['api', 'user', '--jq', '.login'], { json: false })
  } catch {
    return null
  }
}

/**
 *
 */
async function runLoginFlow() {
  const ghHost = process.env.GH_HOST
  process.stdout.write('  lazyhub needs GitHub access. Starting login...\n')

  if (process.env.GITHUB_TOKEN) {
    try {
      const loginArgs = ghHost
        ? ['auth', 'login', '--hostname', ghHost, '--with-token']
        : ['auth', 'login', '--with-token']
      // The token travels on stdin only: never argv, env, or the gh call history.
      await runGh(loginArgs, { json: false, stdin: process.env.GITHUB_TOKEN })
      return
    } catch {
      // fall through
    }
  }

  const loginArgs = ['auth', 'login']
  if (ghHost) loginArgs.push('--hostname', ghHost)
  if (hasBrowser()) {
    // Interactive: gh owns the terminal and waits on the user, so no timeout.
    await runGh([...loginArgs, '--web', '--git-protocol', 'https'], { interactive: true, timeout: 0 })
      .catch(() => {}) // checkAuth() after the flow reports the outcome
  } else {
    const pat = await readPATFromStdin()
    if (pat) {
      const withTokenArgs = ghHost
        ? ['auth', 'login', '--hostname', ghHost, '--with-token']
        : ['auth', 'login', '--with-token']
      await runGh(withTokenArgs, { json: false, stdin: pat }).catch(() => {})
    }
  }
}

// ─── Step 3: detect repo context ─────────────────────────────────────────────

/**
 *
 */
export async function detectRepo() {
  // 1. Parse git remote origin URL — fast, no network needed. Host-agnostic:
  // an SSH alias or separate SSH hostname never matches GH_HOST literally.
  try {
    const result = await execa('git', ['remote', 'get-url', 'origin'], { reject: false })
    if (result.exitCode === 0) {
      const parsed = parseRemoteUrl(result.stdout.trim())
      const match = parsed?.path.match(/^([^/\s]+\/[^/\s]+?)(?:\.git)?\/?$/)
      if (match) return match[1]
    }
  } catch { /* not in a git repo */ }

  // 2. Let gh resolve it from the git context
  const viewArgs = ['repo', 'view', '--json', 'name,owner']
  try {
    const data = await runGh(viewArgs)
    if (data?.owner?.login && data.name) return `${data.owner.login}/${data.name}`
  } catch { /* gh can't figure it out */ }

  return null
}

/**
 *
 */
export async function listRepos() {
  try {
    const repos = await runGh([
      'repo', 'list',
      '--limit', '20',
      '--json', 'name,nameWithOwner',
    ])
    return Array.isArray(repos) ? repos : []
  } catch {
    return []
  }
}

/**
 *
 * @param repos
 */
async function pickRepoInteractive(repos) {
  return new Promise((resolve) => {
    if (repos.length === 0) {
      console.error('  No repositories found.')
      resolve(null)
      return
    }

    let selected = 0

    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true)
    }
    process.stdin.resume()
    process.stdin.setEncoding('utf8')

    const render = () => {
      process.stdout.write('\x1b[2J\x1b[H')
      process.stdout.write('  Select a repository (j/k or ↑↓ to move, Enter to select):\n\n')
      repos.forEach((repo, i) => {
        const prefix = i === selected ? '  ▶ ' : '    '
        process.stdout.write(`${prefix}${repo.nameWithOwner}\n`)
      })
    }

    render()

    const onKeypress = (key) => {
      if (key === '\x1b[A' || key === 'k') {
        selected = Math.max(0, selected - 1)
        render()
      } else if (key === '\x1b[B' || key === 'j') {
        selected = Math.min(repos.length - 1, selected + 1)
        render()
      } else if (key === '\r' || key === '\n') {
        process.stdin.removeListener('data', onKeypress)
        if (process.stdin.isTTY) {
          process.stdin.setRawMode(false)
        }
        process.stdin.pause()
        process.stdout.write('\x1b[2J\x1b[H')
        resolve(repos[selected].nameWithOwner)
      } else if (key === '\x03') {
        process.exit(0)
      }
    }

    process.stdin.on('data', onKeypress)
  })
}

// ─── Main bootstrap() ─────────────────────────────────────────────────────────

/**
 *
 * @param renderApp
 * @param {object} [root0]
 * @param {string} [root0.repo] repository chosen in the first-run flow
 */
export async function bootstrap(renderApp, { repo: chosenRepo } = /** @type {{repo?: string}} */ ({})) {
  // Write default config on first run
  writeDefaultConfig()
  // Reached with a chosenRepo only when first-run onboarding completed (cancel exits earlier).
  if (chosenRepo) saveDefaultRepo(chosenRepo)

  // Step 1 — detect gh
  const ghInstalled = await detectGh()
  if (!ghInstalled) {
    printInstallInstructions(process.platform)
    process.exit(1)
  }

  // Pick the GHE host from the git remote, but only if gh is logged in to it
  // (SSH aliases and ssh-only hostnames are not API hosts). An explicit
  // GH_HOST always wins.
  if (!process.env.GH_HOST) {
    const sel = await selectGhHost()
    if (sel.error) {
      console.error(`\n${sel.error}\n`)
      process.exit(1)
    }
    if (sel.host) {
      process.env.GH_HOST = sel.host
      if (sel.note) process.stdout.write(`  ${sel.note}\n`)
    }
  }

  // Step 2 — detect auth
  let isLoggedIn = await checkAuth()
  if (!isLoggedIn && !process.env.GH_HOST) {
    // Covers the GHE-only-login-outside-a-git-repo case where checkAuth
    // defaulted to github.com and missed the user's actual login.
    const authedHost = await detectAuthenticatedHost()
    if (authedHost) {
      process.env.GH_HOST = authedHost
      isLoggedIn = await checkAuth()
    }
  }
  if (!isLoggedIn) {
    const host = process.env.GH_HOST || 'github.com'
    process.stdout.write(`  Not authenticated with ${host}.\n`)
    await runLoginFlow()

    const stillLoggedIn = await checkAuth()
    if (!stillLoggedIn) {
      console.error(`\n  ✗ GitHub authentication failed for ${host}.`)
      console.error(`    Please run: gh auth login${process.env.GH_HOST ? ` --hostname ${process.env.GH_HOST}` : ''}\n`)
      process.exit(1)
    }

    const username = await getLoggedInUser()
    if (username) {
      process.stdout.write(`  ✓ Logged in as ${username}\n`)
    }
  }

  // Step 3 — detect repo context
  // Precedence: repo picked this launch in onboarding > repo detected from the
  // current directory > repo saved by onboarding ([defaults].repo) > interactive picker.
  let repo = chosenRepo || await detectRepo() || loadSavedRepo()
  if (!repo) {
    const repos = await listRepos()
    repo = await pickRepoInteractive(repos)
    if (!repo) {
      console.error('\n  ✗ No repository selected. Exiting.\n')
      process.exit(1)
    }
  }
  process.env.GHUI_REPO = repo

  // Step 4 — hand off to Ink
  if (typeof renderApp === 'function') {
    renderApp()
  }
}
