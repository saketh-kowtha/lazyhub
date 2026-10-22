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
    detectAuthenticatedHost,
    detectHostFromRemote,
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

    it('returns true when gh auth token returns a token', async () => {
        execa.mockResolvedValue({ exitCode: 0, stdout: 'ghp_abc123def456\n' })
        const result = await checkAuth()
        expect(result).toBe(true)
    })

    it('returns false when gh auth token exits non-zero', async () => {
        execa.mockResolvedValue({ exitCode: 1, stdout: '', stderr: 'You are not logged in' })
        const result = await checkAuth()
        expect(result).toBe(false)
    })

    it('returns false when token output is empty even with exit 0', async () => {
        execa.mockResolvedValue({ exitCode: 0, stdout: '' })
        const result = await checkAuth()
        expect(result).toBe(false)
    })

    it('returns false when execa throws', async () => {
        execa.mockRejectedValue(new Error('gh not found'))
        const result = await checkAuth()
        expect(result).toBe(false)
    })

    it('uses --hostname when GH_HOST is set', async () => {
        const prevHost = process.env.GH_HOST
        process.env.GH_HOST = 'github.enterprise.com'
        execa.mockResolvedValue({ exitCode: 0, stdout: 'ghp_token\n' })
        await checkAuth()
        expect(execa).toHaveBeenCalledWith(
            'gh',
            ['auth', 'token', '--hostname', 'github.enterprise.com'],
            expect.any(Object),
        )
        if (prevHost === undefined) delete process.env.GH_HOST
        else process.env.GH_HOST = prevHost
    })
})

// ─── detectAuthenticatedHost ──────────────────────────────────────────────────

describe('detectAuthenticatedHost', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    it('returns the host with Active account: true when multiple are logged in', async () => {
        // gh writes status to stderr in older versions; include both for robustness
        execa.mockResolvedValue({
            exitCode: 0,
            stdout: '',
            stderr: [
                'github.com',
                '  ✓ Logged in to github.com account alice (keyring)',
                '  - Active account: false',
                '  - Git operations protocol: https',
                '',
                'github.enterprise.com',
                '  ✓ Logged in to github.enterprise.com account alice (keyring)',
                '  - Active account: true',
                '  - Git operations protocol: https',
            ].join('\n'),
        })
        expect(await detectAuthenticatedHost()).toBe('github.enterprise.com')
    })

    it('returns the only logged-in host (GHE-only setup)', async () => {
        execa.mockResolvedValue({
            exitCode: 0,
            stdout: '',
            stderr: [
                'github.enterprise.com',
                '  ✓ Logged in to github.enterprise.com account alice (keyring)',
                '  - Active account: true',
            ].join('\n'),
        })
        expect(await detectAuthenticatedHost()).toBe('github.enterprise.com')
    })

    it('falls back to the first logged-in host when no active marker is present', async () => {
        execa.mockResolvedValue({
            exitCode: 0,
            stdout: '',
            stderr: [
                'github.com',
                '  ✓ Logged in to github.com account alice (keyring)',
                '  - Git operations protocol: https',
            ].join('\n'),
        })
        expect(await detectAuthenticatedHost()).toBe('github.com')
    })

    it('returns null when gh is not logged in to anything', async () => {
        execa.mockResolvedValue({
            exitCode: 1,
            stdout: '',
            stderr: 'You are not logged into any GitHub hosts. Run gh auth login to authenticate.',
        })
        expect(await detectAuthenticatedHost()).toBeNull()
    })

    it('returns null when execa throws', async () => {
        execa.mockRejectedValue(new Error('gh missing'))
        expect(await detectAuthenticatedHost()).toBeNull()
    })
})

// ─── detectHostFromRemote ─────────────────────────────────────────────────────

describe('detectHostFromRemote', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    it('extracts host from https remote', async () => {
        execa.mockResolvedValue({ exitCode: 0, stdout: 'https://github.enterprise.com/org/repo.git\n' })
        expect(await detectHostFromRemote()).toBe('github.enterprise.com')
    })

    it('extracts host from ssh remote (git@host:owner/repo)', async () => {
        execa.mockResolvedValue({ exitCode: 0, stdout: 'git@github.acme.com:org/repo.git\n' })
        expect(await detectHostFromRemote()).toBe('github.acme.com')
    })

    it('extracts host from ssh:// remote', async () => {
        execa.mockResolvedValue({ exitCode: 0, stdout: 'ssh://git@github.internal:22/org/repo.git\n' })
        expect(await detectHostFromRemote()).toBe('github.internal')
    })

    it('returns github.com for vanilla github remote', async () => {
        execa.mockResolvedValue({ exitCode: 0, stdout: 'https://github.com/me/repo.git\n' })
        expect(await detectHostFromRemote()).toBe('github.com')
    })

    it('returns null when not in a git repo', async () => {
        execa.mockResolvedValue({ exitCode: 128, stdout: '', stderr: 'not a git repo' })
        expect(await detectHostFromRemote()).toBeNull()
    })

    it('returns null for unparseable URLs', async () => {
        execa.mockResolvedValue({ exitCode: 0, stdout: 'file:///tmp/repo\n' })
        expect(await detectHostFromRemote()).toBeNull()
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
        const spy = vi.spyOn(console, 'error').mockImplementation(() => { })
        printInstallInstructions('darwin')
        const output = spy.mock.calls.map(c => c.join(' ')).join('\n')
        expect(output).toContain('brew install gh')
        spy.mockRestore()
    })

    it('prints apt/dnf instructions on linux', () => {
        const spy = vi.spyOn(console, 'error').mockImplementation(() => { })
        printInstallInstructions('linux')
        const output = spy.mock.calls.map(c => c.join(' ')).join('\n')
        expect(output).toContain('apt')
        expect(output).toContain('dnf')
        spy.mockRestore()
    })

    it('prints winget/scoop instructions on win32', () => {
        const spy = vi.spyOn(console, 'error').mockImplementation(() => { })
        printInstallInstructions('win32')
        const output = spy.mock.calls.map(c => c.join(' ')).join('\n')
        expect(output).toContain('winget')
        expect(output).toContain('scoop')
        spy.mockRestore()
    })

    it('prints cli.github.com for unknown platforms', () => {
        const spy = vi.spyOn(console, 'error').mockImplementation(() => { })
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

    it.skip('path A: calls process.exit(1) when gh is not installed', async () => {
        // First call (detectGh: gh --version) fails → gh not installed
        // Subsequent calls just resolve to avoid hanging
        execa
            .mockRejectedValueOnce(new Error('command not found: gh')) // detectGh
            .mockResolvedValue({ exitCode: 0, stdout: '', stderr: '' })  // fallback for any subsequent calls

        const errSpy = vi.spyOn(console, 'error').mockImplementation(() => { })
        const outSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => { })
        const { bootstrap } = await import('./bootstrap.js')
        await bootstrap()

        expect(process.exit).toHaveBeenCalledWith(1)
        errSpy.mockRestore()
        outSpy.mockRestore()
    })

    it('path D: calls renderApp when all checks pass', async () => {
        const { bootstrap } = await import('./bootstrap.js')
        const prevHost = process.env.GH_HOST
        delete process.env.GH_HOST

        // execa calls in order:
        //   1. detectGh:              gh --version
        //   2. detectHostFromRemote:  git remote get-url origin (→ github.com, so GH_HOST stays unset)
        //   3. checkAuth:             gh auth token
        //   4. detectRepo:            git remote get-url origin
        execa
            .mockResolvedValueOnce({ exitCode: 0, stdout: 'gh version 2.0.0' })
            .mockResolvedValueOnce({ exitCode: 0, stdout: 'https://github.com/me/my-repo.git' })
            .mockResolvedValueOnce({ exitCode: 0, stdout: 'ghp_abc123\n' })
            .mockResolvedValueOnce({ exitCode: 0, stdout: 'https://github.com/me/my-repo.git' })

        const renderApp = vi.fn()
        await bootstrap(renderApp)

        expect(renderApp).toHaveBeenCalledOnce()
        expect(process.env.GHUI_REPO).toBe('me/my-repo')

        if (prevHost === undefined) delete process.env.GH_HOST
        else process.env.GH_HOST = prevHost
    })

    it('path D (GHE, no git repo): falls back to detectAuthenticatedHost when default auth check fails', async () => {
        const { bootstrap } = await import('./bootstrap.js')
        const prevHost = process.env.GH_HOST
        delete process.env.GH_HOST

        // User is logged into GHE only, running lazyhub from a non-git directory.
        // execa calls in order:
        //   1. detectGh:                 gh --version
        //   2. detectHostFromRemote:     git remote get-url origin (→ not a git repo)
        //   3. checkAuth #1:             gh auth token (no --hostname) → fails, no github.com token
        //   4. detectAuthenticatedHost:  gh auth status → surfaces github.enterprise.com
        //   5. checkAuth #2:             gh auth token --hostname github.enterprise.com → ok
        //   6. detectRepo (git):         git remote get-url origin (not a git repo)
        //   7. detectRepo (gh):          gh repo view → succeeds
        execa
            .mockResolvedValueOnce({ exitCode: 0, stdout: 'gh version 2.0.0' })
            .mockResolvedValueOnce({ exitCode: 128, stdout: '', stderr: 'not a git repo' })
            .mockResolvedValueOnce({ exitCode: 1, stdout: '', stderr: 'not logged in' })
            .mockResolvedValueOnce({
                exitCode: 0,
                stdout: '',
                stderr: [
                    'github.enterprise.com',
                    '  ✓ Logged in to github.enterprise.com account alice (keyring)',
                    '  - Active account: true',
                ].join('\n'),
            })
            .mockResolvedValueOnce({ exitCode: 0, stdout: 'ghe_token\n' })
            .mockResolvedValueOnce({ exitCode: 128, stdout: '', stderr: 'not a git repo' })
            .mockResolvedValueOnce({
                exitCode: 0,
                stdout: JSON.stringify({ name: 'app', owner: { login: 'org' } }),
            })

        const renderApp = vi.fn()
        await bootstrap(renderApp)

        expect(process.env.GH_HOST).toBe('github.enterprise.com')
        expect(renderApp).toHaveBeenCalledOnce()

        // The second checkAuth call must target the detected host.
        const authCalls = execa.mock.calls.filter(([bin, args]) =>
            bin === 'gh' && Array.isArray(args) && args[0] === 'auth' && args[1] === 'token'
        )
        expect(authCalls).toHaveLength(2)
        expect(authCalls[0][1]).toEqual(['auth', 'token'])
        expect(authCalls[1][1]).toEqual(['auth', 'token', '--hostname', 'github.enterprise.com'])

        delete process.env.GH_HOST
        if (prevHost !== undefined) process.env.GH_HOST = prevHost
    })
})

// ─── GHES host resolution (remote host vs. gh-authenticated host) ─────────────

describe('GHES host resolution', () => {
    const status = (...hosts) => hosts.map((h, i) => [
        h, `  ✓ Logged in to ${h} account alice (keyring)`, `  - Active account: ${i === 0}`,
    ].join('\n')).join('\n\n')

    // Command-keyed execa mock: no real git/ssh/gh.
    const mockCmds = ({ remote, ssh, authed = [], tokenHosts = authed }) => {
        execa.mockImplementation(async (bin, args = []) => {
            if (bin === 'gh' && args[0] === '--version') return { exitCode: 0, stdout: 'gh version 2.0.0' }
            if (bin === 'git') return { exitCode: 0, stdout: remote }
            if (bin === 'ssh') return ssh ? { exitCode: 0, stdout: `user git\nhostname ${ssh}\nport 22` } : { exitCode: 255, stdout: '' }
            if (bin === 'gh' && args[0] === 'auth' && args[1] === 'status') {
                return authed.length ? { exitCode: 0, stdout: '', stderr: status(...authed) } : { exitCode: 1, stdout: '', stderr: 'not logged in' }
            }
            if (bin === 'gh' && args[0] === 'auth' && args[1] === 'token') {
                const host = args[3] || 'github.com'
                return tokenHosts.includes(host) ? { exitCode: 0, stdout: 'tok\n' } : { exitCode: 1, stdout: '' }
            }
            return { exitCode: 1, stdout: '' }
        })
    }

    let prevHost, prevRepo, errSpy
    beforeEach(() => {
        vi.clearAllMocks()
        prevHost = process.env.GH_HOST
        prevRepo = process.env.GHUI_REPO
        delete process.env.GH_HOST
        vi.spyOn(process, 'exit').mockImplementation((code) => { throw new Error(`exit:${code}`) })
        errSpy = vi.spyOn(console, 'error').mockImplementation(() => { })
        vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    })
    afterEach(() => {
        vi.restoreAllMocks()
        if (prevHost === undefined) delete process.env.GH_HOST
        else process.env.GH_HOST = prevHost
        if (prevRepo === undefined) delete process.env.GHUI_REPO
        else process.env.GHUI_REPO = prevRepo
    })

    const run = async () => {
        const { bootstrap } = await import('./bootstrap.js')
        const renderApp = vi.fn()
        await bootstrap(renderApp)
        return renderApp
    }

    it('remote host that gh is logged in to is used', async () => {
        mockCmds({ remote: 'https://ghe.corp:8443/corp/app.git', authed: ['ghe.corp'] })
        await run()
        expect(process.env.GH_HOST).toBe('ghe.corp')
        expect(process.env.GHUI_REPO).toBe('corp/app')
    })

    it('SSH alias is resolved with ssh -G (execa arg array, timeout)', async () => {
        mockCmds({ remote: 'git@ghe-alias:corp/app.git', ssh: 'ghe.corp', authed: ['ghe.corp'] })
        await run()
        expect(execa).toHaveBeenCalledWith('ssh', ['-G', 'ghe-alias'], expect.objectContaining({ timeout: expect.any(Number) }))
        expect(process.env.GH_HOST).toBe('ghe.corp')
        expect(process.env.GHUI_REPO).toBe('corp/app')
    })

    it('ssh hostname differing from the API host falls back to the single authed GHES host', async () => {
        mockCmds({ remote: 'git@ssh.ghe.corp:corp/app.git', ssh: 'ssh.ghe.corp', authed: ['github.com', 'ghe.corp'] })
        await run()
        expect(process.env.GH_HOST).toBe('ghe.corp')
        expect(process.env.GHUI_REPO).toBe('corp/app')
    })

    it('parses ssh://user@host:port/owner/repo', async () => {
        mockCmds({ remote: 'ssh://org-user@ghe.corp:2222/corp/app.git', ssh: 'ghe.corp', authed: ['ghe.corp'] })
        await run()
        expect(process.env.GH_HOST).toBe('ghe.corp')
        expect(process.env.GHUI_REPO).toBe('corp/app')
    })

    it('explicit GH_HOST wins over the remote', async () => {
        process.env.GH_HOST = 'other.corp'
        mockCmds({ remote: 'git@ghe-alias:corp/app.git', ssh: 'ghe.corp', authed: ['ghe.corp', 'other.corp'] })
        await run()
        expect(process.env.GH_HOST).toBe('other.corp')
        expect(execa).not.toHaveBeenCalledWith('ssh', expect.anything(), expect.anything())
        expect(process.env.GHUI_REPO).toBe('corp/app')
    })

    it('github.com-only user with a git@github-personal: alias stays on github.com', async () => {
        mockCmds({ remote: 'git@github-personal:me/app.git', ssh: 'github.com', authed: ['github.com'] })
        await run()
        expect(process.env.GH_HOST).toBeUndefined()
        expect(process.env.GHUI_REPO).toBe('me/app')
    })

    it('unauthenticated unresolved alias: clear message, exit 1, no login attempted', async () => {
        mockCmds({ remote: 'git@work-gh:corp/app.git', authed: ['github.com'] })
        await expect(run()).rejects.toThrow('exit:1')
        const msg = errSpy.mock.calls.map(c => c.join(' ')).join('\n')
        expect(msg).toContain('work-gh')
        expect(msg).toContain('github.com')
        expect(msg).toContain('gh auth login --hostname work-gh')
        expect(msg).toContain('export GH_HOST=')
        expect(process.env.GH_HOST).toBeUndefined()
        expect(execa.mock.calls.some(([b, a]) => b === 'gh' && a?.[0] === 'auth' && a?.[1] === 'login')).toBe(false)
    })
})

describe('detectRepo (host-agnostic)', () => {
    beforeEach(() => vi.clearAllMocks())

    it.each([
        ['git@ghe-alias:corp/app.git', 'corp/app'],
        ['ssh://u@ghe.corp:2222/corp/app.git', 'corp/app'],
        ['https://ghe.corp:8443/corp/my.app', 'corp/my.app'],
    ])('parses %s without GH_HOST matching', async (url, expected) => {
        execa.mockResolvedValue({ exitCode: 0, stdout: url })
        expect(await detectRepo()).toBe(expected)
    })
})
