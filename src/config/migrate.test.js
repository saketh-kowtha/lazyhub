import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { parse } from 'smol-toml'
import { migrateStateJsonToToml } from './migrate.js'
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
