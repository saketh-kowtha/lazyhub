/**
 * V2a acceptance (#597): the undeclared-write test. Every write call site in the migrated views
 * (Notifications, Actions, Branches, Issues list) must go through a declaration in src/data/mutations;
 * a view that calls a write function directly, or passes a bare function to useMutation, is an offender.
 * The issue DETAIL view (detail*.jsx, timeline-rows.jsx) and the PR views belong to V2b/V4 and are not scanned.
 */

import { describe, expect, it, beforeEach } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { defineMutation, runMutation, declaredMutationNames } from './core.js'
import { notifyWrite, runDeclared, onWrite, undeclaredWrites, resetUndeclaredWrites } from '../invalidation.js'
import { queryClient, identityKey } from '../queryClient.js'
import './notifications.js'
import './issues.js'

const SRC = join(import.meta.dirname, '..', '..')
const WRITE_MARKERS = /'--method',\s*'(POST|PUT|PATCH|DELETE)'|'--method',\s*method|\[\s*'(issue|pr|run|label|release|gist|repo)',\s*'(close|create|edit|merge|comment|reopen|rerun|cancel|delete|review|ready|lock|unlock)'|\bmutation\b\s*[({]/

/** Exported executor functions whose body issues a write. */
function executorWriteNames() {
  const dir = join(SRC, 'executor')
  const names = new Set()
  for (const file of readdirSync(dir).filter(f => f.endsWith('.js') && !f.endsWith('.test.js'))) {
    const parts = readFileSync(join(dir, file), 'utf8').split(/\nexport (?:async )?function /).slice(1)
    for (const part of parts) {
      const name = part.match(/^(\w+)/)?.[1]
      if (name && WRITE_MARKERS.test(part)) names.add(name)
    }
  }
  return names
}

/** Local-git writes the Branches view used to run through useMutation. */
const GIT_WRITES = ['gitPush', 'gitCheckout', 'createBranch']

const VIEW_FILES = [
  'features/notifications/index.jsx',
  'features/actions/index.jsx',
  'features/branches/index.jsx',
  'features/issues/list.jsx',
  'features/issues/list-dialogs.jsx',
  'features/issues/list-view.jsx',
  'features/issues/list-row.jsx',
  'features/issues/dialogs.jsx',
]

describe('undeclared writes in the migrated views', () => {
  const writes = executorWriteNames()

  it('finds the executor write functions it is meant to police', () => {
    for (const known of ['markNotificationRead', 'markAllNotificationsRead', 'rerunRun', 'cancelRun', 'deleteBranch', 'closeIssue', 'createIssue', 'editIssueMembers']) {
      expect(writes.has(known), known).toBe(true)
    }
    // reads must not be classed as writes
    for (const read of ['listNotifications', 'listRuns', 'listBranches', 'listIssuesPage', 'getIssueRow']) expect(writes.has(read), read).toBe(false)
  })

  it('no view calls a write function directly (offenders listed)', () => {
    const offenders = []
    for (const rel of VIEW_FILES) {
      const text = readFileSync(join(SRC, rel), 'utf8')
      for (const name of [...writes, ...GIT_WRITES]) {
        if (new RegExp(`\\b${name}\\(|import\\s*\\{[^}]*\\b${name}\\b[^}]*\\}`).test(text)) offenders.push(`${rel}: ${name}`)
      }
    }
    expect(offenders).toEqual([])
  })

  it('every useMutation in those views takes a declared mutation, never a bare function', () => {
    const offenders = []
    for (const rel of VIEW_FILES) {
      const text = readFileSync(join(SRC, rel), 'utf8')
      for (const m of text.matchAll(/useMutation\(\s*([^\n]*)/g)) {
        if (!/^\w*Mutation\b/.test(m[1])) offenders.push(`${rel}: useMutation(${m[1].slice(0, 40)}`)
      }
    }
    expect(offenders).toEqual([])
  })

  it('every declaration is named and registered', () => {
    expect(declaredMutationNames()).toEqual(expect.arrayContaining(['notifications.markRead', 'notifications.markAllRead', 'issues.editMembers']))
  })
})

describe('declared scope', () => {
  beforeEach(() => { resetUndeclaredWrites() })

  it('a write announced inside runDeclared is flagged declared and not counted as undeclared', async () => {
    const seen = []
    const off = onWrite(e => seen.push(e))
    await runDeclared('t', async () => { await Promise.resolve(); notifyWrite('o/r') })
    notifyWrite('o/r')
    off()
    expect(seen.map(e => e.declared)).toEqual([true, false])
    expect(undeclaredWrites()).toEqual([{ repo: 'o/r' }])
  })

  it('a declared write leaves unrelated cached reads fresh; an undeclared one marks the repo stale', async () => {
    const key = identityKey('o/r', 'getThing', 'o/r')
    queryClient.setQueryData(key, 1)
    const spec = defineMutation({ name: 'test.declared', run: async () => { notifyWrite('o/r'); return 'ok' } })
    await runMutation(spec, [])
    expect(queryClient.get(JSON.stringify(key)).timestamp).toBeGreaterThan(0)
    notifyWrite('o/r')
    expect(queryClient.get(JSON.stringify(key)).timestamp).toBe(0)
  })

  it('rolls an optimistic patch back, but not over a newer value', async () => {
    const key = identityKey('o/r', 'getList', 'o/r')
    queryClient.setQueryData(key, [1, 2])
    const spec = defineMutation({
      name: 'test.rollback',
      run: async () => { throw new Error('nope') },
      optimistic: () => [{ key, update: l => l.filter(x => x !== 1) }],
    })
    await expect(runMutation(spec, [])).rejects.toMatchObject({ rolledBack: true })
    expect(queryClient.getQueryData(key)).toEqual([1, 2])

    const newer = defineMutation({
      name: 'test.rollback-newer',
      run: async () => { queryClient.setQueryData(key, [9]); throw new Error('nope') },
      optimistic: () => [{ key, update: l => l.filter(x => x !== 1) }],
    })
    await expect(runMutation(newer, [])).rejects.toThrow('nope')
    expect(queryClient.getQueryData(key)).toEqual([9])
  })

  it('invalidates exactly the declared key prefixes after success', async () => {
    const a = identityKey('o/r', 'getA', 'o/r', 1)
    const b = identityKey('o/r', 'getB', 'o/r', 1)
    queryClient.setQueryData(a, 1)
    queryClient.setQueryData(b, 1)
    const spec = defineMutation({ name: 'test.inv', run: async () => 'ok', invalidates: () => [identityKey('o/r', 'getA')] })
    await runMutation(spec, [])
    expect(queryClient.get(JSON.stringify(a)).timestamp).toBe(0)
    expect(queryClient.get(JSON.stringify(b)).timestamp).toBeGreaterThan(0)
  })
})
