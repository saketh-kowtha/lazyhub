// `lazyhub --mcp` through the BUILT entrypoint (#518): headless preflight, stdout
// reserved for JSON-RPC, never an interactive login. Temp HOME + fake gh only.
import { execFileSync, spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const root = new URL('../../', import.meta.url).pathname
const entry = join(root, 'dist', 'lazyhub.js')
const work = mkdtempSync(join(tmpdir(), 'lazyhub-mcp-e2e-'))
const home = join(work, 'home')
const cwd = join(work, 'cwd')
const loginMarker = join(work, 'login-spawned')

function fakeGh(name, body) {
  const dir = join(work, name)
  mkdirSync(dir)
  writeFileSync(join(dir, 'gh'), `#!/bin/sh\n${body}\n`)
  chmodSync(join(dir, 'gh'), 0o755)
  return dir
}

function runMcp(pathDir, input = '') {
  const env = { PATH: pathDir, HOME: home, USERPROFILE: home, XDG_CONFIG_HOME: join(home, '.config'), XDG_CACHE_HOME: join(home, '.cache') }
  return spawnSync(process.execPath, [entry, '--mcp'], { env, cwd, input, encoding: 'utf8', timeout: 20_000 })
}

beforeAll(() => {
  mkdirSync(home)
  mkdirSync(cwd)
  execFileSync(process.execPath, ['build.js'], { cwd: root, stdio: 'ignore' })
}, 60_000)
afterAll(() => rmSync(work, { recursive: true, force: true }))

describe('lazyhub --mcp headless preflight (#518)', () => {
  it('unauthenticated: empty stdout, one-line stderr, non-zero exit, never spawns gh auth login', () => {
    const bin = fakeGh('unauth', `
[ "$1" = "--version" ] && { echo "gh version 2.0.0"; exit 0; }
[ "$1 $2" = "auth login" ] && { touch '${loginMarker}'; exit 0; }
echo "not logged in" >&2; exit 1`)
    const r = runMcp(bin)
    expect(r.stdout).toBe('')
    expect(r.status).not.toBe(0)
    expect(r.stderr.trim().split('\n')).toHaveLength(1)
    expect(r.stderr).toContain('gh auth login')
    expect(existsSync(loginMarker)).toBe(false)
  })

  it('gh missing: empty stdout, one-line stderr, non-zero exit', () => {
    const empty = join(work, 'empty-path')
    mkdirSync(empty)
    const r = runMcp(empty)
    expect(r.stdout).toBe('')
    expect(r.status).not.toBe(0)
    expect(r.stderr.trim().split('\n')).toHaveLength(1)
    expect(r.stderr).toMatch(/gh/)
  })

  it('authenticated: serves JSON-RPC only on stdout', () => {
    const bin = fakeGh('authed', `
[ "$1" = "--version" ] && { echo "gh version 2.0.0"; exit 0; }
[ "$1 $2" = "auth token" ] && { echo fake; exit 0; }
echo "[]"`)
    const input = [
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
      { jsonrpc: '2.0', id: 2, method: 'tools/list' },
    ].map(m => JSON.stringify(m)).join('\n') + '\n'
    const r = runMcp(bin, input)
    expect(r.status).toBe(0)
    const lines = r.stdout.trim().split('\n').map(l => JSON.parse(l))
    expect(lines.map(l => l.id)).toEqual([1, 2])
    expect(lines[0].result.serverInfo.name).toBe('lazyhub')
  })
})
