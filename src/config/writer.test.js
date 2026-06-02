import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { parse } from 'smol-toml'
import { readState, writeConfig, writeState } from './writer.js'
import { loadConfig } from './loader.js'

let dir
let configPath

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'lazyhub-writer-'))
  configPath = join(dir, 'lazyhub.toml')
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

function writeToml(text) {
  writeFileSync(configPath, text, 'utf8')
}

describe('config writer', () => {
  it('writes [state] while preserving comments and user-owned sections', () => {
    writeToml(`# user comment
[theme]
# keep this comment
name = "lazyhub-light"

[ui]
density = "comfortable"
unknown_ui_key = "keep me"

[keymaps.pr-list]
"j" = "cursor.down"

[[tabs]]
id = "focus"
label = "Focus"
`)

    writeState({ prScope: 'reviewing', cursor: 3 }, { configPath })

    const text = readFileSync(configPath, 'utf8')
    expect(text).toContain('# user comment')
    expect(text).toContain('# keep this comment')
    expect(text).toContain('unknown_ui_key = "keep me"')
    expect(text).toContain('[keymaps.pr-list]')
    expect(text).toContain('[[tabs]]')

    const parsed = parse(text)
    expect(parsed.state).toEqual({ prScope: 'reviewing', cursor: 3 })
    expect(parsed.theme.name).toBe('lazyhub-light')
  })

  it('replaces an existing [state] tree without disturbing following sections', () => {
    writeToml(`[theme]
name = "lazyhub-dark"

[state]
prScope = "mine"

[defaults]
pr_scope = "all"

[state.drafts]
"owner/repo#1" = "old"

[ui]
density = "compact"
`)

    writeState({ prScope: 'all', drafts: { 'owner/repo#2': 'new' } }, { configPath })

    const parsed = parse(readFileSync(configPath, 'utf8'))
    expect(parsed.state).toEqual({
      prScope: 'all',
      drafts: { 'owner/repo#2': 'new' },
    })
    expect(parsed.defaults.pr_scope).toBe('all')
    expect(parsed.ui.density).toBe('compact')
  })

  it('updates only settings-owned TOML keys', () => {
    writeToml(`[theme]
# theme comment
name = "lazyhub-dark"
custom = "preserved"

[defaults]
pr_scope = "mine"
ai_provider = "claude-code"

[keymaps.global]
"q" = "app.quit"
`)

    writeConfig({
      theme: { name: 'lazyhub-light' },
      defaults: { pr_scope: 'reviewing', ai_provider: 'codex' },
      ui: { density: 'comfortable' },
      keymaps: { global: { q: 'evil' } },
    }, { configPath })

    const text = readFileSync(configPath, 'utf8')
    expect(text).toContain('# theme comment')
    expect(text).toContain('custom = "preserved"')
    expect(text).toContain('"q" = "app.quit"')
    expect(text).not.toContain('density = "comfortable"')

    const parsed = parse(text)
    expect(parsed.theme.name).toBe('lazyhub-light')
    expect(parsed.defaults.pr_scope).toBe('reviewing')
    expect(parsed.defaults.ai_provider).toBe('codex')
  })

  it('replaces an existing multiline array value without orphaning lines', () => {
    writeToml(`[app]
active_panes = [
  "prs",
  "issues",
]
default_pane = "prs"

[theme]
name = "lazyhub-dark"
`)

    writeConfig({
      app: { active_panes: ['prs', 'actions'] },
    }, { configPath })

    const text = readFileSync(configPath, 'utf8')
    expect(text).not.toContain('  "issues",')

    const parsed = parse(text)
    expect(parsed.app.active_panes).toEqual(['prs', 'actions'])
    expect(parsed.app.default_pane).toBe('prs')
    expect(parsed.theme.name).toBe('lazyhub-dark')
  })

  it('readState returns the TOML state table only', () => {
    writeToml(`[state]
prScope = "all"
page = 2
`)
    expect(readState({ configPath })).toEqual({ prScope: 'all', page: 2 })
  })

  it('loadConfig exposes [state] after writer updates', () => {
    writeState({ prScope: 'all' }, { configPath })
    expect(loadConfig({ configPath }).state.prScope).toBe('all')
  })
})
