/**
 * codex login mode (#364) against a fake `codex` binary on a test PATH. No real CLI runs.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let consent = true
vi.mock('../../config/loader.js', () => ({ loadConfig: () => ({ ai: { login: { codex: consent } } }) }))

const { detect, complete } = await import('./codex.js')
const { clearLoginCache } = await import('../login.js')
const { cleanupAllIsolated } = await import('../../services/ai-cli.js')

const FLAGS = '--json --skip-git-repo-check --ignore-user-config --ignore-rules --ephemeral --sandbox --disable'
let dir, home, log
const SAVED = {}
const KEYS = ['PATH', 'HOME', 'GH_TOKEN', 'GITHUB_TOKEN', 'OPENAI_API_KEY', 'CODEX_API_KEY', 'NODE_OPTIONS', 'CODEX_HOME', 'SSH_AUTH_SOCK']

function installFake({ help = FLAGS, features = 'shell_tool\nother', loggedIn = true } = {}) {
  const p = join(dir, 'bin', 'codex')
  writeFileSync(p, `#!/bin/sh
case "$1" in
  --version) echo "codex-cli 9.9.9";;
  login) echo "Logged in as victim@example.com token=TOPSECRET"; ${loggedIn ? 'exit 0' : 'exit 1'};;
  features) echo "${features}";;
  exec)
    if [ "$2" = "--help" ]; then echo "${help}"; exit 0; fi
    { echo "ARGV:$*"; echo "CWD:$(pwd)"; echo "LS:$(ls -A | wc -l | tr -d ' ')"; env | sed 's/=.*//' | sort | sed 's/^/ENV:/'; } > "${log}"
    cat > /dev/null
    echo '{"type":"item.completed","item":{"type":"agent_message","text":"{\\"summary\\":\\"ok\\",\\"suggestions\\":[]}"}}';;
esac
`)
  chmodSync(p, 0o755)
}

beforeEach(() => {
  for (const k of KEYS) SAVED[k] = process.env[k]
  dir = mkdtempSync(join(tmpdir(), 'lh-codexlogin-'))
  mkdirSync(join(dir, 'bin'))
  home = join(dir, 'home')
  mkdirSync(join(home, '.codex'), { recursive: true })
  writeFileSync(join(home, '.codex', 'auth.json'), '{"fixture":"login"}')
  log = join(dir, 'log.txt')
  for (const k of KEYS) delete process.env[k]
  Object.assign(process.env, {
    PATH: `${join(dir, 'bin')}:/usr/bin:/bin`, HOME: home, GH_TOKEN: 'ghp_x', GITHUB_TOKEN: 'ghp_y',
    OPENAI_API_KEY: 'sk-o', NODE_OPTIONS: '--x', SSH_AUTH_SOCK: '/s',
  })
  delete process.env.OPENAI_API_KEY  // API keys must not be what authenticates login mode
  consent = true
  clearLoginCache()
})
afterEach(() => {
  cleanupAllIsolated()
  for (const k of KEYS) { if (SAVED[k] === undefined) delete process.env[k]; else process.env[k] = SAVED[k] }
  rmSync(dir, { recursive: true, force: true })
})

const snapshotCreds = () => readdirSync(join(home, '.codex')).map(f => [f, statSync(join(home, '.codex', f)).mtimeMs, readFileSync(join(home, '.codex', f), 'utf8')])

describe('codex login mode', () => {
  it('is available when consented, capable and logged in', async () => {
    installFake()
    expect(await detect()).toMatchObject({ available: true, authMode: 'login' })
  })

  it('runs with hardened argv, a minimal env and an untouched credential dir', async () => {
    installFake()
    process.env.OPENAI_API_KEY = 'sk-o'  // present, but must be withheld from the login run
    const before = snapshotCreds()
    const res = await complete({ system: 'sys', user: 'PROMPT-TEXT' })
    expect(res.text).toContain('summary')
    const rec = readFileSync(log, 'utf8')
    const argv = rec.match(/ARGV:(.*)/)[1]
    expect(argv).toBe('exec --json --skip-git-repo-check --ignore-user-config --ignore-rules --ephemeral --sandbox read-only --disable shell_tool')
    expect(argv).not.toContain('PROMPT-TEXT')
    expect(rec).toContain('LS:0')
    const keys = rec.split('\n').filter(l => l.startsWith('ENV:')).map(l => l.slice(4))
    for (const k of ['GH_TOKEN', 'GITHUB_TOKEN', 'OPENAI_API_KEY', 'NODE_OPTIONS', 'SSH_AUTH_SOCK', 'CODEX_API_KEY']) expect(keys).not.toContain(k)
    expect(keys).toContain('HOME')
    expect(snapshotCreds()).toEqual(before)
  })

  it('passes CODEX_HOME only when the user set it', async () => {
    installFake()
    process.env.CODEX_HOME = join(home, '.codex')
    await complete({ system: 's', user: 'u' })
    expect(readFileSync(log, 'utf8')).toContain('ENV:CODEX_HOME')
  })

  it('without consent it is unavailable and never runs exec', async () => {
    installFake()
    consent = false
    const d = await detect()
    expect(d.available).toBe(false)
    await expect(complete({ system: 's', user: 'u' })).rejects.toMatchObject({ code: 'auth-required' })
  })

  it('fails closed when a hardening flag is missing from --help', async () => {
    installFake({ help: FLAGS.replace('--ignore-rules', '') })
    const d = await detect()
    expect(d.available).toBe(false)
    expect(d.reason).toContain('lacks --ignore-rules')
  })

  it('fails closed when the shell tool cannot be disabled', async () => {
    installFake({ features: 'other' })
    expect((await detect()).reason).toContain('lacks shell_tool')
  })

  it('is unavailable when not logged in, and the status output never surfaces', async () => {
    installFake({ loggedIn: false })
    const d = await detect()
    expect(d.available).toBe(false)
    expect(JSON.stringify(d)).not.toMatch(/TOPSECRET|victim@/)
  })

  it('still uses the API-key sandbox when login mode is off', async () => {
    installFake()
    consent = false
    process.env.CODEX_API_KEY = 'k'
    expect(await detect()).toMatchObject({ available: true, authMode: 'sandbox' })
  })
})
