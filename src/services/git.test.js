import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('execa', () => ({ execa: vi.fn() }))
vi.mock('../daemon/audit.js', async () => {
  const actual = await vi.importActual('../daemon/audit.js')
  return { ...actual, writeAuditEntry: vi.fn() }
})

import { execa } from 'execa'
import { writeAuditEntry } from '../daemon/audit.js'
import { classifyGit } from '../daemon/protocol.js'
import { runGit, GIT_OP_TIMEOUT_MS } from '../executor/git.js'
import {
  commit, conflictedFiles, countConflictMarkers, isInMerge, mergeAbort, mergeBranch, mergeMessage, push, stage, unpushedCommits, unstage,
} from './git.js'

beforeEach(() => { vi.clearAllMocks(); execa.mockResolvedValue({ exitCode: 0, stdout: '', stderr: '' }) })

describe('spawn sites (#479)', () => {
  const ROOT = fileURLToPath(new URL('..', import.meta.url))
  const ALLOWED = [/^services\//, /^executor\//, /^bootstrap\.js$/, /^daemon\//, /^ai\/providers\//, /^test\//]
  const SPAWN = /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|\bimport\s+)['"](?:execa|(?:node:)?child_process)['"]/
  const walk = dir => readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    const full = join(dir, e.name)
    if (e.isDirectory()) return walk(full)
    return /\.(?:js|jsx|mjs|cjs)$/.test(e.name) && !/\.test\./.test(e.name) ? [full] : []
  })

  it('no file outside services/, executor/, bootstrap.js, daemon/ and ai/providers/ can start a process', () => {
    const offenders = walk(ROOT)
      .map(f => relative(ROOT, f))
      .filter(f => !ALLOWED.some(re => re.test(f)))
      .filter(f => SPAWN.test(readFileSync(join(ROOT, f), 'utf8')))
    expect(offenders).toEqual([])
  })

  it('local git is only started through runGit', () => {
    const offenders = walk(ROOT)
      .map(f => relative(ROOT, f))
      .filter(f => !/^(?:test\/|bootstrap\.js$|executor\/git\.js$)/.test(f))
      .filter(f => /\bexeca\(\s*['"]git['"]/.test(readFileSync(join(ROOT, f), 'utf8')))
    expect(offenders).toEqual([])
  })
})

describe('classifyGit: the one list of what may run', () => {
  it.each([
    [['branch', '--show-current'], 'read'],
    [['remote', '-v'], 'read'],
    [['rev-parse', '--verify', 'MERGE_HEAD'], 'read'],
    [['status', '--porcelain'], 'read'],
    [['log', 'a..b'], 'read'],
    [['checkout', 'main'], 'write'],
    [['push', 'origin', 'HEAD'], 'write'],
    [['add', '--', 'a.js'], 'write'],
    [['restore', '--staged', '--', 'a.js'], 'write'],
    [['commit', '-m', 'x'], 'write'],
    [['merge', 'main', '--no-edit'], 'write'],
    [['fetch', 'upstream', 'main'], 'write'],
  ])('%j is %s', (args, kind) => expect(classifyGit(args)).toBe(kind))

  it.each([
    [['-c', 'core.sshCommand=x', 'fetch']],
    [['-C', '/', 'status']],
    [['branch', '-D', 'main']],
    [['remote', 'add', 'x', 'y']],
    [['reset', '--hard']],
    [['config', 'alias.x', '!sh']],
    [[]],
    [['status', 'a\0b']],
    ['status'],
    [[1]],
  ])('refuses %j', (args) => expect(classifyGit(args)).toBe('unknown'))
})

describe('runGit: the chokepoint', () => {
  it('requires the directory and refuses unknown commands before spawning', async () => {
    await expect(runGit(['status'], {})).rejects.toThrow(/cwd is required/)
    await expect(runGit(['reset', '--hard'], { cwd: '/w' })).rejects.toThrow(/not an allowlisted/)
    expect(execa).not.toHaveBeenCalled()
  })

  it('audits a write before and after it runs, and a read not at all', async () => {
    await runGit(['status', '--porcelain'], { cwd: '/w' })
    expect(writeAuditEntry).not.toHaveBeenCalled()
    await runGit(['commit', '-m', 'secret message'], { cwd: '/w', repo: 'o/r' })
    expect(writeAuditEntry.mock.calls.map(c => c[0].phase)).toEqual(['intent', 'result'])
    expect(writeAuditEntry.mock.calls[0][0]).toMatchObject({ op: 'git commit', repo: 'o/r' })
    expect(JSON.stringify(writeAuditEntry.mock.calls)).not.toContain('secret message')
    expect(writeAuditEntry.mock.calls[1][0]).toMatchObject({ outcome: 'ok' })
  })

  it('records a failed write as an error outcome', async () => {
    execa.mockResolvedValue({ exitCode: 1, stdout: '', stderr: 'no' })
    await runGit(['push', 'origin', 'HEAD'], { cwd: '/w', reject: false })
    expect(writeAuditEntry.mock.calls[1][0]).toMatchObject({ outcome: 'error' })
  })

  it('blocks a write when the audit log is unavailable', async () => {
    writeAuditEntry.mockImplementationOnce(() => { throw new Error('disk full') })
    await expect(runGit(['add', '--', 'a'], { cwd: '/w' })).rejects.toThrow(/audit log unavailable/)
    expect(execa).not.toHaveBeenCalled()
  })
})

describe('git write operations time out instead of hanging (#453)', () => {
  it.each([
    ['stage', () => stage('/w', ['a.js']), 60],
    ['unstage', () => unstage('/w', ['a.js']), 60],
    ['mergeAbort', () => mergeAbort('/w'), 60],
    ['commit', () => commit('/w', 'msg'), 60],
    ['mergeBranch', () => mergeBranch('/w', 'main'), 60],
    ['push', () => push('/w', 'origin', 'feat'), 300],
  ])('%s passes a %i s timeout to git and reports a timeout', async (_name, call, seconds) => {
    expect(GIT_OP_TIMEOUT_MS).toBe(60_000)
    execa.mockResolvedValue({ exitCode: undefined, timedOut: true, stdout: '', stderr: '' })
    await expect(call()).rejects.toThrow(new RegExp(`timed out after ${seconds} s`))
    expect(execa.mock.calls[0][2]).toMatchObject({ timeout: seconds * 1000, cwd: '/w' })
  })
})

describe('conflict-resolution reads', () => {
  it('isInMerge follows MERGE_HEAD', async () => {
    expect(await isInMerge('/w')).toBe(true)
    execa.mockResolvedValue({ exitCode: 1 })
    expect(await isInMerge('/w')).toBe(false)
  })

  it('conflictedFiles keeps only unmerged entries', async () => {
    execa.mockResolvedValue({ exitCode: 0, stdout: 'UU a.js\n M b.js\nAA c.js\n?? d' })
    expect(await conflictedFiles('/w')).toEqual([{ xy: 'UU', path: 'a.js' }, { xy: 'AA', path: 'c.js' }])
  })

  it('counts markers and reads the merge message from files without spawning anything', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'lazyhub-gitsvc-'))
    try {
      writeFileSync(join(dir, 'a.js'), 'x\n<<<<<<< HEAD\na\n=======\nb\n>>>>>>> m\n<<<<<<< HEAD\n')
      expect(await countConflictMarkers(dir, 'a.js')).toBe(2)
      expect(await countConflictMarkers(dir, 'missing.js')).toBe(0)
      writeFileSync(join(dir, 'MERGE_MSG'), 'Merge branch main\n')
      execa.mockResolvedValue({ exitCode: 0, stdout: `${join(dir, 'MERGE_MSG')}\n` })
      expect(await mergeMessage(dir)).toBe('Merge branch main')
      expect(readFileSync(join(dir, 'a.js'), 'utf8')).toContain('<<<<<<<')
      expect(execa.mock.calls.every(c => c[0] === 'git')).toBe(true)
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })

  it('unpushedCommits parses the log and says null when the remote branch is absent', async () => {
    execa.mockResolvedValue({ exitCode: 0, stdout: 'abc123\tfix: one\ndef456\tfeat: two' })
    expect(await unpushedCommits('/w', 'upstream', 'feat')).toEqual([{ sha: 'abc123', message: 'fix: one' }, { sha: 'def456', message: 'feat: two' }])
    expect(execa.mock.calls[0][1]).toContain('upstream/feat..feat')
    execa.mockResolvedValue({ exitCode: 128, stdout: '' })
    expect(await unpushedCommits('/w', 'origin', 'feat')).toBeNull()
  })
})
