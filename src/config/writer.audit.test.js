import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { writeState, readState } from './writer.js'

let dir
let path
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'lh-w-')); path = join(dir, 'lazyhub.toml') })
afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('writeState with a syntactically broken lazyhub.toml (audit)', () => {
  const broken = '[app]\nmouse = true\n[theme\nname = "x"\n[state]\nprScope = "own"\nkeep = 1\n'

  it('does not throw (callers such as PRList.setScope run it inside a key handler)', () => {
    writeFileSync(path, broken)
    expect(() => writeState({ prScope: 'all' }, { configPath: path })).not.toThrow()
  })

  it('does not rewrite the file when it cannot be parsed back, and keeps other state keys', () => {
    writeFileSync(path, broken)
    try { writeState({ prScope: 'all' }, { configPath: path }) } catch { /* asserted above */ }
    expect(readFileSync(path, 'utf8')).toContain('keep = 1')
    expect(readState({ configPath: path })).toBeDefined()
  })
})
