import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { parse } from 'smol-toml'
import { migrateStateJsonToToml, migrateLegacyPaneIcons } from './migrate.js'
import { writeDefaultConfig } from '../config.js'
import { loadConfig } from './loader.js'
import { logger } from '../utils.js'

let dir
let configPath
let statePath
let backupPath

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'lazyhub-migrate-'))
  configPath = join(dir, 'lazyhub.toml')
  statePath = join(dir, 'state.json')
  backupPath = join(dir, 'state.json.bak')
})

afterEach(() => {
  vi.restoreAllMocks()
  rmSync(dir, { recursive: true, force: true })
})

describe('migrateStateJsonToToml', () => {
  it('migrates state.json into [state], preserves TOML comments, and writes a backup', () => {
    const info = vi.spyOn(logger, 'info').mockImplementation(() => {})
    writeFileSync(configPath, `# keep me
[theme]
name = "lazyhub-dark"
`, 'utf8')
    writeFileSync(statePath, JSON.stringify({ prScope: 'reviewing', cursor: 4 }, null, 2), 'utf8')

    const result = migrateStateJsonToToml({ statePath, configPath, backupPath })

    expect(result).toEqual({ migrated: true, deleted: true, reason: 'migrated' })
    expect(existsSync(statePath)).toBe(false)
    expect(existsSync(backupPath)).toBe(true)
    expect(JSON.parse(readFileSync(backupPath, 'utf8'))).toEqual({ prScope: 'reviewing', cursor: 4 })

    const text = readFileSync(configPath, 'utf8')
    expect(text).toContain('# keep me')
    expect(parse(text).state).toEqual({ prScope: 'reviewing', cursor: 4 })
    expect(info).toHaveBeenCalled()
  })

  it('is idempotent when [state] already exists and removes stale state.json', () => {
    writeFileSync(configPath, `[state]
prScope = "all"
`, 'utf8')
    writeFileSync(statePath, JSON.stringify({ prScope: 'mine' }), 'utf8')

    const result = migrateStateJsonToToml({ statePath, configPath, backupPath })

    expect(result).toEqual({ migrated: false, deleted: true, reason: 'toml-state-exists' })
    expect(existsSync(statePath)).toBe(false)
    expect(existsSync(backupPath)).toBe(false)
    expect(parse(readFileSync(configPath, 'utf8')).state).toEqual({ prScope: 'all' })
  })

  it('does nothing when legacy state.json is missing', () => {
    const result = migrateStateJsonToToml({ statePath, configPath, backupPath })
    expect(result).toEqual({ migrated: false, deleted: false, reason: 'missing-state-json' })
    expect(existsSync(configPath)).toBe(false)
  })
})

describe('migrateLegacyPaneIcons', () => {
  const legacy = `# my config
[panes.prs]
label = "Pull Requests"
icon  = "⎇"

[panes.issues]
label = "Issues"
icon = "◎"  # old default

[panes.branches]
icon = "⑂"

[panes.actions]
icon = "⚡"

[panes.notifications]
icon = "◈"
`

  it('removes icons equal to the old defaults so the current defaults apply', () => {
    writeFileSync(configPath, legacy, 'utf8')

    const result = migrateLegacyPaneIcons({ configPath })

    expect(result).toEqual({ migrated: true, removed: ['issues', 'branches', 'actions', 'notifications'] })
    const text = readFileSync(configPath, 'utf8')
    expect(text).toContain('# my config')
    expect(text).toContain('icon  = "⎇"')
    expect(parse(text).panes.issues).toEqual({ label: 'Issues' })
    const panes = loadConfig({ configPath }).panes
    expect(panes.issues.icon).toBe('⚑')
    expect(panes.branches.icon).toBe('⌥')
    expect(panes.actions.icon).toBe('↯')
    expect(panes.notifications.icon).toBe('✦')
  })

  it('leaves customised icons and other-pane old glyphs untouched', () => {
    const custom = `[panes.issues]
icon = "I"

[panes.actions]
icon = "◎"

[ui]
icon = "⚡"
`
    writeFileSync(configPath, custom, 'utf8')
    utimesSync(configPath, new Date(1000), new Date(1000))

    expect(migrateLegacyPaneIcons({ configPath })).toEqual({ migrated: false, removed: [] })
    expect(readFileSync(configPath, 'utf8')).toBe(custom)
    expect(statSync(configPath).mtimeMs).toBe(1000)
  })

  it('is idempotent: a second run changes nothing and does not write', () => {
    writeFileSync(configPath, legacy, 'utf8')
    migrateLegacyPaneIcons({ configPath })
    const after = readFileSync(configPath, 'utf8')
    utimesSync(configPath, new Date(1000), new Date(1000))

    expect(migrateLegacyPaneIcons({ configPath })).toEqual({ migrated: false, removed: [] })
    expect(readFileSync(configPath, 'utf8')).toBe(after)
    expect(statSync(configPath).mtimeMs).toBe(1000)
  })

  it('does nothing when the config file is missing', () => {
    expect(migrateLegacyPaneIcons({ configPath })).toEqual({ migrated: false, removed: [] })
    expect(existsSync(configPath)).toBe(false)
  })

  it('writeDefaultConfig does not pin pane presentation into a fresh user file', () => {
    writeDefaultConfig(configPath)
    const text = readFileSync(configPath, 'utf8')
    expect(parse(text).panes).toBeUndefined()
    expect(parse(text).app.active_panes).toContain('issues')
    expect(loadConfig({ configPath }).panes.issues.icon).toBe('⚑')
  })

  it('writeDefaultConfig migrates a pre-existing config that pinned old icons', () => {
    writeFileSync(configPath, legacy, 'utf8')
    writeDefaultConfig(configPath)
    expect(loadConfig({ configPath }).panes.actions.icon).toBe('↯')
  })
})
