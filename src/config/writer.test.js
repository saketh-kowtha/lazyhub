import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, readFileSync, rmSync, statSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { parse } from 'smol-toml'
import { readState, writeConfig, writeState, setConfigWriteNotifier } from './writer.js'
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
  it.each([
    '[app]\nmouse = true',
    '[app]',
    '[app]\n# keep this comment',
    '[app]\nmouse = true\n',
  ])('adds a setting on a separate line after %j', source => {
    writeToml(source)

    writeConfig({ app: { default_pane: 'prs' } }, { configPath })

    const text = readFileSync(configPath, 'utf8')
    const prefix = source.endsWith('\n') ? source : `${source}\n`
    expect(text).toBe(`${prefix}default_pane = "prs"\n`)
    expect(parse(text).app).toEqual({ ...parse(source).app, default_pane: 'prs' })
    expect(loadConfig({ configPath }).app.default_pane).toBe('prs')

    writeConfig({ app: { default_pane: 'prs' } }, { configPath })
    expect(readFileSync(configPath, 'utf8')).toBe(text)
  })

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

describe('[defaults].repo (#290)', () => {
  it('upserts the saved repo, keeps user comments, and writes a 0600 file', () => {
    writeToml('# mine\n[defaults]\npr_scope = "all" # keep\n')
    writeConfig({ defaults: { repo: 'acme/platform' } }, { configPath })
    const text = readFileSync(configPath, 'utf8')
    expect(text).toContain('# mine')
    expect(text).toContain('pr_scope = "all" # keep')
    expect(loadConfig({ configPath }).defaults.repo).toBe('acme/platform')
    if (process.platform !== 'win32') expect(statSync(configPath).mode & 0o777).toBe(0o600)
  })

  it('drops a malformed saved repo when loading', () => {
    writeToml('[defaults]\nrepo = "--not a repo"\n')
    expect(loadConfig({ configPath }).defaults.repo).toBe('')
  })

  it.each(['x/..', 'x/.', 'x/a.', '-x/y', 'a/b/c'])('drops traversal or flag-like saved repo %s', value => {
    writeToml(`[defaults]\nrepo = "${value}"\n`)
    expect(loadConfig({ configPath }).defaults.repo).toBe('')
  })

  it('round-trips repo_host and drops a malformed one', () => {
    writeConfig({ defaults: { repo: 'acme/platform', repo_host: 'ghe.example.com' } }, { configPath })
    expect(loadConfig({ configPath }).defaults.repo_host).toBe('ghe.example.com')
    writeToml('[defaults]\nrepo_host = "bad host/"\n')
    expect(loadConfig({ configPath }).defaults.repo_host).toBe('')
  })
})

describe('writing into a syntactically broken lazyhub.toml (#435)', () => {
  const broken = '[app]\nmouse = true\n[theme\nname = "x"\n[state]\nprScope = "own"\nkeep = 1\n'
  beforeEach(() => { setConfigWriteNotifier(() => {}); setConfigWriteNotifier(null) }) // drain queue
  afterEach(() => setConfigWriteNotifier(null))

  it('writeState does not throw (callers run it inside key handlers)', () => {
    writeToml(broken)
    expect(() => writeState({ prScope: 'all' }, { configPath })).not.toThrow()
  })

  it('leaves the broken file byte-for-byte untouched, keeping other state keys', () => {
    writeToml(broken)
    writeState({ prScope: 'all' }, { configPath })
    expect(readFileSync(configPath, 'utf8')).toBe(broken)
    expect(readFileSync(configPath, 'utf8')).toContain('keep = 1')
  })

  it('surfaces a notice instead, including one queued before the UI registered', () => {
    writeToml(broken)
    writeState({ prScope: 'all' }, { configPath })
    const seen = []
    setConfigWriteNotifier(m => seen.push(m))
    expect(seen).toHaveLength(1)
    expect(seen[0]).toMatch(/Could not save settings: .*not valid TOML/)
    writeState({ prScope: 'own' }, { configPath })
    expect(seen).toHaveLength(2)
  })

  it('writeConfig refuses to write and says why', () => {
    writeToml(broken)
    expect(() => writeConfig({ theme: { name: 'dark' } }, { configPath })).toThrow(/not valid TOML/)
    expect(readFileSync(configPath, 'utf8')).toBe(broken)
  })

  it('preserves other [state] keys on a valid file', () => {
    writeToml('[state]\nprScope = "own"\nkeep = 1\n')
    writeState({ prScope: 'all' }, { configPath })
    expect(readState({ configPath })).toEqual({ prScope: 'all', keep: 1 })
  })
})
