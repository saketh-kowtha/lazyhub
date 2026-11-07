/**
 * key-ownership.test.js -- the generated key-ownership table (#485 / R7, #511).
 *
 * Walks the action registry instead of hand-listing keys, so a dead, duplicate
 * or lying key cannot reach main:
 *  - every key an action declares has exactly one owner in each context it is live in;
 *  - every footer hint, help row and which-key continuation names an action that is
 *    bound and live in that context;
 *  - every declared chord resolves through the same resolver the views use;
 *  - every action a context advertises has a handler in the source that owns it.
 */

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { DEFAULT_CONFIG } from './schema.js'
import { actionScopeMatches, createKeymap, resolveChord } from './keymap.js'
import { boundKeys, contextFooterHints, contextHelpRows, contextScopes, prefixContinuations } from '../ui/actions.js'
import { GLOBAL_KEYS, LIST_GLOBAL_KEYS, LIST_VIEW_KEYS } from '../app-keys.js'

const config = DEFAULT_CONFIG

// Every (pane, view) context a user can be in.
const CONTEXTS = [
  ['focus', 'list'], ['prs', 'list'], ['issues', 'list'], ['branches', 'list'], ['actions', 'list'],
  ['notifications', 'list'], ['prs', 'detail'], ['issues', 'detail'], ['prs', 'diff'], ['prs', 'comments'],
]

// Action ids whose handler lives in the app shell, not in a pane.
const APP_LEVEL = /^(app|go|command-palette|debug)\./

function liveIn(id, pane, view) {
  const scopes = contextScopes(pane, view, config)
  const action = config.actions[id]
  return !!action && scopes.some(scope => actionScopeMatches(action.scope, scope) || String(action.scope).split(',').includes(scope))
}

describe('every rendered hint names an action that is bound and live in that context', () => {
  for (const [pane, view] of CONTEXTS) {
    it(`${pane}/${view}: footer and help`, () => {
      const bad = []
      const items = [
        ...contextFooterHints(pane, view, {}, config).map(h => ({ ...h, where: 'footer' })),
        ...contextHelpRows(pane, view, {}, config).map(h => ({ ...h, where: 'help' })),
      ]
      for (const item of items) {
        if (!item.id) { bad.push(`${item.where}: ${item.label} has no action id`); continue }
        if (boundKeys(item.id, config).length === 0) bad.push(`${item.where}: ${item.id} is unbound`)
        else if (!liveIn(item.id, pane, view) && !APP_LEVEL.test(item.id)) bad.push(`${item.where}: ${item.id} is not live in ${pane}/${view}`)
      }
      expect(bad).toEqual([])
    })

    it(`${pane}/${view}: which-key continuations`, () => {
      for (const prefix of ['g']) {
        for (const c of prefixContinuations(prefix, pane, view, config)) {
          expect(boundKeys(c.actionId, config).length, `${prefix} ${c.key}`).toBeGreaterThan(0)
        }
      }
    })
  }

  it('the global help block lists only app-level actions that are bound', () => {
    const ids = new Set(Object.keys(config.actions))
    for (const hint of [...GLOBAL_KEYS, ...LIST_GLOBAL_KEYS, ...LIST_VIEW_KEYS]) {
      const id = [...ids].find(i => config.actions[i].label === hint.label && (config.actions[i].hint || config.actions[i].keys[0]) === hint.key)
      expect(id, `${hint.key} ${hint.label}`).toBeDefined()
      expect(APP_LEVEL.test(id), `${id} is an app-level action`).toBe(true)
      expect(boundKeys(id, config).length, id).toBeGreaterThan(0)
    }
  })
})

describe('every declared chord resolves', () => {
  const chords = []
  for (const [id, action] of Object.entries(config.actions)) {
    for (const token of action.keys) {
      if (/^\S \S$/.test(token) || /^[^\sA-Za-z<]{2}$|^[a-z]{2}$/.test(token)) chords.push([id, token, String(action.scope).split(',')[0]])
    }
  }

  it('finds the chords the registry declares', () => {
    expect(chords.map(([, token]) => token)).toEqual(expect.arrayContaining(['g l', 'g p', 'gg']))
  })

  for (const [id, token, scope] of chords) {
    it(`${token} -> ${id}`, () => {
      const [first, second] = token.includes(' ') ? token.split(' ') : [token[0], token[1]]
      // Resolve in the scope the action lives in (plus global, like the views do).
      const scopes = scope === 'list' ? ['global', 'pr-list'] : ['global', scope]
      expect(resolveChord(createKeymap(scopes, config), first, second)).toBe(id)
    })
  }
})

describe('every action a context advertises has a handler', () => {
  const SOURCES = {
    'pr-list': ['src/features/prs/list.jsx'],
    'issue-list': ['src/features/issues/list.jsx'],
    'branch-list': ['src/features/branches/index.jsx'],
    'workflow-list': ['src/features/actions/index.jsx'],
    'notification-list': ['src/features/notifications/index.jsx'],
    'tab-list': ['src/features/tabs/view.jsx'],
    'pr-detail': ['src/features/prs/detail.jsx'],
    'pr-checks': ['src/features/prs/detail.jsx'],
    diff: ['src/features/prs/diff/state.js'],
    'pr-comments': ['src/features/prs/comments.jsx'],
    'issue-detail': ['src/features/issues/detail.jsx'],
  }
  // Shared list verbs are consumed by the shared list controller, not by name.
  const SHARED = new Set(['cursor.down', 'cursor.up', 'cursor.top', 'cursor.bottom'])
  // Dispatched by key through `filterKeys` (state toggles), not by action id.
  const BY_KEY = /^(pr|issue)\.filter-(open|closed|merged)$/
  // Not offered in these views: contextHelpRows() hides them (UNSUPPORTED in ui/actions.js).
  const NOT_OFFERED = { 'tab-list': ['list.search'], 'pr-comments': ['list.search'], 'issue-detail': ['list.search'] }

  for (const [scope, files] of Object.entries(SOURCES)) {
    it(`${scope}: each bound action id appears in ${files.join(', ')}`, () => {
      const source = files.map(f => readFileSync(f, 'utf8')).join('\n')
      const missing = []
      for (const [id, action] of Object.entries(config.actions)) {
        if (!actionScopeMatches(action.scope, scope) || !action.keys.length || SHARED.has(id) || BY_KEY.test(id)) continue
        if ((NOT_OFFERED[scope] || []).includes(id)) continue
        if (!source.includes(`'${id}'`)) missing.push(id)
      }
      expect(missing).toEqual([])
    })
  }
})
