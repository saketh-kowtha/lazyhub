/**
 * src/services/ai-cli.test.js — the AI CLI spawn primitive, against real fake binaries.
 * No real AI CLI is ever run; fakes are shell scripts in a temp dir.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runAiCli, clampTimeout, cleanupAllIsolated, LOGIN_ENV_ALLOW } from './ai-cli.js'

let dir
const SAVED = {}
const LEAKY = { GH_TOKEN: 'ghp_x', GITHUB_TOKEN: 'ghp_y', GH_HOST: 'h', ANTHROPIC_API_KEY: 'sk-a', OPENAI_API_KEY: 'sk-o',
  CODEX_API_KEY: 'sk-c', GEMINI_API_KEY: 'g', NODE_OPTIONS: '--x', HTTPS_PROXY: 'http://p', SSH_AUTH_SOCK: '/s', AWS_PROFILE: 'a', XDG_CONFIG_HOME: '/x', GIT_DIR: '/g' }

function fake(name, body) {
  const p = join(dir, name)
  writeFileSync(p, `#!/bin/sh\n${body}\n`)
  chmodSync(p, 0o755)
  return p
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'lh-aicli-'))
  for (const k of [...Object.keys(LEAKY), 'HOME']) SAVED[k] = process.env[k]
  Object.assign(process.env, LEAKY, { HOME: join(dir, 'realhome') })
})
afterEach(() => {
  cleanupAllIsolated()
  for (const [k, v] of Object.entries(SAVED)) { if (v === undefined) delete process.env[k]; else process.env[k] = v }
  rmSync(dir, { recursive: true, force: true })
})

const recorder = (log) => `{ echo "ARGV:$*"; echo "CWD:$(pwd)"; echo "LS:$(ls -A | wc -l | tr -d ' ')"; env | sed 's/=.*//' | sort | sed 's/^/ENV:/'; echo "HOME=$HOME"; echo "STDIN:$(cat)"; } > ${log}; echo ok`

describe('runAiCli profiles', () => {
  it('login profile passes exactly the allowlist, the real HOME, a sandbox cwd and no secrets', async () => {
    const log = join(dir, 'log.txt')
    const bin = fake('cli', recorder(log))
    await runAiCli({ cmd: bin, args: ['exec', '--json'], stdin: 'SECRET PROMPT', profile: 'login', auth: { env: { CODEX_HOME: '/user/codex' } } })
    const rec = readFileSync(log, 'utf8')
    const keys = rec.split('\n').filter(l => l.startsWith('ENV:')).map(l => l.slice(4))
    const allowed = new Set([...LOGIN_ENV_ALLOW, 'TMPDIR', 'TERM', 'NO_COLOR', 'CODEX_HOME', 'PWD', 'SHLVL', '_', 'OLDPWD', 'LC_CTYPE', '__CF_USER_TEXT_ENCODING'])
    expect(keys.filter(k => !allowed.has(k))).toEqual([])
    for (const k of Object.keys(LEAKY)) expect(keys).not.toContain(k)
    expect(rec).toContain(`HOME=${join(dir, 'realhome')}`)
    expect(rec).toContain('LS:0')
    expect(rec).toContain('STDIN:SECRET PROMPT')
    expect(rec.split('\n').find(l => l.startsWith('ARGV:'))).not.toContain('SECRET')
    const cwd = rec.match(/CWD:(.*)/)[1]
    expect(existsSync(cwd)).toBe(false)  // sandbox removed after the run
  })

  it('sandbox profile still uses a throwaway HOME', async () => {
    const log = join(dir, 'log.txt')
    const bin = fake('cli', recorder(log))
    await runAiCli({ cmd: bin, args: [], stdin: '', auth: { env: { CODEX_API_KEY: 'k' } } })
    const rec = readFileSync(log, 'utf8')
    expect(rec).not.toContain(`HOME=${join(dir, 'realhome')}`)
    expect(rec).toContain('ENV:CODEX_API_KEY')
  })

  it('removes the sandbox on error', async () => {
    const log = join(dir, 'log.txt')
    const bin = fake('cli', `${recorder(log)}; exit 3`)
    await expect(runAiCli({ cmd: bin, args: [], stdin: '', profile: 'login' })).rejects.toMatchObject({ exitCode: 3 })
    expect(existsSync(readFileSync(log, 'utf8').match(/CWD:(.*)/)[1])).toBe(false)
  })
})

describe('runAiCli limits', () => {
  it('kills the whole process group on timeout (grandchild too)', async () => {
    const pidFile = join(dir, 'gc.pid')
    const bin = fake('cli', `sleep 30 &\necho $! > ${pidFile}\nwait`)
    await expect(runAiCli({ cmd: bin, args: [], stdin: '', timeoutMs: 400, profile: 'login' })).rejects.toMatchObject({ isTimeout: true })
    const pid = Number(readFileSync(pidFile, 'utf8'))
    let alive = true
    for (let i = 0; i < 40 && alive; i++) {  // allow the orphaned zombie to be reaped
      try { process.kill(pid, 0) } catch { alive = false }
      if (alive) await new Promise(r => setTimeout(r, 100))
    }
    expect(alive).toBe(false)
  })

  it('treats output over the 256KB cap as an output-cap error', async () => {
    const bin = fake('cli', 'head -c 300000 /dev/zero | tr "\\0" "a"')
    await expect(runAiCli({ cmd: bin, args: [], stdin: '', profile: 'login' })).rejects.toMatchObject({ isOutputCap: true })
  })

  it('never puts stderr in the error message, only classifies it', async () => {
    const bin = fake('cli', 'echo "not logged in: https://auth.example/?token=TOPSECRET" >&2; exit 1')
    const err = await runAiCli({ cmd: bin, args: [], stdin: '', profile: 'login' }).catch(e => e)
    expect(err.isAuth).toBe(true)
    expect(JSON.stringify({ m: err.message, s: err.stack, ...err })).not.toContain('TOPSECRET')
  })

  it('clamps the timeout to 10s..300s with a 60s default', () => {
    expect(clampTimeout(undefined)).toBe(60_000)
    expect(clampTimeout(1)).toBe(10_000)
    expect(clampTimeout(9e9)).toBe(300_000)
    expect(clampTimeout(30_000)).toBe(30_000)
  })
})
