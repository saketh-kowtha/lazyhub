/**
 * bootstrap.js — runs BEFORE any Ink UI is rendered.
 * Steps:
 *   1. Detect gh CLI
 *   2. Detect gh auth status
 *   3. Detect repo context
 *   4. Hand off to renderApp()
 */

import { execa } from 'execa'
import { writeDefaultConfig } from './config.js'
import readline from 'readline'

// ─── Step 1: detect gh ────────────────────────────────────────────────────────

/**
 *
 */
export async function detectGh() {
  try {
    await execa('gh', ['--version'])
    return true
  } catch {
    return false
  }
}

/**
 *
 */
export async function getArch() {
  try {
    const { stdout } = await execa('uname', ['-m'])
    return stdout.trim()
  } catch {
    return process.arch
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
 *
 */
export async function checkAuth() {
  try {
    const result = await execa('gh', ['auth', 'status'], { reject: false })
    return result.exitCode === 0
  } catch {
    return false
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
export async function readPATFromStdin(rl) {
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
    const { stdout } = await execa('gh', ['api', 'user', '--jq', '.login'])
    return stdout.trim()
  } catch {
    return null
  }
}

/**
 *
 */
export async function runLoginFlow() {
  process.stdout.write('  lazyhub needs GitHub access. Starting login...\n')

  if (process.env.GITHUB_TOKEN) {
    try {
      const proc = execa('gh', ['auth', 'login', '--with-token'], { reject: false })
      proc.stdin.write(process.env.GITHUB_TOKEN)
      proc.stdin.end()
      await proc
      return
    } catch {
      // fall through
    }
  }

  if (hasBrowser()) {
    await execa('gh', ['auth', 'login', '--web', '--git-protocol', 'https'], {
      stdio: 'inherit',
      reject: false,
    })
  } else {
    const pat = await readPATFromStdin()
    if (pat) {
      const proc = execa('gh', ['auth', 'login', '--with-token'], { reject: false })
      proc.stdin.write(pat)
      proc.stdin.end()
      await proc
    }
  }
}

// ─── Step 3: detect repo context ─────────────────────────────────────────────

/**
 *
 */
export async function detectRepo() {
  // 1. Parse git remote origin URL — fast, no network needed
  try {
    const result = await execa('git', ['remote', 'get-url', 'origin'], { reject: false })
    if (result.exitCode === 0) {
      const url = result.stdout.trim()
      // Handles HTTPS (github.com/owner/repo) and SSH (git@github.com:owner/repo)
      const match = url.match(/github\.com[/:]([^/\s]+\/[^/\s.]+?)(?:\.git)?$/)
      if (match) return match[1]
    }
  } catch { /* not in a git repo */ }

  // 2. Let gh resolve it from the git context
  try {
    const result = await execa('gh', ['repo', 'view', '--json', 'name,owner'], { reject: false })
    if (result.exitCode === 0 && result.stdout) {
      const data = JSON.parse(result.stdout)
      return `${data.owner.login}/${data.name}`
    }
  } catch { /* gh can't figure it out */ }

  return null
}

/**
 *
 */
export async function listRepos() {
  try {
    const { stdout } = await execa('gh', [
      'repo', 'list',
      '--limit', '20',
      '--json', 'name,nameWithOwner',
    ])
    return JSON.parse(stdout)
  } catch {
    return []
  }
}

/**
 *
 * @param repos
 */
export async function pickRepoInteractive(repos) {
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
 */
export async function bootstrap(renderApp) {
  // Write default config on first run
  writeDefaultConfig()

  // Step 1 — detect gh
  const ghInstalled = await detectGh()
  if (!ghInstalled) {
    printInstallInstructions(process.platform)
    process.exit(1)
  }

  // Step 2 — detect auth
  const isLoggedIn = await checkAuth()
  if (!isLoggedIn) {
    await runLoginFlow()

    const stillLoggedIn = await checkAuth()
    if (!stillLoggedIn) {
      console.error('\n  ✗ GitHub authentication failed. Please run: gh auth login\n')
      process.exit(1)
    }

    const username = await getLoggedInUser()
    if (username) {
      process.stdout.write(`  ✓ Logged in as ${username}\n`)
    }
  }

  // Step 3 — detect repo context
  let repo = await detectRepo()
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
