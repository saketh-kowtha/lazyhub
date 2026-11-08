import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parse } from 'smol-toml'
import { runAi } from './ai-login.js'
import { validateConfig } from '../config/schema.js'

const sink = () => { const c = []; return { write: s => c.push(s), text: () => c.join('') } }
let dir, configPath
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'lh-ailogin-')); configPath = join(dir, 'lazyhub.toml') })
afterEach(() => rmSync(dir, { recursive: true, force: true }))
const login = () => parse(readFileSync(configPath, 'utf8')).ai?.login

describe('lazyhub ai login', () => {
  it('enables only after a typed yes and shows the consent text first', async () => {
    const out = sink()
    expect(await runAi(['login', 'enable', 'codex'], { out, err: sink(), answer: async () => 'yes', configPath })).toBe(0)
    expect(out.text()).toContain('REAL home directory')
    expect(login()).toEqual({ codex: true })
  })

  it('does not enable on anything but yes', async () => {
    expect(await runAi(['login', 'enable', 'codex'], { out: sink(), err: sink(), answer: async () => 'y', configPath })).toBe(1)
    expect(existsSync(configPath)).toBe(false)
  })

  it('disable revokes without asking', async () => {
    await runAi(['login', 'enable', 'codex'], { out: sink(), err: sink(), answer: async () => 'yes', configPath })
    expect(await runAi(['login', 'disable', 'codex'], { out: sink(), err: sink(), answer: async () => { throw new Error('asked') }, configPath })).toBe(0)
    expect(login()).toEqual({ codex: false })
  })

  it('rejects CLIs without a shipped login mode', async () => {
    const err = sink()
    expect(await runAi(['login', 'enable', 'gemini-cli'], { out: sink(), err, answer: async () => 'yes', configPath })).toBe(2)
    expect(err.text()).toContain('not supported')
  })
})

describe('[ai.login] schema', () => {
  it('defaults to all false and validates booleans', () => {
    const { config, warnings } = validateConfig({ ai: { login: { codex: true, agy: 'yes', bogus: true } } })
    expect(config.ai.login).toEqual({ codex: true })
    expect(warnings.join('\n')).toContain('[ai.login].agy')
    expect(warnings.join('\n')).toContain('bogus')
  })
})
