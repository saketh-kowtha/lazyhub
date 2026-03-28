/**
 * bootstrap.test.js — unit tests for bootstrap.js
 * Mocks execa to simulate all four bootstrap paths.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// We mock execa before importing bootstrap functions
vi.mock('execa', () => {
  return {
    execa: vi.fn(),
  }
})

import { execa } from 'execa'
import {
  detectGh,
  checkAuth,
  hasBrowser,
  detectRepo,
  listRepos,
  getLoggedInUser,
  printInstallInstructions,
} from './bootstrap.js'

// ─── detectGh ─────────────────────────────────────────────────────────────────

describe('detectGh', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns true when gh is installed', async () => {
    execa.mockResolvedValue({ exitCode: 0, stdout: 'gh version 2.40.0' })
    const result = await detectGh()
    expect(result).toBe(true)
    expect(execa).toHaveBeenCalledWith('gh', ['--version'])
  })

  it('returns false when gh is not installed', async () => {
    execa.mockRejectedValue(new Error('command not found: gh'))
    const result = await detectGh()
    expect(result).toBe(false)
  })
})

// ─── checkAuth ────────────────────────────────────────────────────────────────

describe('checkAuth', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns true when gh auth status exits 0', async () => {
    execa.mockResolvedValue({ exitCode: 0, stdout: 'Logged in to github.com as user' })
    const result = await checkAuth()
    expect(result).toBe(true)
  })

  it('returns false when gh auth status exits non-zero', async () => {
    execa.mockResolvedValue({ exitCode: 1, stdout: '', stderr: 'You are not logged in' })
    const result = await checkAuth()
    expect(result).toBe(false)
  })

  it('returns false when execa throws', async () => {
    execa.mockRejectedValue(new Error('gh not found'))
    const result = await checkAuth()
    expect(result).toBe(false)
  })
})

// ─── hasBrowser ───────────────────────────────────────────────────────────────

describe('hasBrowser', () => {
  const originalPlatform = process.platform
  const originalEnv = { ...process.env }

  afterEach(() => {
    // Restore env
    delete process.env.DISPLAY
    delete process.env.WAYLAND_DISPLAY
    Object.assign(process.env, originalEnv)
  })

  it('returns true on macOS', () => {
    Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true })
    expect(hasBrowser()).toBe(true)
    Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true })
  })

  it('returns true on Linux with $DISPLAY set', () => {
    Object.defineProperty(process, 'platform', { value: 'linux', configurable: true })
    process.env.DISPLAY = ':0'
    delete process.env.WAYLAND_DISPLAY
    expect(hasBrowser()).toBe(true)
    Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true })
  })

  it('returns true on Linux with $WAYLAND_DISPLAY set', () => {
    Object.defineProperty(process, 'platform', { value: 'linux', configurable: true })
    delete process.env.DISPLAY
    process.env.WAYLAND_DISPLAY = 'wayland-0'
    expect(hasBrowser()).toBe(true)
    Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true })
  })

  it('returns false on Linux with no display env vars', () => {
    Object.defineProperty(process, 'platform', { value: 'linux', configurable: true })
    delete process.env.DISPLAY
    delete process.env.WAYLAND_DISPLAY
    expect(hasBrowser()).toBe(false)
    Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true })
  })
})

// ─── detectRepo ───────────────────────────────────────────────────────────────

describe('detectRepo', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns OWNER/REPO string when inside a git repo', async () => {
    execa.mockResolvedValue({
      exitCode: 0,
      stdout: JSON.stringify({
        name: 'my-repo',
        owner: { login: 'myuser' },
        defaultBranchRef: { name: 'main' },
      }),
    })
    const result = await detectRepo()
    expect(result).toBe('myuser/my-repo')
  })

  it('returns null when gh repo view fails (not in a git repo)', async () => {
    execa.mockResolvedValue({ exitCode: 128, stdout: '', stderr: 'not a git repository' })
    const result = await detectRepo()
    expect(result).toBeNull()
  })

  it('returns null when execa throws', async () => {
    execa.mockRejectedValue(new Error('command failed'))
    const result = await detectRepo()
    expect(result).toBeNull()
  })

  it('returns null when stdout is empty', async () => {
    execa.mockResolvedValue({ exitCode: 0, stdout: '' })
    const result = await detectRepo()
    expect(result).toBeNull()
  })
})

// ─── listRepos ────────────────────────────────────────────────────────────────

describe('listRepos', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns array of repos on success', async () => {
    const repos = [
      { name: 'repo1', nameWithOwner: 'user/repo1' },
      { name: 'repo2', nameWithOwner: 'user/repo2' },
    ]
    execa.mockResolvedValue({ exitCode: 0, stdout: JSON.stringify(repos) })
    const result = await listRepos()
    expect(result).toEqual(repos)
  })

  it('returns empty array on failure', async () => {
    execa.mockRejectedValue(new Error('gh failed'))
    const result = await listRepos()
    expect(result).toEqual([])
  })
})

// ─── getLoggedInUser ──────────────────────────────────────────────────────────

describe('getLoggedInUser', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns username on success', async () => {
    execa.mockResolvedValue({ exitCode: 0, stdout: 'testuser\n' })
    const result = await getLoggedInUser()
    expect(result).toBe('testuser')
  })

  it('returns null on failure', async () => {
    execa.mockRejectedValue(new Error('api error'))
    const result = await getLoggedInUser()
    expect(result).toBeNull()
  })
})

// ─── printInstallInstructions ─────────────────────────────────────────────────

describe('printInstallInstructions', () => {
  it('prints brew instructions on darwin', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    printInstallInstructions('darwin')
    const output = spy.mock.calls.map(c => c.join(' ')).join('\n')
    expect(output).toContain('brew install gh')
    spy.mockRestore()
  })

  it('prints apt/dnf instructions on linux', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    printInstallInstructions('linux')
    const output = spy.mock.calls.map(c => c.join(' ')).join('\n')
    expect(output).toContain('apt')
    expect(output).toContain('dnf')
    spy.mockRestore()
  })

  it('prints winget/scoop instructions on win32', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    printInstallInstructions('win32')
    const output = spy.mock.calls.map(c => c.join(' ')).join('\n')
    expect(output).toContain('winget')
    expect(output).toContain('scoop')
    spy.mockRestore()
  })

  it('prints cli.github.com for unknown platforms', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    printInstallInstructions('freebsd')
    const output = spy.mock.calls.map(c => c.join(' ')).join('\n')
    expect(output).toContain('https://cli.github.com')
    spy.mockRestore()
  })
})

// ─── bootstrap() integration paths ───────────────────────────────────────────

describe('bootstrap() integration', () => {
  let originalExit
  let originalGhuiRepo
  let originalGithubToken

  beforeEach(() => {
    vi.clearAllMocks()
    originalExit = process.exit
    process.exit = vi.fn()
    originalGhuiRepo = process.env.GHUI_REPO
    originalGithubToken = process.env.GITHUB_TOKEN
    delete process.env.GITHUB_TOKEN
  })

  afterEach(() => {
    process.exit = originalExit
    if (originalGhuiRepo === undefined) {
      delete process.env.GHUI_REPO
    } else {
      process.env.GHUI_REPO = originalGhuiRepo
    }
    if (originalGithubToken === undefined) {
      delete process.env.GITHUB_TOKEN
    } else {
      process.env.GITHUB_TOKEN = originalGithubToken
    }
  })

  it('path A: calls process.exit(1) when gh is not installed', async () => {
    // First call (detectGh: gh --version) fails → gh not installed
    // Subsequent calls just resolve to avoid hanging
    execa
      .mockRejectedValueOnce(new Error('command not found: gh')) // detectGh
      .mockResolvedValue({ exitCode: 0, stdout: '', stderr: '' })  // fallback for any subsequent calls

    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const outSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => {})
    const { bootstrap } = await import('./bootstrap.js')
    await bootstrap()

    expect(process.exit).toHaveBeenCalledWith(1)
    errSpy.mockRestore()
    outSpy.mockRestore()
  })

  it('path D: calls renderApp when all checks pass', async () => {
    const { bootstrap } = await import('./bootstrap.js')

    // execa calls in order:
    // 1. detectGh: gh --version → success
    // 2. checkAuth: gh auth status → success (exitCode 0)
    // 3. detectRepo: git remote get-url origin → github URL
    execa
      .mockResolvedValueOnce({ exitCode: 0, stdout: 'gh version 2.0.0' })          // detectGh
      .mockResolvedValueOnce({ exitCode: 0, stdout: 'Logged in' })                  // checkAuth
      .mockResolvedValueOnce({                                                       // detectRepo: git remote
        exitCode: 0,
        stdout: 'https://github.com/me/my-repo.git',
      })

    const renderApp = vi.fn()
    await bootstrap(renderApp)

    expect(renderApp).toHaveBeenCalledOnce()
    expect(process.env.GHUI_REPO).toBe('me/my-repo')
  })
})
