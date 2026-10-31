/**
 * keymap-registry.test.js -- guards for the action registry (#312).
 *
 * The TOML action table is the single source of key bindings. These tests keep
 * it honest: one verb per key within a context, no orphan action ids in views,
 * and rebinding through [keymaps.*] reaches every consumer.
 */

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { DEFAULT_CONFIG } from './schema.js'
import { actionScopeMatches, buildEffectiveActionKeys, createKeymap, normalizeKeyToken } from './keymap.js'
import { contextFooterHints, contextHelpRows, contextScopes, prefixContinuations, registeredPrefixes } from '../ui/actions.js'

const config = DEFAULT_CONFIG

// Contexts whose handlers dispatch through the registry. `global` keys apply in
// every one of them, so they join each scope when checking for collisions.
const CONTEXTS = ['pr-list', 'issue-list', 'branch-list', 'workflow-list', 'notification-list',
  'pr-detail', 'pr-checks', 'diff', 'pr-comments', 'issue-detail']

// Known pre-existing collisions, each a separate follow-up. Do not add to this
// list: fix the binding instead.
const KNOWN_COLLISIONS = {}

function bindingsFor(scope) {
  const byToken = new Map()
  for (const [id, action] of Object.entries(config.actions)) {
    // Checks mode is modal: its keys replace the view's, global keys do not apply.
    if (!actionScopeMatches(action.scope, scope) && !(action.scope === 'global' && scope !== 'pr-checks')) continue
    for (const key of action.keys) {
      const token = normalizeKeyToken(key)
      if (!token) continue
      byToken.set(token, [...(byToken.get(token) || []), id])
    }
  }
  return byToken
}

describe('duplicate-binding guard', () => {
  for (const scope of CONTEXTS) {
    it(`binds each key to one action in ${scope}`, () => {
      const dupes = {}
      for (const [token, ids] of bindingsFor(scope)) {
        if (ids.length > 1) dupes[token] = ids
      }
      expect(dupes).toEqual(KNOWN_COLLISIONS[scope] || {})
    })
  }

  it('keeps every key chord ("g p") unique across the table', () => {
    const seen = new Map()
    for (const [id, action] of Object.entries(config.actions)) {
      for (const key of action.keys) {
        if (!/^\S \S$/.test(key)) continue
        const scopes = String(action.scope).split(',')
        for (const scope of scopes) {
          const slot = `${scope}:${key}`
          expect(seen.get(slot), `${slot} bound to ${seen.get(slot)} and ${id}`).toBeUndefined()
          seen.set(slot, id)
        }
      }
    }
  })
})

describe('Ctrl+G', () => {
  it('means submit and nothing else', () => {
    const owners = Object.entries(config.actions)
      .filter(([, action]) => action.keys.includes('Ctrl+G'))
      .map(([id]) => id)
    expect(owners).toEqual(['dialog.submit'])
  })
})

describe('registry coverage', () => {
  const VIEW_SOURCES = [
    'src/features/prs/detail.jsx',
    'src/features/prs/diff/state.js',
    'src/features/prs/comments.jsx',
    'src/features/issues/detail.jsx',
  ]

  it('every action id a migrated view dispatches on exists in the registry', () => {
    const missing = []
    for (const file of VIEW_SOURCES) {
      const source = readFileSync(file, 'utf8')
      for (const match of source.matchAll(/(?<![.\w])id === '([\w.-]+)'/g)) {
        if (!config.actions[match[1]]) missing.push(`${file}: ${match[1]}`)
      }
    }
    expect(missing).toEqual([])
  })

  it('every key a view advertises in help has a handler in that view', () => {
    const NOT_IMPLEMENTED = { 'pr-comments': ['list.search'], 'issue-detail': ['list.search'] }
    const orphans = []
    for (const [scope, file] of [['pr-detail', VIEW_SOURCES[0]], ['diff', VIEW_SOURCES[1]],
      ['pr-comments', VIEW_SOURCES[2]], ['issue-detail', VIEW_SOURCES[3]]]) {
      const source = readFileSync(file, 'utf8')
      for (const [id, action] of Object.entries(config.actions)) {
        if (!actionScopeMatches(action.scope, scope) || !action.keys.length) continue
        if ((NOT_IMPLEMENTED[scope] || []).includes(id)) continue
        if (!source.includes(`id === '${id}'`)) orphans.push(`${scope}: ${id}`)
      }
    }
    expect(orphans).toEqual([])
  })

  it('no migrated view branches on a literal key for an action', () => {
    const literal = []
    for (const file of VIEW_SOURCES) {
      const source = readFileSync(file, 'utf8')
      if (/input === '/.test(source)) literal.push(file)
    }
    expect(literal).toEqual([])
  })

  it('footer ids all resolve to registry actions that have a key', () => {
    for (const [pane, view] of [['prs', 'list'], ['issues', 'list'], ['branches', 'list'], ['actions', 'list'],
      ['notifications', 'list'], ['prs', 'detail'], ['issues', 'detail'], ['prs', 'diff'], ['prs', 'comments']]) {
      const hints = contextFooterHints(pane, view, {}, config)
      expect(hints.length, `${pane}/${view}`).toBeGreaterThan(2)
      for (const hint of hints) expect(hint.key).toBeTruthy()
    }
  })
})

describe('registry-generated footer and help', () => {
  it('hides write actions that cannot run on a closed PR', () => {
    const open = contextFooterHints('prs', 'detail', { prOpen: true }, config).map(h => h.label)
    const closed = contextFooterHints('prs', 'detail', { prOpen: false }, config).map(h => h.label)
    expect(open).toContain('approve')
    expect(open).toContain('merge')
    expect(closed).not.toContain('approve')
    expect(closed).not.toContain('merge')
    expect(contextHelpRows('prs', 'detail', { prOpen: false }, config).map(r => r.key)).not.toContain('a')
  })

  it('does not offer diff keys in the PR list', () => {
    const labels = contextFooterHints('prs', 'list', {}, config).map(h => h.label)
    expect(labels).not.toContain('next file')
  })

  it('follows user rebinds', () => {
    const rebound = { ...config, keymaps: { ...config.keymaps, 'pr-detail': { Y: 'pr.approve', unbind: { a: true } } } }
    const keys = contextHelpRows('prs', 'detail', {}, rebound).filter(r => r.label.startsWith('Approve')).map(r => r.key)
    expect(keys).toEqual(['Y'])
    expect(buildEffectiveActionKeys(rebound)['pr.approve']).not.toContain('a')
  })
})

describe('prefix keys', () => {
  it('registers g as the go-to prefix with a continuation per pane', () => {
    expect([...registeredPrefixes(config)]).toContain('g')
    const keys = prefixContinuations('g', 'prs', 'list', config).map(c => c.key)
    expect(keys).toEqual(expect.arrayContaining(['h', 'p', 'i', 'b', 'a', 'n']))
  })

  it('adds go-to-line only inside the diff', () => {
    expect(prefixContinuations('g', 'prs', 'list', config).map(c => c.key)).not.toContain('l')
    expect(prefixContinuations('g', 'prs', 'diff', config).map(c => c.key)).toContain('l')
  })

  it('binds digits only to the pane-jump action', () => {
    for (const [id, action] of Object.entries(config.actions)) {
      if (id === 'app.jump-pane') continue
      for (const key of action.keys) expect(key).not.toMatch(/^[0-9]$/)
    }
  })
})

describe('createKeymap with shared scopes', () => {
  it('shares scroll/refresh verbs with full-screen views and PR verbs with the diff', () => {
    const diff = createKeymap(['global', 'diff'], config)
    expect(diff.resolve('j', {})).toBe('cursor.down')
    expect(diff.resolve('r', {})).toBe('list.refresh')
    expect(diff.resolve('a', {})).toBe('pr.approve')
    expect(diff.resolveToken('gg')).toBe('cursor.top')
    expect(diff.resolveToken('g l')).toBe('diff.goto-line')
  })

  it('does not read Ctrl+R as bare r', () => {
    const checks = createKeymap(['pr-checks'], config)
    expect(checks.resolve('r', { ctrl: true })).toBe('check.rerun')
    expect(checks.resolve('r', {})).toBe('list.refresh')
  })

  it('treats a comma list of scopes as live in each', () => {
    expect(actionScopeMatches('pr-list,pr-detail', 'pr-detail')).toBe(true)
    expect(actionScopeMatches('pr-list,pr-detail', 'diff')).toBe(false)
  })

  it('exposes every scope the resolver uses', () => {
    for (const [pane, view] of [['prs', 'diff'], ['prs', 'comments'], ['prs', 'detail'], ['issues', 'detail']]) {
      expect(contextScopes(pane, view)[0]).toBe('global')
    }
  })
})
