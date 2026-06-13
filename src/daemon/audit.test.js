import { mkdtempSync, readFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import { auditLogPath, isGhMutation, writeAuditEntry } from './audit.js'

const dirs = []

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('daemon audit log', () => {
  it('detects gh mutations', () => {
    expect(isGhMutation(['pr', 'merge', '1'])).toBe(true)
    expect(isGhMutation(['api', 'repos/o/r/issues/1/comments', '--method', 'POST'])).toBe(true)
    expect(isGhMutation(['pr', 'list'])).toBe(false)
  })

  it('writes NDJSON audit entries', () => {
    const dir = mkdtempSync(join(tmpdir(), 'lazyhub-audit-test-'))
    dirs.push(dir)
    const config = { audit: { path: join(dir, 'audit.log') } }
    writeAuditEntry({ op: 'pr merge', repo: 'owner/repo' }, config)
    const line = readFileSync(auditLogPath(config), 'utf8').trim()
    expect(JSON.parse(line)).toMatchObject({ op: 'pr merge', repo: 'owner/repo' })
  })
})
