/**
 * launch-paths.test.js — where lazyhub is launched (onboarding journeys, group C).
 *
 * Every case runs the real bootstrap() in a child process, inside a real throwaway git
 * repository under a temp dir, with a temp HOME and a stub `gh` (test/support/launch-*.mjs).
 * Nothing touches the real ~/.config/lazyhub, the installed binary or the network.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { git, launch, makeRepo, makeSandbox } from '../test/support/launch-harness.mjs'

const GHES = ['github.com', 'ghe.corp']
let sb
beforeAll(() => { sb = makeSandbox() })
afterAll(() => { rmSync(sb.root, { recursive: true, force: true }) })

let seq = 0
const repo = (name, remotes) => makeRepo(join(sb.root, `${name}-${seq++}`), remotes)
const resolved = (r) => ({ status: r.status, host: r.env?.GH_HOST ?? null, repo: r.env?.GHUI_REPO ?? null })
const ssh = (cfg) => writeFileSync(join(sb.home, '.ssh', 'config'), cfg)

describe('C1/C7 remote URL shapes on github.com', () => {
  it.each([
    ['https', 'https://github.com/o/r.git'],
    ['https without .git', 'https://github.com/o/r'],
    ['trailing slash', 'https://github.com/o/r/'],
    ['credentialed https', 'https://x-access-token:abc@github.com/o/r.git'],
    ['scp-like ssh', 'git@github.com:o/r.git'],
    ['ssh://', 'ssh://git@github.com/o/r.git'],
    ['ssh over 443', 'ssh://git@ssh.github.com:443/o/r.git'],
  ])('%s', (_n, url) => {
    expect(resolved(launch(sb, { cwd: repo('shape', { origin: url }) }))).toEqual({ status: 0, host: null, repo: 'o/r' })
  })
  it('repository names with dots', () => {
    expect(resolved(launch(sb, { cwd: repo('dots', { origin: 'git@github.com:o/.github.git' }) })).repo).toBe('o/.github')
  })
})

describe('C2 GitHub Enterprise Server', () => {
  it('uses the remote host when gh is logged in to it', () => {
    expect(resolved(launch(sb, { cwd: repo('ghes', { origin: 'https://ghe.corp:8443/o/r.git' }), hosts: GHES }))).toEqual({ status: 0, host: 'ghe.corp', repo: 'o/r' })
  })
  it('works when the GHES login is the only one', () => {
    expect(resolved(launch(sb, { cwd: repo('ghes-only', { origin: 'https://ghe.corp/o/r.git' }), hosts: ['ghe.corp'] }))).toEqual({ status: 0, host: 'ghe.corp', repo: 'o/r' })
  })
  it('without a GHES login it stops with the exact command to run', () => {
    const r = launch(sb, { cwd: repo('ghes-nologin', { origin: 'https://ghe.corp/o/r.git' }), hosts: ['github.com'] })
    expect(r.status).toBe(1)
    expect(r.err).toContain('gh auth login --hostname ghe.corp')
  })
  it('with no login at all and no terminal it explains how to sign in', () => {
    const r = launch(sb, { cwd: repo('ghes-none', { origin: 'https://ghe.corp/o/r.git' }), hosts: [] })
    expect(r.status).toBe(1)
    expect(r.err).toContain('gh auth login --hostname ghe.corp')
  })
  it('a repository that is the clone only remote named upstream still picks the GHES host', () => {
    expect(resolved(launch(sb, { cwd: repo('ghes-upstream', { upstream: 'https://ghe.corp/o/r.git' }), hosts: GHES }))).toEqual({ status: 0, host: 'ghe.corp', repo: 'o/r' })
  })
})

describe('C3/C4 no repository to detect', () => {
  it('non-git directory uses the saved default repository', () => {
    mkdirSync(join(sb.root, 'plain'), { recursive: true })
    expect(resolved(launch(sb, { cwd: join(sb.root, 'plain'), saved: 'x/saved' }))).toEqual({ status: 0, host: null, repo: 'x/saved' })
  })
  it.each(['plain', 'noremote'])('%s with nothing saved ends with a way forward, not a dead end', (kind) => {
    const cwd = kind === 'plain' ? join(sb.root, 'plain') : repo('noremote', {})
    const r = launch(sb, { cwd })
    expect(r.status).toBe(1)
    expect(r.err).toContain('lazyhub --repo owner/name')
  })
  it('a git repo with no remote still uses the saved default', () => {
    expect(resolved(launch(sb, { cwd: repo('noremote2', {}), saved: 'x/saved' })).repo).toBe('x/saved')
  })
})

describe('C5 remote is not GitHub', () => {
  it.each([
    ['gitlab https', 'https://gitlab.com/o/r.git'],
    ['gitlab ssh', 'git@gitlab.com:o/r.git'],
    ['bitbucket', 'git@bitbucket.org:o/r.git'],
  ])('%s: ignored, saved default used, no host error', (_n, url) => {
    const r = launch(sb, { cwd: repo('foreign', { origin: url }), saved: 'x/saved' })
    expect(resolved(r)).toEqual({ status: 0, host: null, repo: 'x/saved' })
  })
  it('local path remote falls through to the saved default', () => {
    expect(resolved(launch(sb, { cwd: repo('localpath', { origin: '/srv/git/proj.git' }), saved: 'x/saved' })).repo).toBe('x/saved')
  })
})

describe('C6 multiple remotes', () => {
  it('origin (the fork) wins over upstream', () => {
    expect(resolved(launch(sb, { cwd: repo('fork', { origin: 'https://github.com/me/r.git', upstream: 'https://github.com/o/r.git' }) })).repo).toBe('me/r')
  })
  it('a lone remote that is not named origin is used', () => {
    expect(resolved(launch(sb, { cwd: repo('upstream-only', { upstream: 'https://github.com/o/r.git' }) })).repo).toBe('o/r')
  })
  it('a GitLab origin with a GitHub mirror remote uses the mirror', () => {
    expect(resolved(launch(sb, { cwd: repo('mirror', { origin: 'https://gitlab.com/o/r.git', github: 'https://github.com/o/r.git' }) }))).toEqual({ status: 0, host: null, repo: 'o/r' })
  })
})

describe('C7 ssh aliases', () => {
  it('alias that resolves to github.com', () => {
    ssh('Host gh-work\n  HostName github.com\n  User git\n')
    expect(resolved(launch(sb, { cwd: repo('alias-gh', { origin: 'git@gh-work:o/r.git' }) }))).toEqual({ status: 0, host: null, repo: 'o/r' })
  })
  it('alias that resolves to a GHES host', () => {
    ssh('Host work\n  HostName ghe.corp\n  User git\n')
    expect(resolved(launch(sb, { cwd: repo('alias-ghes', { origin: 'git@work:o/r.git' }), hosts: GHES }))).toEqual({ status: 0, host: 'ghe.corp', repo: 'o/r' })
  })
  it('an alias that cannot be resolved asks for GH_HOST instead of guessing', () => {
    ssh('')
    const r = launch(sb, { cwd: repo('alias-unknown', { origin: 'git@mystery:o/r.git' }) })
    expect(r.status).toBe(1)
    expect(r.err).toContain('GH_HOST')
  })
})

describe('C8 repository layouts', () => {
  const REMOTE = 'https://github.com/o/r.git'
  it('subdirectory', () => {
    const d = repo('sub', { origin: REMOTE })
    mkdirSync(join(d, 'a', 'b'), { recursive: true })
    expect(resolved(launch(sb, { cwd: join(d, 'a', 'b') })).repo).toBe('o/r')
  })
  it('linked worktree', () => {
    const d = repo('wt-main', { origin: REMOTE })
    git(d, 'worktree', 'add', '-q', join(sb.root, 'wt-linked'), '-b', 'wt')
    expect(resolved(launch(sb, { cwd: join(sb.root, 'wt-linked') })).repo).toBe('o/r')
  })
  it('submodule resolves to the submodule remote, not the parent', () => {
    const sub = repo('sm-sub', { origin: 'https://github.com/sub/mod.git' })
    const d = repo('sm-parent', { origin: REMOTE })
    git(d, 'submodule', 'add', '-q', sub, 'vendor/mod')
    git(join(d, 'vendor', 'mod'), 'remote', 'set-url', 'origin', 'https://github.com/sub/mod.git')
    expect(resolved(launch(sb, { cwd: join(d, 'vendor', 'mod') })).repo).toBe('sub/mod')
  })
  it('bare repository', () => {
    const d = join(sb.root, 'bare.git')
    mkdirSync(d)
    git(d, 'init', '-q', '--bare')
    git(d, 'remote', 'add', 'origin', REMOTE)
    expect(resolved(launch(sb, { cwd: d })).repo).toBe('o/r')
  })
  it('detached HEAD', () => {
    const d = repo('detached', { origin: REMOTE })
    git(d, 'checkout', '-q', '--detach')
    expect(resolved(launch(sb, { cwd: d })).repo).toBe('o/r')
  })
})

describe('C10 unusual locations', () => {
  it('home directory and / use the saved default', () => {
    expect(resolved(launch(sb, { cwd: sb.home, saved: 'x/saved' })).repo).toBe('x/saved')
    expect(resolved(launch(sb, { cwd: '/', saved: 'x/saved' })).repo).toBe('x/saved')
  })
  it('path with spaces and unicode', () => {
    expect(resolved(launch(sb, { cwd: repo('my proj é 日本', { origin: 'https://github.com/o/r.git' }) })).repo).toBe('o/r')
  })
  it('symlinked path', () => {
    const d = repo('real', { origin: 'https://github.com/o/r.git' })
    symlinkSync(d, join(sb.root, 'link'))
    expect(resolved(launch(sb, { cwd: join(sb.root, 'link') })).repo).toBe('o/r')
  })
  it('unwritable HOME does not stop the launch', () => {
    const r = launch(sb, { cwd: repo('rohome', { origin: 'https://github.com/o/r.git' }), env: { HOME: '/nonexistent-home-dir' } })
    expect(resolved(r).repo).toBe('o/r')
  })
})

describe('C11 explicit repository arguments', () => {
  it('--repo wins over the clone', () => {
    expect(resolved(launch(sb, { cwd: repo('arg-clone', { origin: 'https://github.com/o/r.git' }), args: { repoOverride: 'x/y' } })).repo).toBe('x/y')
  })
  it('--repo works outside a repository', () => {
    mkdirSync(join(sb.root, 'plain'), { recursive: true })
    expect(resolved(launch(sb, { cwd: join(sb.root, 'plain'), args: { repoOverride: 'x/y' } })).repo).toBe('x/y')
  })
  it('--repo is not blocked by a GitLab clone', () => {
    expect(resolved(launch(sb, { cwd: repo('arg-gitlab', { origin: 'https://gitlab.com/o/r.git' }), args: { repoOverride: 'x/y' } }))).toEqual({ status: 0, host: null, repo: 'x/y' })
  })
  it('--repo is not blocked by a GHES clone that gh is not logged in to', () => {
    const r = launch(sb, { cwd: repo('arg-ghes', { origin: 'https://ghe.corp/o/r.git' }), args: { repoOverride: 'x/y' } })
    expect(resolved(r)).toEqual({ status: 0, host: null, repo: 'x/y' })
  })
  it('--repo with GH_HOST targets the enterprise host', () => {
    mkdirSync(join(sb.root, 'plain'), { recursive: true })
    expect(resolved(launch(sb, { cwd: join(sb.root, 'plain'), hosts: GHES, args: { repoOverride: 'x/y' }, env: { GH_HOST: 'ghe.corp' } }))).toEqual({ status: 0, host: 'ghe.corp', repo: 'x/y' })
  })
  it('a URL reference names its own host', () => {
    mkdirSync(join(sb.root, 'plain'), { recursive: true })
    const r = launch(sb, { cwd: join(sb.root, 'plain'), hosts: GHES, args: { open: { repo: 'a/b', number: 5, kind: 'pr', host: 'ghe.corp' } } })
    expect(resolved(r)).toEqual({ status: 0, host: 'ghe.corp', repo: 'a/b' })
  })
  it('a bare #N outside a repository exits 2 with guidance', () => {
    mkdirSync(join(sb.root, 'plain'), { recursive: true })
    const r = launch(sb, { cwd: join(sb.root, 'plain'), args: { open: { repo: null, number: 5, kind: 'issue', host: null } } })
    expect(r.status).toBe(2)
    expect(r.err).toContain('owner/repo#5')
  })
})

describe('C9 the repository itself is gone, moved, private or archived', () => {
  const REPOS = {
    'github.com/o/deleted': { status: 404 },
    'github.com/o/private': { status: 403, message: 'Resource not accessible' },
    'github.com/o/old-name': { status: 200, body: { full_name: 'o/new-name', archived: false } }, // gh follows the 301
    'github.com/o/archived': { status: 200, body: { full_name: 'o/archived', archived: true } },
  }
  let prev
  beforeAll(() => {
    prev = { path: process.env.PATH, spec: process.env.LAZYHUB_LAUNCH_SPEC, host: process.env.GH_HOST }
    writeFileSync(sb.specFile, JSON.stringify({ hosts: ['github.com'], repos: REPOS, log: sb.log }))
    process.env.PATH = `${sb.bin}:${prev.path}`
    process.env.LAZYHUB_LAUNCH_SPEC = sb.specFile
    delete process.env.GH_HOST
  })
  afterAll(() => {
    process.env.PATH = prev.path
    if (prev.spec === undefined) delete process.env.LAZYHUB_LAUNCH_SPEC
    else process.env.LAZYHUB_LAUNCH_SPEC = prev.spec
    if (prev.host !== undefined) process.env.GH_HOST = prev.host
  })
  const read = async (name) => {
    const { runGh } = await import('./executor/core.js')
    return runGh(['api', `repos/o/${name}`])
  }
  const failure = async (name) => {
    const { classifyGhFailure } = await import('./executor/classify.js')
    const err = await read(name).then(() => null, (e) => e)
    return err && classifyGhFailure(err, { repo: `o/${name}` })
  }

  it('deleted: says not found or no access, names the repository and the next step', async () => {
    const f = await failure('deleted')
    expect(f.kind).toBe('repo_not_found')
    expect(f.cause).toContain('o/deleted')
    expect(f.notes.join(' ')).toContain('ask an owner for access')
  })
  it('private without access: a plain failure with a command to run, never a crash', async () => {
    const f = await failure('private')
    expect(f.kind).toBe('forbidden')
    expect(f.fix).toBe('gh auth status')
  })
  it('renamed: the old name still loads (gh follows the redirect)', async () => {
    expect((await read('old-name')).full_name).toBe('o/new-name')
  })
  it('archived: reads work', async () => {
    expect((await read('archived')).archived).toBe(true)
  })
})
